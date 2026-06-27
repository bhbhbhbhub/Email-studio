# Email Studio

An internal outreach workspace for importing leads, organizing industries, generating template-based emails, and sending through Gmail or Outlook.

## Run locally

1. Copy `.env.example` to `.env` and set a strong `JWT_SECRET`.
2. Run `npm install`.
3. Run `npm start`.
4. Open `http://localhost:3000`.

SQLite data is created automatically in `database/email-studio.db`.

## OAuth setup

Create OAuth applications with Google and Microsoft, then populate the matching values in `.env`.

- Google redirect URI: `http://localhost:3000/oauth/google/callback`
- Microsoft redirect URI: `http://localhost:3000/oauth/microsoft/callback`
- Google scopes: Gmail send and user email
- Microsoft scopes: `User.Read`, `Mail.Send`, and `offline_access`

Set `APP_URL` to the deployed HTTPS origin in production and use the equivalent callback URLs with each provider.

## Lead import columns

CSV and Excel imports recognize: `Company Name`, `Website`, `Email`, `Industry`, and `Notes`. Industry names are matched to existing industries; unmatched leads remain unassigned.

## Production notes

- Run behind HTTPS and a reverse proxy.
- Store OAuth secrets and `JWT_SECRET` in a secrets manager.
- Back up the SQLite database and restrict filesystem access.
- Use one application process because the pause/resume queue is held in memory. For horizontal scaling, move queues to a shared job system.
