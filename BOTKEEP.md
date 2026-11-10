# Colour Club hosting runbook

Player site: https://colour-club.bot-keep.xyz/
Administrator dashboard: https://colour-club.bot-keep.xyz/admin
Source: https://github.com/Hariomkr147/Colour-club, branch `main`.

## Deployment layout

Botkeep runs the Node 24 website, API and continuous round processor. Supabase hosts PostgreSQL 17 in Mumbai in a separate Colour Club project under Kartavya. The existing Kartavya project was not changed.

The authenticated Botkeep plan reports 2,048 MB RAM, 150% CPU, 2,048 MB disk and five slots. The app receives the full 2,048 MB memory and 150% CPU limits, with a 512 MB disk allocation. These are resource ceilings, not certified player capacity. The failed, unused Botkeep PostgreSQL workload was removed after the Supabase connection, schema and backup/restore checks passed.

The owner confirmed that Botkeep support allows this points-only browser game. No paid hosting plan was purchased. Free hosting is not an uptime guarantee.

## Application configuration

| Setting | Value |
|---|---|
| Runtime | Node 24 |
| Start command | `npm start` |
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `SERVER_PORT` | Provided by Botkeep; do not override with the laptop port |
| `APP_ORIGIN` | `https://colour-club.bot-keep.xyz` |
| `DATABASE_URL` | Private Supabase session-pooler URL stored as a hosting secret |
| `DATABASE_SCHEMA` | `colour_club` |
| `REGISTRATION_ENABLED` | `true` |
| `REQUIRE_VERIFICATION` | `false` |
| `SMTP_URL`, `MAIL_FROM` | Absent until an email provider is connected |

Botkeep installs locked dependencies during GitHub imports. For a manual install, use `npm ci --omit=dev`. The frontend and API share one origin.

Signups work immediately without verification and receive 10,000 points. Password recovery reports that it is unavailable while SMTP is absent. Test real delivery before enabling verification later.

## Database and administrator

See [SUPABASE.md](SUPABASE.md) for connection isolation and backups. Never upload the laptop's `.env`, database directory or private deployment state to the website or repository.

The owner account has a generated password and authenticator verification. Private bootstrap details are saved locally in `data/deployment/hosted-admin/data/admin-setup.txt`, outside version control. Add the key to an authenticator app, then sign in at `/admin`. There are no public default credentials.

To provision an administrator from a trusted shell with the deployment database URL and schema configured, use `npm run admin -- ACTUAL_OWNER_EMAIL`. The command refuses to overwrite an existing `data/admin-setup.txt`. Do not expose a setup endpoint.

## Deploy and recover

1. Run automated checks and push the intended release to GitHub.
2. Sync the source in Botkeep, then verify the completed operation and commit. A queued request is not deployment success.
3. Check `/api/health` and `/api/state` through the public HTTPS origin.
4. Verify signup, a single wallet debit, settlement and admin access after changes to those flows.

The documented [developer API](https://api.botkeep.cloud/api/v1/developer/openapi.json) supports configuration, source sync, recovery, lifecycle actions and resizing. Source sync sometimes required its explicit resume recovery action after infrastructure failure during setup. Verify the final revision and public health after recovery.

The app finishes active round processing before closing database connections during a graceful stop. Startup recovers unfinished rounds, and settlement and request keys prevent duplicate point entries.

Keep the launch limitations in [LAUNCH.md](LAUNCH.md). This deployment remains points-only, without payments, transfers, prizes or withdrawals.
