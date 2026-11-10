# Colour Club

A colour-prediction website with PostgreSQL, accounts, points wallets, four continuous rooms and an administrator dashboard.

For the complete GitHub-to-host workflow, use the [Botkeep deployment guide](BOTKEEP.md). It covers Node 24, PostgreSQL, assigned ports, HTTPS, email and private admin bootstrap. Live credentials and local databases are excluded from this repository.

## Local access

- Player website: [http://127.0.0.1:3000](http://127.0.0.1:3000)
- Administration: [http://127.0.0.1:3000/admin](http://127.0.0.1:3000/admin)
- Private local administrator login and authenticator setup: `data/admin-setup.txt`. This file contains secrets; keep it private and never upload it. Add its authenticator key to an authenticator app, then use the six-digit code after signing in.

The existing SQLite accounts, bets, results and ledger were imported into PostgreSQL. Wallet balances reconciled. The old SQLite database was preserved. Existing users must sign in again because old sessions were not imported.

## Start and test

Requires Node 24 and PostgreSQL. Dependencies are locked by `package-lock.json`.

```powershell
npm ci
npm run db:local
npm start
```

`db:local` starts a separate project-owned PostgreSQL cluster on `127.0.0.1:55432`, using the installed PostgreSQL 18 binaries. It does not change the installed PostgreSQL service. It writes randomly generated credentials to the ignored `.env` file on first setup. On other systems, set `DATABASE_URL` to a PostgreSQL database; a local cluster is not required.

```powershell
npm test
npm run test:postgres
npm run check
npm run test:e2e
```

The main test command loads `.env` when available and includes the PostgreSQL integration tests. Without `DATABASE_URL`, PostgreSQL tests are explicitly skipped. Browser tests use the running local server and Microsoft Edge on Windows; on other systems install Playwright Chromium and use `E2E_CHANNEL=chromium`. The admin browser test uses the private local bootstrap file and is intended for this local test environment only. It must not be run against a live customer service.

## Included

- Registration with one 10,000-point welcome grant per unique email account.
- Salted scrypt password hashes, hashed server-session tokens, HttpOnly/SameSite cookies, session rotation and logout revocation.
- Email verification, resend and single-use password reset; reset revokes sessions. Production requires verified email before play.
- Per-administrator authenticator keys, replay-protected TOTP verification and ten-minute admin elevation.
- Searchable/paginated users; account details, balances, prediction and ledger history; block/unblock with required reason and recorded actor.
- All-bet and all-round views, aggregate point accounting, reconciliation status and administrator action records.
- Four independent 30/60/180/300-second rooms, final-five-second locks, persisted settlement and restart recovery.
- Conditional wallet debits, request idempotency and database locks for concurrent betting/settlement. Blocked accounts cannot start new play; existing bets settle.
- Integer point accounting; checks reject unsafe aggregate totals before choosing a result.
- Versioned schema installation and shared PostgreSQL-backed request limits.
- Responsive charcoal/jade player site, tactile number graphics, brief result/dialog motion and reduced-motion support.
- Public history without calculation controls. Detailed calculations are retained in administrator round records.
- Docker build, a Render deployment template, a backup command and an isolated restore check.

This browser application uses revocable database-backed sessions rather than JWTs stored in browser storage. Revocation makes blocking effective on the next request and avoids a second refresh-token system.

## Outcome policy and points

The result engine evaluates total payouts for every number and selects the lowest-payout result, breaking equal minima randomly. This is explained in the rules, signup acknowledgement and prediction slip. It must not be described as an independent random draw or as solely luck-based.

Green wins on 1,3,7,9 at 2×; Red on 2,4,6,8 at 2×; Violet on 0,5 at 4.5×. Exact number returns 9×; Big/Small returns 1.9×. Returns include the stake. These are this application's published rules, not a claim about another platform's rules.

No deposits, purchases, prizes, transfers or withdrawals exist. There is no hidden flag that enables real money. [India and hosting assessment](LAUNCH.md) explains the research and unresolved launch decisions.

## Email configuration

Local development saves verification/recovery messages to private `data/mail/*.json` files. No external mail is sent in that mode. Open the saved link locally to exercise the flow. This is not production email delivery.

The current points pilot enables registration with `REGISTRATION_ENABLED=true` and `REQUIRE_VERIFICATION=false`. New accounts can sign in and play immediately; their addresses remain unverified. No verification email is sent. With no SMTP provider, password recovery reports that it is unavailable. Players must retain their passwords.

To enable email verification later, configure `SMTP_URL` and `MAIL_FROM`, test delivery and recovery to real inboxes, then set `REQUIRE_VERIFICATION=true`. Production defaults to requiring verification if that variable is omitted. Set `REGISTRATION_ENABLED=false` to pause new accounts independently.

## Production configuration

Copy the fields from `.env.example` into your hosting provider's secret/environment settings. Never commit `.env` or put credentials in the frontend.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Production PostgreSQL connection, using the provider's verified TLS/private-network instructions |
| `APP_ORIGIN` | Exact HTTPS site origin without a trailing slash |
| `NODE_ENV` | `production`; requires PostgreSQL and an HTTPS origin; verified registration also requires email settings |
| `HOST` | `0.0.0.0` for a host-managed service |
| `PORT`, `SERVER_PORT` | Listening port, in that priority order; Botkeep supplies `SERVER_PORT`; local default 3000 |
| `SMTP_URL`, `MAIL_FROM` | SMTP transport and verified sender |
| `REQUIRE_VERIFICATION` | Explicitly `false` for the current pilot; production default is `true` |
| `REGISTRATION_ENABLED` | `true` to accept new accounts; `false` to pause |

`render.yaml` prepares an always-on Node web service with an externally configured PostgreSQL database. It deliberately contains no credentials and creates no paid service by itself. The same source can run in the supplied Docker container behind HTTPS. Botkeep provisioning was attempted using the owner's API key; see [BOTKEEP.md](BOTKEEP.md) for the current result. No hosting subscription was purchased.

Provision an administrator using a trusted administration shell:

```powershell
npm run admin -- owner@example.com
```

Use a real owner address for a public deployment. If a normal account exists, its existing password is retained. Otherwise the command creates an unpredictable password. Setup is written to `data/admin-setup.txt`; it refuses to overwrite an existing setup file. Secure that file before provisioning another admin. Authenticator secrets are private database fields and are never returned by admin APIs.

## Backups and migration

```powershell
npm run db:backup
npm run db:check-backup -- data/backups/YOUR_BACKUP.dump
```

Backups use PostgreSQL tools and are written to private `data/backups/`. The restore check creates a uniquely named temporary database, restores the dump, checks wallet/ledger reconciliation, then removes only that temporary database. It does not restore over the live database. The local restore drill passed. On a managed host use managed backups/PITR and run restore checks from a trusted machine with PostgreSQL tools; `pg_dump` is not included in the Node Docker image.

`npm run db:import` imports the preserved SQLite file only into an empty destination and refuses a destination containing users. Do not run it again against the populated database. Sessions are intentionally excluded.

## Launch status

This delivery is a tested points-based implementation and deployment package. It is not a claim of legal approval, a public deployment, independent security certification or demonstrated large-scale capacity. Before real customers: select hosting and data location, configure domain/HTTPS and actual mail, use a restricted runtime database role, establish backup/monitoring/on-call procedures, provide operator/privacy/grievance contacts and retention/deletion handling, and complete jurisdiction-specific review. The local PostgreSQL owner is for development only.

The existing detailed [product plan](PLAN.md) and [verification record](VERIFICATION.md) contain historical v1 information; the current changes and launch constraints in this README and [LAUNCH.md](LAUNCH.md) supersede that earlier implementation status.
