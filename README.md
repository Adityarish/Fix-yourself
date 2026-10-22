# NestList

NestList is an original mobile-first shared planner with durable offline tasks, Circles, routines, recurrence, reminders, conflict history, and automatic Supabase reconciliation. Each account has an isolated IndexedDB database; every local write updates the entity and immutable outbox in one transaction before the interface reports success.

## Requirements

- Node.js 22 or newer and npm
- Docker Desktop and Supabase CLI
- A Supabase project for hosted Auth, Realtime, Edge Functions, Cron, and Web Push

## Quick start

Run the app from any directory with:

```bash
python3 /path/to/Waqt-ka-kimat/run.py
```

When run from the project directory, the shorter command is `python3 run.py`. The launcher creates `.env.local` from `.env.example` only when it is missing, installs npm dependencies when needed, and starts Next.js at `http://localhost:3000`. Existing environment files are never overwritten.

Use `python3 run.py --with-supabase` to start the local Supabase stack first. Docker Desktop must be running; the launcher preserves the existing local database and does not reset it. Pass `--no-install` to prevent automatic dependency installation, or `--host` and `--port` to change the development server address.

## Local setup

1. Copy `.env.example` to `.env.local`. Use `supabase status` for the local API URL and publishable key, or use the target project's API settings. Never place the secret key in a public variable.
2. Run `npm install`.
3. Start Docker Desktop, then run `npm run supabase:start`, `npm run db:reset`, and `npm run db:test`.
4. Run `npm run dev` and open `http://localhost:3000`.
5. For Google sign-in, enable the provider in Supabase and add `http://localhost:3000/auth/callback` to the redirect allowlist. For password recovery, allow the same callback URL so its next path can open `/reset-password`.

The first authenticated load calls `bootstrap_user()`, which idempotently creates a profile, device, personal space, owner membership, and Inbox. One successful hydration unlocks that account's offline workspace.

## Commands

- `npm run dev` / `npm run build` / `npm start` — develop, build, and serve the Next.js app.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` — application quality checks.
- `npm run test:e2e` — Playwright desktop and mobile public-shell checks. Authenticated collaboration scenarios require test accounts in the target CI environment.
- `npm run supabase:start`, `npm run db:reset`, `npm run db:test`, `npm run supabase:stop` — local database lifecycle and pgTAP policy checks.

## Push and scheduled reminders

Generate a VAPID key pair and store the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; keep the private key and subject in Edge Function secrets. Deploy `send-reminders`, `send-circle-invite`, and `push-notification`. Add `project_url` and `cron_shared_secret` to Supabase Vault, then run `supabase/cron/setup.sql` once in the target environment. Cron calls `send-reminders` each minute, extends every active recurring series to a rolling 60-day horizon daily, and runs retention maintenance daily. The delivery ledger, row locks, and unique key keep retries idempotent.

Set these Edge Function secrets in the Supabase project: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `CRON_SHARED_SECRET`, and optionally `EMAIL_WEBHOOK_URL` plus `EMAIL_WEBHOOK_SECRET`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. Store the same cron secret as Vault secret `cron_shared_secret`, and store the project API URL as Vault secret `project_url`.

Email delivery uses an optional authenticated `EMAIL_WEBHOOK_URL`. Without it, Circle invitation links are still created and copied for manual sharing.

## Deployment

Apply all migrations before deploying the application. Set public variables at build/runtime and server secrets only in the host secret manager. Deploy the Edge Functions with their configured JWT rules. Add the production site and callback URL to Supabase Auth. Run the complete CI workflow, verify the manifest/service worker over HTTPS, and perform the manual browser matrix in `docs/pwa.md`.

## Supported behavior

The app supports personal and shared tasks, Today/Planned/Later/search, effort capacity, task sheets, local parsing, Circle membership, routine completion by local date, a rolling 60-day recurring-task horizon, reminders, exports, recovery drafts, and conflict records. Detailed task revisions are compacted into daily activity summaries after 30 days, and sync change rows expire after 90 days; full task snapshots keep long-offline clients recoverable. Offline writes work after initial hydration. Invitations, first sign-in, remote collaboration, and server Web Push require connectivity. A fully closed offline PWA cannot guarantee a scheduled notification on every platform.
