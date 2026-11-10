# Deploy Colour Club on Botkeep

Source: [Hariomkr147/Colour-club](https://github.com/Hariomkr147/Colour-club), branch `main`.

## Which host?

The authenticated plan API reports **2,048 MB RAM, 2,048 MB disk, five workload slots and 150% CPU** on Founder Free. These are shared account limits. The API reports 2 GB disk rather than the owner's earlier estimate of 20 GB.

The owner confirmed on 10 November 2026 that Botkeep support permits this points-only browser game. [Terms](https://botkeep.cloud/terms).

## Deployment attempt, 10 November 2026

The owner's API key authenticated successfully against the provider's documented [developer API](https://api.botkeep.cloud/api/v1/developer/openapi.json). Two workloads were created within the free quota:

- `Colour Club Database`: PostgreSQL 18, 1,024 MB RAM, 50% CPU, 1,280 MB disk. Provisioning failed. A supported installation retry returned the same error: **"Recovery is paused to preserve existing configuration. Contact staff to finish installation without overwriting files."** Staff intervention is required; the database is not available.
- `Colour Club App`: Node 24, GitHub import from `main`, 768 MB RAM, 75% CPU, 512 MB disk. Source import and dependency installation completed. Its startup command is deliberately a waiting process until PostgreSQL, the public HTTPS origin and environment settings are ready. No public domain is enabled.

The app is **not live**. Do not treat successful source import or resource creation as a completed deployment. Private API state is retained locally under ignored `data/deployment/`; credentials are not in this repository. Resolve PostgreSQL provisioning with Botkeep staff, configure the database URL and HTTPS origin, sync the latest commit, then change the app start command to `npm start` and verify the public service.

Botkeep documents continuous Node workloads, PostgreSQL profiles, GitHub imports and shared account resources. Its FAQ says continuous operation is not an uptime SLA. It currently lists European locations; confirm actual placement and data obligations before onboarding Indian customers. [Hosting overview](https://botkeep.cloud/), [deployment documentation](https://botkeep.cloud/docs).

ModelScope Studios can host application demonstrations, including Docker-based projects, but this research did not establish an equivalent current free-plan guarantee for continuous sub-minute scheduling, database durability and account-service uptime. More RAM on a demonstration runtime does not establish that it is a better live game host. Treat it as a preview target until those details are verified. [ModelScope](https://modelscope.ai/), [ModelScope Studio introduction](https://modelscope.cn/posts/434564).

## Suggested allocation for a small points pilot

| Workload | Slot | Starting memory budget |
|---|---|---|
| Node 24 application, API and round processor | 1 | About 768 MB |
| PostgreSQL database | 2 | About 1,024 MB |
| Headroom | No additional process required | Remaining approximately 256 MB |

These are starting budgets to check against the panel's profile minimums and measured usage, not a capacity guarantee. Keep the other three slots unused initially. Avoid installing another worker, Redis or a second application instance just to use all slots. Reserve disk space for database growth, logs and backups; do not allocate the entire disk to the app.

## 1. Create the database

Create a PostgreSQL workload using a supported version (the app was tested against PostgreSQL 18). Record the host, assigned port, database, username and password. Make the database reachable only by the application or a trusted administration machine. Use the provider's verified TLS/private-network configuration; do not disable certificate checking.

Do not upload the laptop's PostgreSQL directory or `.env`. A fresh deployment starts with a new database. If you need the current local test records, use the existing backup/export tools and a deliberate database restore rather than copying live database files.

## 2. Import the app from GitHub

Create a **Node.js** workload, import this repository and select `main` or the release commit. Use **Node 24 or newer**.

Build/install command:

```sh
npm ci --omit=dev
```

Start command:

```sh
npm start
```

The app serves the frontend and API together. It does not require a separate static site. It must run continuously so rounds progress even when nobody is visiting. If the panel only offers a startup command, install dependencies once using its documented installation/console workflow before starting the service.

## 3. Set environment variables in the hosting panel

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `HOST` | `0.0.0.0` |
| `SERVER_PORT` | Supplied by Botkeep; the app reads it when `PORT` is absent |
| `APP_ORIGIN` | The exact externally visible HTTPS origin, e.g. `https://your-domain.example`, with no trailing slash |
| `DATABASE_URL` | The connection URL for the PostgreSQL workload |
| `REGISTRATION_ENABLED` | `true` |
| `REQUIRE_VERIFICATION` | `false` for the current points pilot |
| `SMTP_URL`, `MAIL_FROM` | Leave absent until an email provider is configured |

Store real values in the provider's secrets/settings, not in the repository. The sample `.env.example` contains placeholders only. Operational commands also accept panel-provided environment variables when there is no `.env` file.

Configure the provider's HTTPS/web routing for the allocated app port. Confirm that requests reach the Node service with the configured public Host header. Botkeep's documentation says not to assume arbitrary public ports; a running process alone does not prove that a website is exposed.

The app refuses production startup if its database or HTTPS origin is missing. Email is optional only when verification is explicitly disabled or registration is paused. Without email, password recovery is unavailable; users can still register, log in and play when verification is disabled.

## 4. First start and administrator setup

On startup, the app installs its initial versioned schema and recovers pending rounds. Check the console for successful startup and inspect `/api/health` through the public HTTPS URL.

Using the workload console or another trusted administration shell with the same environment:

```sh
npm run admin -- owner@your-domain.example
```

This is a template address: substitute your actual owner email. The command writes private bootstrap details to `data/admin-setup.txt`. If the runtime working directory is read-only, run the administration command on a trusted machine connected to the same database instead. Do not make the app publicly writable or expose a setup endpoint to work around that restriction.

Privately read the generated setup file, save the password and enrol the authenticator key, then protect/remove the bootstrap material according to your secret-handling policy. Do not publish it as an artifact, screenshot or support attachment. Existing accounts keep their current password; a new administrator receives an unpredictable password. The command refuses to overwrite an existing setup file.

Sign in at `/admin`, then enter an authenticator code. There are no default public admin credentials. The laptop's private admin setup file was intentionally excluded from GitHub.

## 5. Verify before inviting players

- Public `/` and `/api/health` respond through HTTPS.
- Register a test player and confirm immediate sign-in and play without email verification under the pilot configuration.
- Submit one prediction and verify a single debit, a later result and consistent point activity.
- Without SMTP, confirm password recovery reports that it is unavailable. After connecting email, test reset delivery and confirm the old session stops working.
- Admin login requires an authenticator code. Blocking a test user revokes their sessions, prevents new play and records the reason; accepted bets still settle.
- Restart the Node workload and confirm balances/history persist and unfinished rounds recover.
- Export a PostgreSQL backup, keep an independent copy and test restoring it away from the live database. The Node Docker image does not contain PostgreSQL backup tools; use the provider's documented backup process or a trusted client machine.
- Measure latency, resource usage, cutoff bursts and shared-IP rate limits on the actual host. No production user capacity was certified locally.

Keep the launch checks in [LAUNCH.md](LAUNCH.md). This deployment remains points-only; publishing it does not enable payments or cash-out.

## Access tokens and automation

GitHub access was available through the connected account for the source upload; no pasted GitHub token was necessary. This repository is public, so importing its source may not require a GitHub token at all, depending on Botkeep's import workflow.

For hosting automation, use a provider-supported API/connection with a key limited to the intended project. A GitHub token does not grant access to Botkeep or ModelScope. The Botkeep developer API and workload creation permission were verified during this deployment attempt. Do not paste unrestricted tokens into chat or commit them to source.
