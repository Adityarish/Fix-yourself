# Architecture

## Data ownership

Supabase Auth owns identity. Supabase Postgres is the shared source of truth. Each authenticated browser gets a separate Dexie database named `nestlist:<user-id>:v1`; the browser stores spaces, members, lists, tasks, series, routines, completions, capacity overrides, activity, conflicts, recovery drafts, and an immutable mutation outbox there. UI reads use Dexie live queries and local writes commit the entity and outbox row together before displaying success.

The browser uses only the Supabase publishable key. `@supabase/ssr` creates cookie-backed browser and server clients, and `proxy.ts` refreshes sessions. The database migrations enable RLS on every application table. `bootstrap_user()` provisions a personal space and Inbox on the first online session.

## Offline behavior

After one successful sign-in and bootstrap, the service worker can serve its precached application files and `/~offline`. That route reads the last authenticated account ID from local storage, opens only that account's IndexedDB database, and permits local task completion and creation. A local timer is not a guarantee of closed-app notifications. First sign-in, remote updates, Circle collaboration, and token refresh require connectivity.

## Sync flow

1. A repository validates and writes one local entity and one outbox mutation in one IndexedDB transaction.
2. On startup, online, and every 30 seconds while foregrounded, the sync engine sends pending mutations to `push_mutations`.
3. The RPC checks user, device, space membership, entity type, and task field constraints; `processed_mutations` makes a replay idempotent.
4. Accepted server rows replace local rows and their outbox entries are removed in one IndexedDB transaction. Forbidden or invalid mutations remain blocked locally.
5. `pull_changes` returns accessible-space changes and current space membership. The client merges by server version and removes synced rows from spaces no longer accessible.

Realtime task/member events and Background Sync only wake the foreground engine. The cursor RPC remains the durable reconciliation boundary. `workspace_snapshot()` hydrates slow-changing entities and unresolved conflicts; `pull_changes()` advances the ordered cursor and returns the complete accessible-space set used for revocation purge.
