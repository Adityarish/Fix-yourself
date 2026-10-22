# Security notes

- Browser code receives only `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the VAPID public key.
- Never put Supabase secret/service-role credentials in a `NEXT_PUBLIC_` variable or commit them.
- Every public application table has RLS enabled. Access is constrained by the authenticated user's active space membership or own user ID.
- Security-definer RPCs use an empty search path, schema-qualified objects, and `auth.uid()`. Mutation, Circle, invitation, snapshot, and membership functions validate active membership and elevated actions; notification claiming is service-role only.
- Task titles and notes are plain text. Do not render them as HTML.
- The service worker precaches app files and does not runtime-cache API or authenticated responses.
- IndexedDB is account-namespaced but is not encrypted at rest by this application. Signing out asks before discarding unsynced changes, then deletes that account's local database.
- Offline data can remain visible on a shared device until the user signs out or browser storage is cleared.

Security headers include CSP, frame denial, `nosniff`, a strict referrer policy, and a restrictive permissions policy. Invitation tokens are random, only SHA-256 hashes are stored, and creation is rate limited. Push payloads contain a short title and task ID but no notes. Run pgTAP, dependency audit, secret scan, and a production RLS review before using real data.
