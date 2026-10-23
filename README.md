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
4. Run `npm run dev -- --hostname localhost` and open `http://localhost:3000`.
5. Add `http://localhost:3000/auth/callback`, `http://localhost:3000/auth/confirm`, and `http://localhost:3000/auth/email-confirm` to the Supabase Auth redirect allowlist. Email sign-in uses a one-time link and creates new users automatically. Copy [`supabase/email-templates/magic-link.html`](supabase/email-templates/magic-link.html) into **Supabase Dashboard → Authentication → Email Templates → Magic Link** and use the subject `Your secure NestList sign-in`. The template sends both a token-hash link (which does not depend on the requesting browser's PKCE cookie) and a one-time code that can be entered inside an installed PWA. Its first page does not consume the token, protecting the link from automatic mail security scanners.
6. For Google sign-in with hosted Supabase, create a **Web application** OAuth client in Google Auth Platform. Add `http://localhost:3000` as an Authorized JavaScript origin. Add the exact Supabase callback shown on the Supabase Google provider page as an Authorized redirect URI; it has the form `https://<project-ref>.supabase.co/auth/v1/callback`. Then enter the Google Client ID and Client Secret in **Supabase Dashboard → Authentication → Providers → Google** and turn the provider on. Keep the app callback URLs from step 5 in **Supabase Dashboard → Authentication → URL Configuration**. The Google redirect must go through the hosted Supabase domain even though the application itself consistently uses `localhost`.

The first authenticated load calls `bootstrap_user()`, which idempotently creates a profile, device, personal space, owner membership, and Inbox. One successful hydration unlocks that account's offline workspace.

## Commands

- `npm run dev` / `npm run build` / `npm start` — develop, build, and serve the Next.js app.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm test` — application quality checks.
- `npm run test:e2e` — Playwright desktop and mobile public-shell checks. Authenticated collaboration scenarios require test accounts in the target CI environment.
- `npm run supabase:start`, `npm run db:reset`, `npm run db:test`, `npm run supabase:stop` — local database lifecycle and pgTAP policy checks.

## Push and scheduled reminders

Generate a VAPID key pair and store the public key in `NEXT_PUBLIC_VAPID_PUBLIC_KEY`; keep the private key and subject in Edge Function secrets. Deploy `send-reminders`, `send-circle-invite`, and `push-notification`. Add `project_url` and `cron_shared_secret` to Supabase Vault, then run `supabase/cron/setup.sql` once in the target environment. Cron calls `send-reminders` each minute, extends every active recurring series to a rolling 60-day horizon daily, and runs retention maintenance daily. The delivery ledger, row locks, and unique key keep retries idempotent.

In Settings, a user can install NestList and enable a daily task summary at a chosen local time. The scheduled function groups every open task planned for that local date into one Web Push notification and sends it to the user’s subscribed devices, including an installed PWA while it is closed and online. This notification path uses VAPID Web Push only; SMTP and Gmail are used only for optional Circle invitation emails.

Set these Edge Function secrets in the Supabase project: `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `CRON_SHARED_SECRET`, and optionally `EMAIL_WEBHOOK_URL` plus `EMAIL_WEBHOOK_SECRET`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to deployed functions. Store the same cron secret as Vault secret `cron_shared_secret`, and store the project API URL as Vault secret `project_url`.

For the hosted app, finish Web Push in this order:

1. Generate one VAPID pair with `npx web-push generate-vapid-keys`. Never commit either value.
2. Add the public key as `NEXT_PUBLIC_VAPID_PUBLIC_KEY` in Vercel, then redeploy because public variables are included in the browser bundle.
3. In Supabase Edge Function secrets, set the same `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, its matching `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example `mailto:you@example.com`), and a long random `CRON_SHARED_SECRET`.
4. Deploy `send-reminders` and run [`supabase/cron/setup.sql`](supabase/cron/setup.sql) once after creating the `project_url` and `cron_shared_secret` Vault secrets.
5. Install the production HTTPS app, open **Settings → Notifications**, choose **Enable on this device**, allow the operating-system prompt, and use **Test notification**. Repeat on every phone, tablet, or Mac that should receive notifications.

On iPhone and iPad, Web Push is exposed only to a Home Screen web app: open the production site in Safari, use **Share → Add to Home Screen**, launch NestList from its icon, and then enable notifications. A subscription belongs to one installed browser/device, so permission must be granted separately on each device.

Email delivery uses an optional authenticated `EMAIL_WEBHOOK_URL`. This app includes a receiver at `/api/webhooks/email` that sends valid messages through SMTP. For Gmail, set `SMTP_HOST=smtp.gmail.com`, `SMTP_PORT=465`, `SMTP_SECURE=true`, `SMTP_USER` to the complete Gmail address, and `SMTP_PASSWORD` to a Google App Password. `EMAIL_FROM_ADDRESS` is optional and defaults to `NestList <SMTP_USER>`. Point the Edge Function's `EMAIL_WEBHOOK_URL` to the deployed receiver URL; for local Docker-based Supabase development on macOS, use `http://host.docker.internal:3000/api/webhooks/email`. Generate one `EMAIL_WEBHOOK_SECRET` and give the same value to both runtimes. Without email delivery, Circle invitation links are still created and copied for manual sharing.

For local Gmail setup without placing the App Password in shell history, run `python3 scripts/configure_email.py`, then restart the app.

If localhost returns HTTP 431 after repeated authentication attempts, restart with `python3 run.py`, open `http://localhost:3000/auth/clear-local` once, and sign in again. This recovery route removes accumulated localhost Supabase auth cookies. NestList uses its own `nestlist-auth` cookie name to prevent new sessions from creating project-ref cookie variants.

## Deployment

Apply all migrations before deploying the application. Set public variables at build/runtime and server secrets only in the host secret manager. Deploy the Edge Functions with their configured JWT rules. Add the production site and callback URL to Supabase Auth. Run the complete CI workflow, verify the manifest/service worker over HTTPS, and perform the manual browser matrix in `docs/pwa.md`.

For the current production domain, set the Supabase **Site URL** to `https://tudoooo-tau.vercel.app` and allow `https://tudoooo-tau.vercel.app/auth/callback`, `https://tudoooo-tau.vercel.app/auth/confirm`, and `https://tudoooo-tau.vercel.app/auth/email-confirm` under **Authentication → URL Configuration**. Save the branded Magic Link template after updating these URLs, then request a new email; previously issued one-time links cannot be repaired or reused.

## Supported behavior

The app supports personal and shared tasks, Today/Planned/Later/search, effort capacity, task sheets, local parsing, Circle membership, routine completion by local date, a rolling 60-day recurring-task horizon, reminders, exports, recovery drafts, and conflict records. Detailed task revisions are compacted into daily activity summaries after 30 days, and sync change rows expire after 90 days; full task snapshots keep long-offline clients recoverable. Offline writes work after initial hydration. Invitations, first sign-in, remote collaboration, and server Web Push require connectivity. A fully closed offline PWA cannot guarantee a scheduled notification on every platform.
