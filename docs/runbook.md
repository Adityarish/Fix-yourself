# Runbook

## Sign-in or bootstrap fails

Check that `.env.local` contains the correct Supabase project URL and publishable key, that email signup is enabled, and that `http://localhost:3000/auth/callback` is allowlisted. Inspect the Supabase Auth and Postgres logs without copying tokens into issue reports.

## A task stays pending

Reconnect, reopen or focus the app, then inspect the sync message and the Supabase RPC logs. A blocked mutation remains in the account's IndexedDB outbox with a plain error message. Blocked edits appear as recovery drafts in Settings. Export JSON before clearing site data, then retry after correcting access or authentication.

## Migration repair

Migrations are append-only. Use `supabase migration list` to compare local and remote history, then add a corrective migration. Do not edit an already-applied migration or apply schema changes manually in production.

## Recurrence and retention jobs

Check `cron.job_run_details` for `nestlist-recurring-horizon` and `nestlist-retention-maintenance`. The recurrence job is idempotent through the unique `(series_id, occurrence_key)` index. Retention compacts task revisions older than 30 days into `activity_summaries` before deletion and removes change-log rows older than 90 days. Do not delete the summaries during a routine repair.

## Push delivery

Check the Cron run, `notification_deliveries` status/attempt count, active `push_subscriptions`, and Edge logs without copying endpoints or keys. A `404`/`410` revokes that endpoint. Re-run failed deliveries by setting an eligible row to `failed`; the claimant uses row locks and caps attempts at six.

## Backup and restore

Use Supabase point-in-time recovery or scheduled Postgres backups. Test restores in a separate project, apply newer migrations, and compare row counts before changing application configuration. IndexedDB is a working copy and is never the cloud backup.

## Rollback

Deploy the previous application and Edge Function version first. Add a forward corrective migration for schema changes; never rewrite applied migrations. Keep tombstones and change-log rows during rollback so clients do not resurrect deleted data.

## Privacy and account deletion

Settings exports tasks as JSON/CSV. Account deletion uses an authenticated server route and Supabase Admin deletion, which cascades owned rows, then removes the active account database from the device. Review shared-content retention and legal requirements before production launch.

## Incident response

Rotate affected server secrets, revoke push endpoints/devices, pause Cron if notifications are misrouted, preserve scrubbed logs and request IDs, and notify affected users. Never log task bodies, OAuth tokens, VAPID keys, or raw invitation tokens.
