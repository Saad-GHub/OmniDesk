const { app, BrowserWindow, ipcMain, safeStorage, shell } = require('electron');
const sql = require('mssql');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const path = require('path');

loadEnvFile();

let mainWindow;
let currentUser = null;
const activeOAuthWindows = new Set();

function loadEnvFile() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').replace(/^\uFEFF/, '').split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (match && !match[1].startsWith('#') && !process.env[match[1]]) {
        process.env[match[1]] = match[2].replace(/^(["'])(.*)\1$/, '$2');
      }
    }
  } catch (error) {
    console.error('Could not read .env:', error.message);
  }
}

// Database Configuration
const dbConfig = {
  user: 'sa', 
  password: 'ssms1234', 
  server: 'localhost', 
  database: 'OmniDeskDB',
  options: {
    encrypt: false, 
    trustServerCertificate: true 
  }
};

async function connectDB() {
  try {
    await sql.connect(dbConfig);
    console.log('✅ Microsoft SQL Server Connected Successfully');
  } catch (err) {
    console.error('❌ Database Connection Failed:', err.message);
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  // Loads the login window first
  mainWindow.loadFile('login.html');
}

app.whenReady().then(() => {
  connectDB();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// --- Authentication (Login/Signup) ---
ipcMain.on('attempt-login', async (event, credentials) => {
  try {
    const request = new sql.Request();
    request.input('userParam', sql.VarChar, credentials.username);
    request.input('passParam', sql.VarChar, credentials.password);
    
    const result = await request.query('SELECT * FROM Users WHERE Username = @userParam AND PasswordHash = @passParam');

    if (result.recordset.length > 0) {
      currentUser = { id: result.recordset[0].UserID, username: result.recordset[0].Username };
      event.reply('login-response', { success: true });
      mainWindow.loadFile('index.html'); 
    } else {
      event.reply('login-response', { success: false });
    }
  } catch (err) {
    event.reply('login-response', { success: false });
  }
});

ipcMain.on('attempt-signup', async (event, credentials) => {
  try {
    const request = new sql.Request();
    request.input('newUser', sql.VarChar, credentials.username);
    request.input('newPass', sql.VarChar, credentials.password);
    await request.query("INSERT INTO Users (Username, PasswordHash, Role) VALUES (@newUser, @newPass, 'Employee')");
    event.reply('signup-response', { success: true });
  } catch (err) {
    event.reply('signup-response', { success: false, error: err.message });
  }
});

const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || 'https://localhost/omnidesk/oauth/callback';
const SLACK_REDIRECT_URI = process.env.SLACK_REDIRECT_URI || 'http://localhost:43821/omnidesk/oauth/callback';
const providers = {
  gmail: {
    clientId: 'GOOGLE_CLIENT_ID', clientSecret: 'GOOGLE_CLIENT_SECRET',
    authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token',
    scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
    profile: async token => {
      const response = await apiJson('https://openidconnect.googleapis.com/v1/userinfo', token);
      return { id: response.sub, email: response.email, name: response.name, avatar: response.picture };
    }
  },
  slack: {
    clientId: 'SLACK_CLIENT_ID', clientSecret: 'SLACK_CLIENT_SECRET',
    // Slack's user-centric OAuth flow is intended for public desktop clients
    // that need user tokens only, with no bot scopes or embedded app secret.
    authorize: 'https://slack.com/oauth/v2_user/authorize', token: 'https://slack.com/api/oauth.v2.user.access',
    scopes: ['openid', 'profile', 'email'],
    profile: async token => {
      const response = await apiJson('https://slack.com/api/openid.connect.userInfo', token);
      return { id: response.sub, email: response.email, name: response.name, avatar: response.picture, workspace: response['https://slack.com/team_name'] };
    }
  },
  linkedin: {
    clientId: 'LINKEDIN_CLIENT_ID', clientSecret: 'LINKEDIN_CLIENT_SECRET',
    authorize: 'https://www.linkedin.com/oauth/v2/authorization', token: 'https://www.linkedin.com/oauth/v2/accessToken',
    scopes: ['openid', 'profile', 'email'],
    profile: async token => {
      const response = await apiJson('https://api.linkedin.com/v2/userinfo', token);
      return { id: response.sub, email: response.email, name: response.name, avatar: response.picture };
    }
  },
  clickup: {
    clientId: 'CLICKUP_CLIENT_ID', clientSecret: 'CLICKUP_CLIENT_SECRET',
    authorize: 'https://app.clickup.com/api', token: 'https://api.clickup.com/api/v2/oauth/token',
    scopes: [],
    profile: async token => {
      const response = await apiJson('https://api.clickup.com/api/v2/user', token);
      const user = response.user || response;
      return { id: String(user.id), email: user.email, name: user.username || user.email, avatar: user.profilePicture };
    }
  }
};

function getCredential(provider, key) {
  const envName = providers[provider][key];
  return process.env[envName];
}

function getAccountsPath() {
  return path.join(app.getPath('userData'), 'connected-accounts.dat');
}

function readAccounts() {
  const filePath = getAccountsPath();
  if (!fs.existsSync(filePath)) return {};
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure token storage is unavailable.');
  const encrypted = fs.readFileSync(filePath);
  return JSON.parse(safeStorage.decryptString(encrypted));
}

function writeAccounts(accounts) {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('Windows secure token storage is unavailable.');
  fs.mkdirSync(app.getPath('userData'), { recursive: true });
  const temporaryPath = `${getAccountsPath()}.tmp`;
  fs.writeFileSync(temporaryPath, safeStorage.encryptString(JSON.stringify(accounts)));
  fs.renameSync(temporaryPath, getAccountsPath());
}

function userAccounts(accounts = readAccounts()) {
  if (!currentUser) throw new Error('Please sign in to OmniDesk first.');
  return accounts[String(currentUser.id)] || {};
}

async function apiJson(url, token, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, ...(options.headers || {}) }
  });
  const body = await response.json();
  if (!response.ok || body.ok === false) throw new Error(body.error_description || body.error || body.message || `Provider request failed (${response.status}).`);
  return body;
}

function base64Url(buffer) {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function makeAuthorizationUrl(provider, state, verifier, nonce, redirectUri) {
  const config = providers[provider];
  const url = new URL(config.authorize);
  url.searchParams.set('client_id', getCredential(provider, 'clientId'));
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', state);
  if (config.scopes.length && provider !== 'slack') url.searchParams.set('scope', config.scopes.join(' '));
  if (provider === 'gmail') {
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    url.searchParams.set('code_challenge', base64Url(crypto.createHash('sha256').update(verifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('nonce', nonce);
  }
  if (provider === 'slack') {
    // This user-only endpoint takes permissions in scope, with no bot scopes.
    url.searchParams.set('scope', config.scopes.join(','));
    url.searchParams.set('code_challenge', base64Url(crypto.createHash('sha256').update(verifier).digest()));
    url.searchParams.set('code_challenge_method', 'S256');
    url.searchParams.set('nonce', nonce);
  }
  return url;
}

async function verifyOidcToken(provider, encodedToken, expectedNonce) {
  if (!encodedToken) throw new Error(`${provider} did not return an identity token.`);
  const parts = encodedToken.split('.');
  if (parts.length !== 3) throw new Error(`${provider} returned an invalid identity token.`);
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  const jwksUrl = {
    gmail: 'https://www.googleapis.com/oauth2/v3/certs',
    slack: 'https://slack.com/openid/connect/keys',
    linkedin: 'https://www.linkedin.com/oauth/openid/jwks'
  }[provider];
  if (header.alg !== 'RS256' || !header.kid) throw new Error(`${provider} returned an unsupported identity token.`);
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(getCredential(provider, 'clientId'))) throw new Error(`${provider} identity did not match this app.`);
  const expirationMs = Number(claims.exp) * 1000;
  if (!Number.isFinite(expirationMs) || expirationMs <= Date.now()) {
    throw new Error(`${provider} identity token is expired or has no valid expiry. Check your computer's date and time, then try again.`);
  }
  if (expectedNonce && claims.nonce !== expectedNonce) {
    throw new Error(`${provider} identity nonce did not match. Close OmniDesk and retry sign-in.`);
  }
  const issuers = provider === 'gmail' ? ['https://accounts.google.com', 'accounts.google.com'] : provider === 'slack' ? ['https://slack.com'] : ['https://www.linkedin.com/oauth'];
  if (!issuers.includes(claims.iss)) throw new Error(`${provider} returned an unexpected identity issuer.`);
  const response = await fetch(jwksUrl);
  if (!response.ok) throw new Error(`Could not retrieve ${provider} identity keys.`);
  const jwks = await response.json();
  const jwk = jwks.keys?.find(key => key.kid === header.kid && key.kty === 'RSA');
  if (!jwk) throw new Error(`Could not verify ${provider} identity signature.`);
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const signature = Buffer.from(parts[2], 'base64url');
  if (!crypto.verify('RSA-SHA256', Buffer.from(`${parts[0]}.${parts[1]}`), key, signature)) throw new Error(`${provider} identity signature is invalid.`);
}

async function exchangeCode(provider, code, verifier, redirectUri) {
  const config = providers[provider];
  const params = new URLSearchParams({
    client_id: getCredential(provider, 'clientId'),
    code,
    redirect_uri: redirectUri
  });
  // Slack desktop sign-in uses PKCE as a public client; do not send the app secret.
  if (provider !== 'slack' && getCredential(provider, 'clientSecret')) params.set('client_secret', getCredential(provider, 'clientSecret'));
  if (provider === 'gmail') {
    params.set('grant_type', 'authorization_code');
    params.set('code_verifier', verifier);
  }
  if (provider === 'slack') {
    params.set('grant_type', 'authorization_code');
    params.set('code_verifier', verifier);
  }
  if (provider === 'linkedin') params.set('grant_type', 'authorization_code');
  const response = await fetch(config.token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params
  });
  const tokenSet = await response.json();
  if (!response.ok || tokenSet.error || !tokenSet.access_token) {
    throw new Error(tokenSet.error_description || tokenSet.error || `Could not exchange authorization code (${response.status}).`);
  }
  return tokenSet;
}

async function authorizeGoogle(state, verifier, nonce) {
  const callbackPath = '/oauth2callback';
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const redirectUri = `http://127.0.0.1:${address.port}${callbackPath}`;
  const authUrl = makeAuthorizationUrl('gmail', state, verifier, nonce, redirectUri);
  try {
    await shell.openExternal(authUrl.toString());
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Google sign-in timed out. Please try again.')), 180000);
      server.on('request', (request, response) => {
        const callbackUrl = new URL(request.url, redirectUri);
        if (request.method !== 'GET' || callbackUrl.pathname !== callbackPath) {
          response.writeHead(404).end();
          return;
        }
        if (callbackUrl.searchParams.get('state') !== state) {
          response.writeHead(400, { 'Content-Type': 'text/plain' }).end('Sign-in could not be verified. Return to OmniDesk and try again.');
          clearTimeout(timeout);
          reject(new Error('Sign-in could not be verified. Please try again.'));
          return;
        }
        if (callbackUrl.searchParams.get('error')) {
          const reason = callbackUrl.searchParams.get('error_description') || callbackUrl.searchParams.get('error');
          response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>OmniDesk</title><p>Sign-in was cancelled. You can close this page.</p>');
          clearTimeout(timeout);
          reject(new Error(reason));
          return;
        }
        const authorizationCode = callbackUrl.searchParams.get('code');
        if (!authorizationCode) {
          response.writeHead(400).end('Authorization code was not provided.');
          clearTimeout(timeout);
          reject(new Error('Google did not return an authorization code.'));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><title>OmniDesk</title><p>Gmail is connected. You can close this page and return to OmniDesk.</p>');
        clearTimeout(timeout);
        resolve(authorizationCode);
      });
    });
    return { code, redirectUri };
  } finally {
    server.close();
  }
}

async function authorizeSlack(state, verifier, nonce) {
  const redirectUri = new URL(SLACK_REDIRECT_URI);
  if (redirectUri.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(redirectUri.hostname)) {
    throw new Error('Slack desktop sign-in requires an HTTP localhost callback URL.');
  }
  const server = http.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', error => {
      if (error.code === 'EADDRINUSE') reject(new Error(`Slack callback port ${redirectUri.port} is already in use. Close the other OmniDesk instance and try again.`));
      else reject(error);
    });
    server.listen(Number(redirectUri.port), redirectUri.hostname, resolve);
  });
  const authUrl = makeAuthorizationUrl('slack', state, verifier, nonce, SLACK_REDIRECT_URI);
  console.log(`[Slack OAuth] PKCE S256 challenge included: ${authUrl.searchParams.has('code_challenge') && authUrl.searchParams.get('code_challenge_method') === 'S256'}; redirect: ${SLACK_REDIRECT_URI}`);
  try {
    const code = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Slack sign-in timed out. Please try again.')), 180000);
      const finish = (error, value) => {
        clearTimeout(timeout);
        error ? reject(error) : resolve(value);
      };
      server.on('request', async (request, response) => {
        const callbackUrl = new URL(request.url, SLACK_REDIRECT_URI);
        if (callbackUrl.pathname !== redirectUri.pathname) {
          response.writeHead(404).end('Not found.');
          return;
        }
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const params = request.method === 'POST'
          ? new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
          : callbackUrl.searchParams;
        if (params.get('state') !== state) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Sign-in could not be verified. Return to OmniDesk and try again.');
          finish(new Error('Sign-in could not be verified. Please try again.'));
          return;
        }
        if (params.get('error')) {
          const reason = params.get('error_description') || params.get('error');
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>OmniDesk</title><p>Slack sign-in was cancelled. You can close this page.</p>');
          finish(new Error(reason));
          return;
        }
        const authorizationCode = params.get('code');
        if (!authorizationCode) {
          response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Slack did not provide an authorization code.');
          finish(new Error('Slack did not provide an authorization code.'));
          return;
        }
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end('<!doctype html><title>OmniDesk</title><p>Slack is connected. You can close this page and return to OmniDesk.</p>');
        finish(null, authorizationCode);
      });
      shell.openExternal(authUrl.toString()).catch(finish);
    });
    return { code, redirectUri: SLACK_REDIRECT_URI };
  } finally {
    server.close();
  }
}

async function connectAccount(provider) {
  if (!currentUser) throw new Error('Please sign in to OmniDesk first.');
  if (!providers[provider]) throw new Error('Unknown account provider.');
  if (!getCredential(provider, 'clientId') || (!['gmail', 'slack'].includes(provider) && !getCredential(provider, 'clientSecret'))) {
    const providerName = provider === 'gmail' ? 'Google' : provider[0].toUpperCase() + provider.slice(1);
    const missing = !getCredential(provider, 'clientId') ? 'client ID' : 'client secret';
    throw new Error(`${providerName} sign-in is not configured for this OmniDesk app yet (missing its app ${missing}). The app owner sets this up once; your own account password is never entered in OmniDesk.`);
  }
  const state = base64Url(crypto.randomBytes(32));
  const verifier = base64Url(crypto.randomBytes(48));
  const nonce = base64Url(crypto.randomBytes(24));
  if (provider === 'gmail') {
    const callback = await authorizeGoogle(state, verifier, nonce);
    const tokenSet = await exchangeCode(provider, callback.code, verifier, callback.redirectUri);
    tokenSet.expires_at = Date.now() + (tokenSet.expires_in || 3600) * 1000;
    await verifyOidcToken(provider, tokenSet.id_token, nonce);
    const account = await providers[provider].profile(tokenSet.access_token);
    const accounts = readAccounts();
    const localUserId = String(currentUser.id);
    accounts[localUserId] = accounts[localUserId] || {};
    accounts[localUserId][provider] = { tokenSet, account, connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString() };
    writeAccounts(accounts);
    return { provider, account, connectedAt: accounts[localUserId][provider].connectedAt };
  }

  if (provider === 'slack') {
    const callback = await authorizeSlack(state, verifier, nonce);
    const tokenSet = await exchangeCode(provider, callback.code, verifier, callback.redirectUri);
    await verifyOidcToken(provider, tokenSet.id_token, nonce);
    const account = await providers[provider].profile(tokenSet.access_token);
    const accounts = readAccounts();
    const localUserId = String(currentUser.id);
    accounts[localUserId] = accounts[localUserId] || {};
    accounts[localUserId][provider] = { tokenSet, account, connectedAt: new Date().toISOString(), syncedAt: new Date().toISOString() };
    writeAccounts(accounts);
    return { provider, account, connectedAt: accounts[localUserId][provider].connectedAt };
  }

  const authUrl = makeAuthorizationUrl(provider, state, verifier, nonce, OAUTH_REDIRECT_URI);

  const authWindow = new BrowserWindow({
    width: 540, height: 760, parent: mainWindow, modal: true, show: false,
    autoHideMenuBar: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true }
  });
  activeOAuthWindows.add(authWindow);
  authWindow.once('ready-to-show', () => authWindow.show());

  try {
    const callback = await new Promise((resolve, reject) => {
      let settled = false;
      let callbackFilter;
      const timeout = setTimeout(() => finish(new Error('Account sign-in timed out. Please try again.')), 180000);
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (callbackFilter) authWindow.webContents.session.webRequest.onBeforeRequest(callbackFilter, (_details, done) => done({}));
        error ? reject(error) : resolve(value);
      };
      const inspectUrl = (rawUrl, formBody = '') => {
        let parsed;
        try { parsed = new URL(rawUrl); } catch { return; }
        if (`${parsed.origin}${parsed.pathname}` !== `${new URL(OAUTH_REDIRECT_URI).origin}${new URL(OAUTH_REDIRECT_URI).pathname}`) return;
        const params = new URLSearchParams(parsed.search);
        new URLSearchParams(formBody).forEach((value, key) => params.set(key, value));
        const returnedState = params.get('state');
        if (returnedState !== state) return finish(new Error('Sign-in could not be verified. Please try again.'));
        if (params.get('error')) return finish(new Error(params.get('error_description') || params.get('error')));
        const code = params.get('code');
        if (code) finish(null, code);
      };
      authWindow.webContents.on('will-redirect', (event, targetUrl) => {
        if (targetUrl.startsWith(`${new URL(OAUTH_REDIRECT_URI).origin}${new URL(OAUTH_REDIRECT_URI).pathname}`) && new URL(targetUrl).searchParams.has('state')) {
          event.preventDefault();
          inspectUrl(targetUrl);
        }
      });
      authWindow.webContents.on('will-navigate', (event, targetUrl) => {
        if (targetUrl.startsWith(`${new URL(OAUTH_REDIRECT_URI).origin}${new URL(OAUTH_REDIRECT_URI).pathname}`) && new URL(targetUrl).searchParams.has('state')) {
          event.preventDefault();
          inspectUrl(targetUrl);
        }
      });
      callbackFilter = { urls: [`${new URL(OAUTH_REDIRECT_URI).origin}${new URL(OAUTH_REDIRECT_URI).pathname}*`] };
      const interceptCallback = (details, callbackRequest) => {
        const targetUrl = new URL(details.url);
        if (`${targetUrl.origin}${targetUrl.pathname}` === `${new URL(OAUTH_REDIRECT_URI).origin}${new URL(OAUTH_REDIRECT_URI).pathname}`) {
          const rawBody = (details.uploadData || []).map(part => part.bytes ? Buffer.from(part.bytes).toString('utf8') : '').join('&');
          inspectUrl(details.url, rawBody);
          callbackRequest({ cancel: true });
          return;
        }
        callbackRequest({});
      };
      authWindow.webContents.session.webRequest.onBeforeRequest(callbackFilter, interceptCallback);
      authWindow.on('closed', () => finish(new Error('Sign-in window was closed.')));
      // Electron may reject loadURL with ERR_ABORTED when a redirect/navigation
      // is intercepted during the OAuth flow. The callback listeners above are
      // responsible for completing sign-in, so don't fail the flow for that
      // expected cancellation; the timeout still handles a genuinely stalled login.
      authWindow.loadURL(authUrl.toString()).catch(error => {
        if (error?.code !== 'ERR_ABORTED') finish(error);
      });
    });

    const tokenSet = await exchangeCode(provider, callback, verifier, OAUTH_REDIRECT_URI);
    // ClickUp's OAuth token response is an access token, not an OpenID Connect
    // identity token. Verify LinkedIn's ID token, then retrieve ClickUp's user
    // profile directly through its authenticated-user API.
    if (provider === 'linkedin') await verifyOidcToken(provider, tokenSet.id_token, null);
    const account = await providers[provider].profile(tokenSet.access_token);
    const accounts = readAccounts();
    const localUserId = String(currentUser.id);
    accounts[localUserId] = accounts[localUserId] || {};
    accounts[localUserId][provider] = {
      tokenSet,
      account,
      connectedAt: new Date().toISOString(),
      syncedAt: new Date().toISOString()
    };
    writeAccounts(accounts);
    return { provider, account, connectedAt: accounts[localUserId][provider].connectedAt };
  } finally {
    activeOAuthWindows.delete(authWindow);
    if (!authWindow.isDestroyed()) authWindow.close();
  }
}

async function refreshProviderToken(provider, saved) {
  if (!saved?.tokenSet?.refresh_token || provider !== 'gmail') return saved.tokenSet.access_token;
  const expiresAt = saved.tokenSet.expires_at || 0;
  if (Date.now() < expiresAt - 60000) return saved.tokenSet.access_token;
  const params = new URLSearchParams({
    client_id: getCredential(provider, 'clientId'),
    refresh_token: saved.tokenSet.refresh_token,
    grant_type: 'refresh_token'
  });
  if (getCredential(provider, 'clientSecret')) params.set('client_secret', getCredential(provider, 'clientSecret'));
  const response = await fetch(providers[provider].token, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: params
  });
  const refreshed = await response.json();
  if (!response.ok || refreshed.error) throw new Error(refreshed.error_description || refreshed.error || 'Google sign-in expired. Reconnect Gmail.');
  saved.tokenSet = { ...saved.tokenSet, ...refreshed, refresh_token: refreshed.refresh_token || saved.tokenSet.refresh_token, expires_at: Date.now() + (refreshed.expires_in || 3600) * 1000 };
  return saved.tokenSet.access_token;
}

function publicAccounts(accounts) {
  const result = {};
  for (const [provider, saved] of Object.entries(accounts)) {
    result[provider] = { connected: true, account: saved.account, connectedAt: saved.connectedAt, syncedAt: saved.syncedAt };
  }
  return result;
}

async function refreshAccountIdentities() {
  const savedAccounts = readAccounts();
  const connected = userAccounts(savedAccounts);
  for (const [provider, saved] of Object.entries(connected)) {
    try {
      const accessToken = await refreshProviderToken(provider, saved);
      saved.account = await providers[provider].profile(accessToken);
      saved.profileError = null;
    } catch (error) {
      saved.profileError = error.message;
    }
  }
  writeAccounts(savedAccounts);
  return { username: currentUser?.username, accounts: publicAccounts(connected) };
}

ipcMain.handle('connect-account', async (_event, provider) => connectAccount(provider));
ipcMain.handle('get-connected-accounts', async () => refreshAccountIdentities());
ipcMain.handle('disconnect-account', async (_event, provider) => {
  const accounts = readAccounts();
  const localUserId = String(currentUser.id);
  if (accounts[localUserId]) delete accounts[localUserId][provider];
  writeAccounts(accounts);
  return publicAccounts(userAccounts(accounts));
});
ipcMain.handle('sync-gmail', async () => {
  const accounts = readAccounts();
  const saved = userAccounts(accounts).gmail;
  if (!saved) throw new Error('Connect Gmail from Profile first.');
  const token = await refreshProviderToken('gmail', saved);
  const list = await apiJson('https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=6&labelIds=INBOX', token);
  const emails = await Promise.all((list.messages || []).map(async message => {
    const item = await apiJson(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(message.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`, token);
    const headers = Object.fromEntries((item.payload?.headers || []).map(header => [header.name.toLowerCase(), header.value]));
    return { id: item.id, snippet: item.snippet || '', subject: headers.subject || '(No subject)', from: headers.from || 'Unknown sender', date: headers.date || '', unread: (item.labelIds || []).includes('UNREAD') };
  }));
  const localUserId = String(currentUser.id);
  saved.syncedAt = new Date().toISOString();
  writeAccounts(accounts);
  return { emails, unreadCount: emails.filter(email => email.unread).length, syncedAt: saved.syncedAt };
});

app.on('before-quit', () => {
  for (const authWindow of activeOAuthWindows) if (!authWindow.isDestroyed()) authWindow.close();
});
