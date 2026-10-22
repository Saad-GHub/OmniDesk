# OmniDesk OAuth setup guide (local semester demo)

## What you are setting up

You do **not** need to publish or host OmniDesk to try provider sign-in. You do need an internet connection while the app signs in and reads provider data.

There are two different kinds of credentials:

- **OmniDesk app credentials** identify your app to Google, Slack, LinkedIn, or ClickUp. You create these once as the app developer and put them in the local `.env` file.
- **Your personal account password** is entered only on the provider's own sign-in page. Do not put your Gmail, Slack, LinkedIn, or ClickUp password in `.env` or in OmniDesk.

Each team member can then press **Connect** and sign in to their own provider account. In this local build, linked tokens are encrypted on that Windows device and are not shared with teammates.

## Recommended order

Start with Google/Gmail. The desktop OAuth flow uses the system browser and a temporary localhost callback, so it is the best fit for an app that is not hosted. Then configure Slack, LinkedIn, and ClickUp if you have time and their provider consoles accept the local callback.

## A. Set up Google / Gmail

1. Open the [Google Cloud Console](https://console.cloud.google.com/) and create a project for OmniDesk (or select one you own).
2. In **APIs & Services → Library**, find **Gmail API** and enable it.
3. Open **Google Auth Platform** (or **APIs & Services → OAuth consent screen**) and configure the app name, support email, and contact email.
4. Set the audience to **External** if you will sign in with a personal Gmail account. Keep the publishing status in **Testing** for a class demo.
5. Add the exact Google account you will use as a **Test user**.
6. Under **Data Access / Scopes**, include:
   - `openid`
   - `email`
   - `profile`
   - `https://www.googleapis.com/auth/gmail.readonly`
7. Under **Clients**, create an OAuth client with application type **Desktop app**. Copy its **Client ID**. The Google client secret is optional for this desktop flow.
8. In OmniDesk's project folder, copy `.env.example` to `.env` and set:

   ```env
   GOOGLE_CLIENT_ID=paste-your-desktop-client-id-here
   GOOGLE_CLIENT_SECRET=
   ```

   Leave the other provider entries blank until you configure those providers. Keep `.env` private; it is ignored by Git.
9. Close and reopen OmniDesk so it loads the updated configuration.
10. Sign in to your local OmniDesk account, open **Profile → Connected Accounts**, click **Connect** beside Gmail, choose the Google account, and approve the requested read-only Gmail access.
11. Return to OmniDesk. It should show the Gmail account and recent inbox items. **Sync now** refreshes immediately; otherwise the inbox is checked about once per minute while the app is open.

Google classifies `gmail.readonly` as a restricted scope. A testing app can show an unverified-app warning, and Google says test-user authorizations for apps requesting scopes beyond basic profile/email can expire after seven days. Add yourself as a test user and reconnect if the test authorization expires. Public use requires Google's applicable verification. See [Gmail scope classifications](https://developers.google.com/workspace/gmail/api/auth/scopes) and [test audience behavior](https://support.google.com/cloud/answer/15549945?hl=en).

## B. Set up Slack sign-in

1. Open [Slack API: Your Apps](https://api.slack.com/apps) and create an app in a development workspace you control.
2. In **OAuth & Permissions**, enable **PKCE**. Slack treats this as a one-way setting; it cannot be disabled without contacting Slack Support. This lets a desktop app sign users in securely without embedding the app secret.
3. In **OAuth & Permissions → Redirect URLs**, add this exact desktop callback and save it:

   ```text
   http://localhost:43821/omnidesk/oauth/callback
   ```

4. Under **User Token Scopes**, add only the OpenID scopes `openid`, `profile`, and `email`. Leave **Bot Token Scopes** empty for this desktop sign-in app; Slack does not allow bot scopes with a localhost desktop redirect. OmniDesk uses Slack's user-centric OAuth endpoint, opens sign-in in your default browser, and completes the token exchange with PKCE.
5. Copy the app's **Client ID** from **Basic Information** into `SLACK_CLIENT_ID` in `.env`. A Slack client secret is not used for this PKCE desktop flow.
6. Restart OmniDesk, click **Connect** beside Slack, approve the sign-in in your normal browser, then return to OmniDesk.

This connection displays the Slack profile identity. It does not read channel messages. Reading workspace content needs a separate Slack API permission setup and user consent; Slack treats Sign in with Slack scopes separately from API scopes. If Slack rejects the localhost redirect, the current local-only setup cannot complete that provider's callback; use a reachable HTTPS callback service or leave Slack as a demo-only integration.

## C. Set up LinkedIn sign-in

1. Open the [LinkedIn Developer Portal](https://www.linkedin.com/developers/) and create/select an app.
2. Enable the product **Sign In with LinkedIn using OpenID Connect**.
3. In the app's **Auth** settings, try adding this authorized redirect URL:

   ```text
   https://localhost/omnidesk/oauth/callback
   ```

4. Copy the **Client ID** and **Client Secret** into `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET` in `.env`.
5. Restart OmniDesk, click **Connect** beside LinkedIn, and approve the sign-in.

This returns a LinkedIn member's basic OpenID profile and email when the product grants those scopes. It does not provide Recruiter or candidate-search access. LinkedIn may reject localhost as an authorized callback; if so, that integration needs a reachable HTTPS callback service, or should stay mocked for the local demo.

## D. Set up ClickUp (optional)

1. In ClickUp, open **Settings → Apps** and create a new OAuth app (a Workspace owner/admin may be required).
2. Register this redirect URL:

   ```text
   https://localhost/omnidesk/oauth/callback
   ```

3. Copy the app's **Client ID** and **Client Secret** into `CLICKUP_CLIENT_ID` and `CLICKUP_CLIENT_SECRET` in `.env`.
4. Restart OmniDesk, click **Connect** beside ClickUp, and authorize the relevant workspace.

If ClickUp refuses the local callback, use a reachable HTTPS callback service or leave it mocked for the demo.

## `.env` example

```env
GOOGLE_CLIENT_ID=your-google-desktop-client-id
GOOGLE_CLIENT_SECRET=
SLACK_CLIENT_ID=
SLACK_CLIENT_SECRET=
SLACK_REDIRECT_URI=http://localhost:43821/omnidesk/oauth/callback
LINKEDIN_CLIENT_ID=
LINKEDIN_CLIENT_SECRET=
CLICKUP_CLIENT_ID=
CLICKUP_CLIENT_SECRET=
OAUTH_REDIRECT_URI=https://localhost/omnidesk/oauth/callback
```

Use real app IDs/secrets from your provider developer consoles. Never commit `.env`, paste app secrets into source control, or enter a personal account password into this file. `.env.example` is only a blank template.

## If sign-in fails

- **“App sign-in is not configured”**: put the missing *OmniDesk app* ID (and for LinkedIn/ClickUp, secret) in `.env`, save it, then restart the app. Slack uses PKCE and needs only its client ID.
- **`redirect_uri_mismatch` / invalid redirect**: make the provider console's redirect URI exactly match `http://localhost:43821/omnidesk/oauth/callback` for Slack and `https://localhost/omnidesk/oauth/callback` for LinkedIn and ClickUp. Google uses a Desktop client and the app's dynamic `127.0.0.1` callback instead.
- **Google “access blocked” or unverified warning**: confirm your Google account is listed as a test user and that Gmail API is enabled. `gmail.readonly` is a restricted scope, so a test warning is expected before app verification.
- **Google permission expires**: in Testing, reconnect the test account when the authorization expires (Google documents a seven-day expiration for test-user authorizations using non-basic scopes).
- **No internet**: provider sign-in and live account data cannot work offline. Use mock data for an offline presentation.

## Security and demo limits

- OmniDesk requests Gmail **read-only** access. It shows only a small set of recent inbox message metadata/snippets; it does not send or delete email.
- Slack and LinkedIn currently show account identity only. ClickUp shows the authorized user identity.
- Do not ship an Electron installer with provider client secrets embedded in it. Slack's PKCE desktop flow does not use its client secret. For a public/team production release, put secret-bearing OAuth exchanges behind a backend. For a private class demo, keep any required app credentials in your local ignored `.env` file.
- Removing an integration from OmniDesk clears its saved local token. Also revoke OmniDesk from the provider's account/app security page if you want to cancel the provider-side grant.
