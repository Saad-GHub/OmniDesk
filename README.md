# OmniDesk — Devcubix Workspace

Electron desktop workspace for connecting a user's own Gmail, Slack, LinkedIn, and ClickUp accounts.

## Start the app

1. Install Node.js, Git, and SQL Server; create the `OmniDeskDB` database and run `schema.sql` in SQL Server Management Studio.
2. Install project packages with `npm install`.
3. Copy `.env.example` to `.env` and enter OAuth app credentials (see below).
4. Run the app with `npm start`.

## OAuth app setup

Follow the full local walkthrough in [OAUTH_SETUP_GUIDE.md](OAUTH_SETUP_GUIDE.md).

- **Google / Gmail:** Create an OAuth client with application type **Desktop app**. The Google client ID is required; its client secret is optional for this installed-app flow. Enable the Gmail API and add your account as a test user while the consent screen is in Testing. The app requests `gmail.readonly`, shows the account identity, and syncs up to six recent inbox messages once per minute while OmniDesk is open.
- **Slack:** Create a Slack app and enable **Sign in with Slack**. Add the redirect URL from `OAUTH_REDIRECT_URI` under the app's redirect URLs.
- **LinkedIn:** Create a LinkedIn developer app, enable **Sign In with LinkedIn using OpenID Connect**, and add the configured redirect URL to its authorized redirect URLs.
- **ClickUp:** Create an OAuth app and add the configured redirect URL to its redirect URLs.

For Slack, LinkedIn, and ClickUp, the default redirect URI is `https://localhost/omnidesk/oauth/callback`. Register that exact value in each provider console. For Google, the app uses a temporary loopback callback and opens the system browser; select a Desktop app OAuth client.

Keep real credentials in `.env`, which is ignored by Git. Each OmniDesk user connects accounts from **Profile → Connected Accounts**. OAuth tokens are encrypted using the current Windows user's secure storage and kept locally on that device. Removing an account clears its saved token from this device; revoke the app in the provider's account security settings to remove its authorization too.

> This local Electron build is suitable for development. Do not distribute a production build containing provider client secrets: Electron client secrets can be extracted. A production team deployment should exchange authorization codes and protect provider secrets in a backend service.
