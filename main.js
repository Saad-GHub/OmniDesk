const { app, BrowserWindow, ipcMain } = require('electron');
const sql = require('mssql');

let mainWindow;

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

// --- OAuth Trigger ---
ipcMain.on('start-oauth', (event, platform) => {
  console.log(`[OAuth Flow Initiated] Platform: ${platform}`);
  // In the next step, we will create the secondary BrowserWindow popup here
  // to route the user to the specific platform's live login URL.
});