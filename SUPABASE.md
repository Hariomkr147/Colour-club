# Supabase database operations

The deployment uses the Colour Club project in Mumbai (`ap-south-1`), under Kartavya. The existing Kartavya project is separate. Creation was quoted at $0/month on Free.

The app keeps its existing server-side authentication and sessions. Supabase supplies PostgreSQL; player login does not depend on Supabase Auth.

## Connection and isolation

- Use the project's session pooler on port 5432 for the persistent Node service on IPv4. Copy the actual endpoint from Supabase's Connect panel. Do not infer the host or use transaction-pooler port 6543 with session settings.
- The runtime role `colour_club_app` owns only the private `colour_club` application schema. It cannot create databases or roles and is not a superuser. Its connection limit is 12; the app pool uses at most 10.
- Set `DATABASE_SCHEMA=colour_club`. Each new session receives the schema, a 15-second statement timeout and a 5-second lock timeout before use. This does not depend on poolers forwarding startup options.
- The URL uses `sslmode=verify-full` and `sslrootcert=certs/supabase-ca.crt`. That public certificate was downloaded from the official link in the project's database settings. Keep certificate and hostname verification enabled.
- The public Data API is disabled. Its `anon`, `authenticated` and `service_role` roles have no access to the private app schema. Browser requests pass through the app's authorization checks.
- Store the database URL only in hosting secrets. Passwords, hosting tokens and administrator bootstrap material are excluded from Git.

The root database password was not reset. A separate random application password was generated privately, and its SCRAM verifier provisioned the dedicated role.

## Backups

From a trusted machine with PostgreSQL client tools, the private database URL and `DATABASE_SCHEMA=colour_club`, run `npm run db:backup`.

The archive contains only the application schema and honors the URL's TLS settings. Protect independent copies outside the hosting workload. No automatic off-site backup schedule was configured.

Test the archive against a separate disposable PostgreSQL server with database-creation permission, not against live Supabase. Set `DATABASE_URL` to that separate server, retain `DATABASE_SCHEMA=colour_club`, and run `npm run db:check-backup -- ABSOLUTE_PATH_TO_BACKUP`.

The restore check creates a temporary database, restores the archive, checks wallets against the ledger and removes that temporary database. The restricted live runtime role intentionally cannot create databases. The deployment backup restored successfully to the local test server with zero ledger differences.

## Free-plan limits

Supabase currently includes a 500 MB database and 5 GB egress on Free and can pause projects after a week of inactivity. Continuous rounds and bets accumulate history. Monitor storage, connections and egress; choose an appropriate plan before reaching limits. Never silently delete bets or ledger entries to fit a quota. See [current pricing](https://supabase.com/pricing).

This setup has no certified production concurrency figure. Network distance between Botkeep and Supabase Mumbai affects response time even with more app RAM. Measure traffic before increasing connection limits or adding instances.
