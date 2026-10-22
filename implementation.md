# Owly-inspired Shared To-Do & Remember

## Production implementation plan for Codex

> Build an original product inspired by the publicly described behavior of **Owly: Shared To-Do & Reminders**. Reproduce the useful workflows, not its name, copyrighted copy, artwork, mascot, screenshots, or exact visual design. Use a temporary product name such as **NestList** until final branding is chosen.

## 1. Mission

Build a mobile-first, installable Next.js progressive web application for personal and shared task management. The application must remain genuinely useful without an internet connection after the user has signed in and completed one successful sync. Local changes must be durable, visible immediately, and synchronized with Supabase when connectivity returns.

The product must include:

- Personal tasks and shared Circles for families, couples, friends, or teams.
- Today, Planned, Later, Routines, and From Circles views.
- Shared lists with assignment, completion history, and member activity.
- Quick, Normal, and Deep task sizes plus a daily capacity bar.
- Local natural-language task capture.
- One-time and repeating reminders.
- Recurring routines that appear unchecked on each selected day.
- A postponement review that asks users to do, complete, reschedule, or drop stale tasks.
- Installable PWA behavior, cached application shell, offline reads, offline writes, and automatic reconciliation.
- Supabase Auth, Postgres, Row Level Security, Realtime, Edge Functions, Cron, and Web Push.

## 2. Product truths and platform limitations

1. **Local-first, not cache-only.** Service-worker caching alone is not offline task support. Structured task data and pending mutations live in IndexedDB.
2. **Cloud collaboration needs connectivity.** Users can create, edit, complete, reorder, and postpone already-synced data offline. Invitations, first-time sign-in, remote updates, and cross-device collaboration require internet.
3. **Offline reminders have limits.** When online, server-sent Web Push can notify a closed app. When the app is open offline, a local timer can notify at the due time. A pure PWA cannot guarantee a scheduled notification while the device is offline and the app is fully closed on every browser/OS.
4. **No universal PWA home-screen widgets.** Implement rich in-app dashboard cards and app-icon badges where supported. Treat native iOS/Android widgets and direct Siri integration as future native-wrapper work.
5. **Auth is online; cached work is offline.** A user must authenticate and hydrate data once online. An expired token must pause sync, not destroy local work. Signing out must remove that account's local database from the device after confirming unsynced changes.
6. **Do not cache authenticated API responses in Cache Storage.** Cache the app shell and static assets there; keep user data in the account-scoped IndexedDB database.

## 3. Definition of done

The project is complete only when all of the following are true:

- A new user can register, create a personal task, install the app, reload offline, and still see and edit the task.
- An offline-created task survives browser restart and syncs exactly once when online.
- Two users in one Circle receive each other's changes without manual refresh.
- Replaying the same mutation never creates a duplicate.
- A user cannot read or mutate a Circle unless they are an active member.
- A removed Circle member loses server access immediately and the next successful sync purges that Circle from local storage.
- Personal tasks, shared tasks, routines, recurrence, Later, daily capacity, reminders, snooze, postponement review, search, filtering, and activity history work.
- Web Push opens the correct task and supports `Done` and `Snooze 10 min` actions where the browser supports notification actions.
- Lighthouse PWA checks pass, the app installs on supported desktop/mobile browsers, and an offline navigation renders the app rather than the browser error page.
- Unit, integration, database-policy, sync, and Playwright end-to-end tests pass in CI.
- There are no service-role keys in browser code, no tables without RLS, and no cross-account IndexedDB leakage.

## 4. Recommended stack

Use the latest mutually compatible stable versions at implementation time and commit the lockfile.

| Area          | Choice                                                                               |
| ------------- | ------------------------------------------------------------------------------------ |
| Framework     | Next.js App Router, React, TypeScript in strict mode                                 |
| UI            | Tailwind CSS, shadcn/ui primitives, Lucide icons, CSS variables                      |
| Forms         | React Hook Form + Zod                                                                |
| Server state  | Supabase client only for auth, RPC, Realtime, and online-only operations             |
| Local data    | Dexie + IndexedDB + `dexie-react-hooks`                                              |
| Cloud data    | Supabase Postgres                                                                    |
| Auth          | Supabase Auth with email/password and Google OAuth                                   |
| Realtime      | Supabase private channels/Postgres changes, always protected by RLS                  |
| PWA           | `@serwist/next` + `serwist`; use its current Turbopack guide if Turbopack is enabled |
| Dates         | `date-fns` + `date-fns-tz`                                                           |
| Local parsing | `chrono-node` plus deterministic recurrence and hashtag parsers                      |
| Ordering      | Fractional rank strings; use a small tested ranking utility                          |
| IDs           | Client-generated UUIDs (`crypto.randomUUID()`)                                       |
| Push          | Standards-based Web Push with VAPID from a Supabase Edge Function                    |
| Tests         | Vitest, Testing Library, Playwright, Supabase CLI + pgTAP                            |
| Quality       | ESLint, Prettier, Husky/lint-staged optional, GitHub Actions                         |

Avoid adding a second global state framework unless the existing codebase already uses one. Dexie live queries should drive entity data; React context should contain only session, connectivity, sync status, and UI preferences.

## 5. Repository layout

```text
app/
  (auth)/login/page.tsx
  (app)/layout.tsx
  (app)/today/page.tsx
  (app)/planned/page.tsx
  (app)/later/page.tsx
  (app)/routines/page.tsx
  (app)/circles/page.tsx
  (app)/circles/[circleId]/page.tsx
  (app)/search/page.tsx
  (app)/settings/page.tsx
  (app)/activity/page.tsx
  invite/[token]/page.tsx
  api/push/subscribe/route.ts
  api/push/unsubscribe/route.ts
  manifest.ts
  ~offline/page.tsx
  sw.ts
components/
  app-shell/
  tasks/
  routines/
  circles/
  sync/
  settings/
lib/
  db/client-db.ts
  db/schema.ts
  db/repositories/
  sync/outbox.ts
  sync/push.ts
  sync/pull.ts
  sync/engine.ts
  sync/conflicts.ts
  supabase/browser.ts
  supabase/server.ts
  supabase/middleware.ts
  tasks/parser.ts
  tasks/capacity.ts
  tasks/recurrence.ts
  notifications/
  connectivity.ts
  validation/
supabase/
  migrations/
  functions/send-reminders/
  functions/send-circle-invite/
  functions/push-notification/
  tests/
public/
  icons/
  screenshots/
tests/
  unit/
  integration/
  e2e/
```

## 6. Core domain model

### 6.1 Spaces and Circles

Use a unified `spaces` model:

- A personal space is created automatically for every account and has exactly one member.
- A Circle is a shared space with an owner and one or more active members.
- Lists belong to a space. The first release creates one Inbox list automatically but supports additional lists without a migration later.
- The interface may call shared spaces “Circles,” while code and SQL use `spaces` consistently.

### 6.2 Task buckets

- **Today:** task has `scheduled_date` equal to the user's current local date.
- **Planned:** task has a future `scheduled_date`.
- **Later:** `bucket = 'later'` and `scheduled_date IS NULL`.
- **From Circles:** open Circle tasks assigned to the current user. They are shown separately and do not consume personal capacity by default.
- **Completed:** soft-retained for history; hide by default.
- **Dropped:** intentionally abandoned, not equivalent to deletion.

### 6.3 Effort and daily capacity

Map sizes to points:

- Quick = 1
- Normal = 2
- Deep = 4

Each user has a default daily capacity of 8 points and can override it per date. The Today bar is `scheduled personal open points / capacity`. Use calm colors below 75%, amber from 75–100%, and red over 100%. Never block task creation when capacity is exceeded.

### 6.4 Routines

Do not reset or mutate a single checklist row every midnight. Store a routine template and date-specific completion rows:

- `routines` stores schedule, timezone, title, and active state.
- `routine_items` stores ordered checklist templates.
- `routine_item_completions` stores `(routine_item_id, local_date, completed_by)`.
- A routine appears unchecked on a new eligible date because no completion row exists for that date.
- This preserves history and eliminates midnight/reset race conditions.

### 6.5 Recurring tasks

- Store an RFC 5545-compatible recurrence rule and timezone on a series.
- Materialize a bounded horizon of occurrences, initially 60 days ahead.
- Give every occurrence a deterministic `occurrence_key` and enforce `UNIQUE(series_id, occurrence_key)` so offline replay and cron cannot duplicate it.
- When an occurrence is completed or edited, preserve the series unless the user selects “this occurrence only,” “this and following,” or “entire series.”

## 7. Supabase schema

Create enums for `space_kind`, `member_role`, `member_status`, `task_status`, `task_bucket`, `task_effort`, and `mutation_state`. All timestamps use `timestamptz`; all date-only planning fields use `date`; all user-facing schedules store an IANA timezone.

### Required tables

#### `profiles`

- `id uuid primary key references auth.users(id) on delete cascade`
- `display_name text`
- `avatar_url text`
- `timezone text not null default 'UTC'`
- `locale text not null default 'en'`
- `default_capacity smallint not null default 8 check (default_capacity between 1 and 40)`
- `created_at`, `updated_at`

#### `devices`

- `id uuid primary key`
- `user_id uuid not null`
- `name text`, `platform text`
- `last_seen_at timestamptz`
- `created_at`, `revoked_at`
- unique `(id, user_id)`

#### `spaces`

- `id uuid primary key`
- `kind space_kind not null`
- `name text not null`
- `owner_id uuid not null`
- `color text`, `icon text`
- `created_at`, `updated_at`, `deleted_at`

#### `space_members`

- `space_id uuid not null`
- `user_id uuid not null`
- `role member_role not null default 'member'`
- `status member_status not null default 'active'`
- `joined_at`, `removed_at`
- primary key `(space_id, user_id)`

#### `space_invites`

- `id uuid primary key`
- `space_id uuid not null`
- `email citext`
- `token_hash text not null unique`
- `role member_role not null default 'member'`
- `invited_by uuid not null`
- `expires_at timestamptz not null`
- `accepted_at`, `revoked_at`, `created_at`

Never store a raw invite token; email only the raw value and store its hash.

#### `lists`

- `id uuid primary key`
- `space_id uuid not null`
- `name text not null`
- `color text`, `icon text`, `rank text not null`
- `created_by uuid not null`
- `created_at`, `updated_at`, `deleted_at`

#### `tasks`

- `id uuid primary key`
- `space_id uuid not null`
- `list_id uuid not null`
- `creator_id uuid not null`
- `assignee_id uuid`
- `title text not null check (char_length(title) between 1 and 500)`
- `notes text check (char_length(notes) <= 20000)`
- `status task_status not null default 'open'`
- `bucket task_bucket not null default 'later'`
- `effort task_effort not null default 'normal'`
- `scheduled_date date`
- `remind_at timestamptz`
- `reminder_timezone text`
- `rank text not null`
- `postpone_count integer not null default 0`
- `completed_at`, `completed_by`, `dropped_at`, `deleted_at`
- `version bigint not null default 1`
- `created_at`, `updated_at`

Add checks so Later has no scheduled date, completed fields agree with completed status, and an assignee must be an active member of the task's space. Enforce cross-table rules inside the mutation RPC, not only in the client.

#### `task_revisions`

- `id bigint generated always as identity primary key`
- `task_id uuid not null`
- `version bigint not null`
- `actor_id uuid not null`
- `device_id uuid`
- `mutation_id uuid`
- `changed_fields text[] not null`
- `before jsonb`, `after jsonb`
- `created_at timestamptz not null default now()`
- unique `(task_id, version)`

Retain detailed revisions for 30 days, then compact old revisions into activity summaries.

#### `task_series`

- `id uuid primary key`
- `space_id`, `list_id`, `creator_id`, `assignee_id`
- `title`, `notes`, `effort`
- `rrule text not null`
- `timezone text not null`
- `start_at timestamptz not null`
- `until_at timestamptz`
- `active boolean not null default true`
- `created_at`, `updated_at`, `deleted_at`

Add `series_id` and `occurrence_key` to `tasks` with a partial unique index.

#### `routines`

- `id uuid primary key`
- `space_id uuid not null`
- `title text not null`
- `timezone text not null`
- `days_of_week smallint[] not null`
- `active boolean not null default true`
- `rank text not null`
- `created_by`, `created_at`, `updated_at`, `deleted_at`

#### `routine_items`

- `id uuid primary key`
- `routine_id uuid not null`
- `title text not null`
- `notes text`
- `reminder_local_time time`
- `assignee_id uuid`
- `rank text not null`
- `created_at`, `updated_at`, `deleted_at`

#### `routine_item_completions`

- `routine_item_id uuid not null`
- `local_date date not null`
- `completed_by uuid not null`
- `completed_at timestamptz not null`
- primary key `(routine_item_id, local_date)`

#### `daily_capacity_overrides`

- `user_id uuid not null`
- `local_date date not null`
- `capacity smallint not null check (capacity between 1 and 40)`
- primary key `(user_id, local_date)`

#### `push_subscriptions`

- `id uuid primary key`
- `user_id uuid not null`
- `device_id uuid not null`
- `endpoint text not null unique`
- `p256dh text not null`
- `auth text not null`
- `user_agent text`
- `created_at`, `last_used_at`, `revoked_at`

#### `notification_deliveries`

- `id uuid primary key`
- `user_id uuid not null`
- `task_id uuid`
- `routine_item_id uuid`
- `kind text not null`
- `scheduled_for timestamptz not null`
- `status text not null`
- `attempt_count integer not null default 0`
- `last_error text`
- `sent_at`, `created_at`
- unique `(user_id, task_id, routine_item_id, kind, scheduled_for)` with a NULL-safe implementation

#### `processed_mutations`

- `mutation_id uuid primary key`
- `user_id uuid not null`
- `device_id uuid not null`
- `entity_type text not null`
- `entity_id uuid not null`
- `result jsonb not null`
- `processed_at timestamptz not null default now()`

This is the server-side idempotency ledger.

#### `change_log`

- `sequence bigint generated always as identity primary key`
- `space_id uuid not null`
- `entity_type text not null`
- `entity_id uuid not null`
- `operation text not null`
- `payload jsonb`
- `actor_id uuid`
- `created_at timestamptz not null default now()`

Use triggers to append a change after an accepted mutation. Keep soft-deletion tombstones long enough for every active device to receive them; start with 90 days.

#### `sync_conflicts`

- `id uuid primary key`
- `user_id`, `device_id`, `space_id`, `entity_type`, `entity_id`
- `mutation_id uuid not null`
- `overlapping_fields text[] not null`
- `server_before jsonb`, `client_patch jsonb`, `resolved_value jsonb`
- `resolution text not null`
- `created_at`, `reviewed_at`

## 8. Row Level Security and authorization

Enable RLS on every public table before exposing the API.

Create helper functions such as:

- `is_active_space_member(space_id uuid, user_id uuid default auth.uid())`
- `is_space_owner(space_id uuid, user_id uuid default auth.uid())`
- `can_edit_task(task_id uuid, user_id uuid default auth.uid())`

Mark only carefully audited helpers as `security definer`; set an empty or explicit safe `search_path`, schema-qualify every object, and never accept a caller-supplied user ID as authority.

Permission matrix:

| Action                | Personal space | Circle owner/admin      | Circle member             |
| --------------------- | -------------- | ----------------------- | ------------------------- |
| Read space data       | Owner          | Yes                     | Yes                       |
| Add task              | Owner          | Yes                     | Yes                       |
| Edit task fields      | Owner          | Yes                     | Own task or assigned task |
| Complete/reopen task  | Owner          | Yes                     | Yes                       |
| Assign a task         | Owner          | Yes                     | Active members only       |
| Delete any task       | Owner          | Owner only by default   | No                        |
| Invite/remove members | N/A            | Owner; admin may invite | No                        |
| Delete Circle         | N/A            | Owner only              | No                        |

Use soft delete in routine application flows. Do not depend on UI hiding for authorization. Run pgTAP tests as Alice, Bob, a removed member, and an unrelated user for every policy.

The browser receives only `NEXT_PUBLIC_SUPABASE_URL` and the publishable key. Never expose the secret/service-role key. Edge Functions may use elevated credentials only after authenticating the caller or validating a trusted Cron secret.

## 9. Offline-first client database

Create one IndexedDB database per authenticated user, for example `nestlist:<user-id>:v1`. It contains:

- `spaces`, `spaceMembers`, `lists`, `tasks`, `taskSeries`
- `routines`, `routineItems`, `routineCompletions`
- `capacities`, `activity`
- `outbox`
- `syncState`
- `conflicts`
- `meta`

Every mirrored entity includes `_serverVersion`, `_syncStatus`, `_lastMutationId`, and `_deleted` client metadata.

### Outbox record

```ts
type OutboxMutation = {
  mutationId: string;
  deviceId: string;
  userId: string;
  spaceId: string;
  entityType:
    "task" | "routine" | "routineItem" | "routineCompletion" | "capacity";
  entityId: string;
  operation:
    "create" | "patch" | "complete" | "reopen" | "drop" | "delete" | "reorder";
  baseVersion: number | null;
  patch: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  state: "pending" | "sending" | "blocked" | "failed";
  lastError?: string;
};
```

### Local mutation transaction

Every write must execute one Dexie transaction that:

1. Validates the command with Zod.
2. Updates the local entity optimistically.
3. Adds one immutable mutation to the outbox.
4. Updates derived local indexes/counters if necessary.
5. Commits before the UI reports success.

Never perform a Supabase request first and then update IndexedDB. UI components must call repository commands and read through Dexie live queries; they must not write directly to Supabase.

### Sync triggers

Attempt sync when any of these occurs:

- App boot after session recovery.
- `online` event.
- Window/PWA regains focus.
- A local mutation is committed while online, debounced by 300–500 ms.
- A 30-second foreground interval is active.
- A supported browser fires a Background Sync event.
- A Realtime event says a visible space changed.

Background Sync is an enhancement, not a correctness dependency. The foreground engine must always be enough.

### Push phase

1. Lock the sync engine with Web Locks when supported and a lease row fallback otherwise.
2. Read up to 100 pending mutations in creation order.
3. Call one `push_mutations(device_id, batch jsonb)` Supabase RPC.
4. The RPC validates membership, permissions, field schemas, and base versions inside a database transaction.
5. It checks `processed_mutations` first and returns the prior result for duplicate IDs.
6. Apply accepted server values back into IndexedDB and remove acknowledged outbox rows in one Dexie transaction.
7. Keep permission failures blocked for user review; retry transient network/5xx failures with capped exponential backoff and jitter.

### Pull phase

1. Read the per-user `lastSequence` cursor.
2. Call `pull_changes(cursor, limit)` in pages.
3. The RPC derives the user from `auth.uid()`, returns only currently authorized changes, the next cursor, and the complete set of currently accessible space IDs.
4. Merge each page into IndexedDB in one transaction.
5. Purge any locally cached shared space missing from `accessible_space_ids`, except unsynced personal drafts; move blocked drafts to a local recovery view.
6. Advance the cursor only after the page transaction commits.
7. Repeat until `has_more = false`.

Use Realtime only as a low-latency “something changed” signal that starts pull. The change log and cursor remain the source of truth because WebSocket delivery is not a durable sync protocol.

## 10. Conflict resolution

Mutations carry `baseVersion` and field-level patches, never whole-row replacements.

Server behavior:

- If `baseVersion` matches, apply the patch and increment `version`.
- If stale, inspect `task_revisions` after `baseVersion`.
- If server and client changed disjoint fields, merge automatically.
- If fields overlap, apply the later-arriving client patch for normal scalar fields, record a `sync_conflicts` row, and show a non-blocking “Review synced changes” item.
- Deletion/tombstone wins over ordinary edits. Only an authorized restore command may revive it.
- Membership, ownership, and security fields are server-authoritative and never use client-wins.
- Completion commands are idempotent. A deliberate later reopen command may reverse completion.
- Reordering changes only `rank`; a concurrent reorder uses the last accepted rank and never overwrites task content.
- Routine completion is a unique set-like operation, so repeated completion converges naturally.

When a rejected offline edit cannot be applied because access was removed, preserve a plain-text recovery copy locally and tell the user exactly what was not synced.

## 11. PWA and service worker

Implement `app/manifest.ts` with:

- name, short name, description, start URL, and `display: 'standalone'`
- theme/background colors
- 192px and 512px icons, including maskable variants
- app shortcuts to Today, Quick Add, and Later
- screenshots for richer installation prompts where supported

Use Serwist to:

- Precache the minimum application shell and `/~offline`.
- Cache versioned JS/CSS/fonts with cache-first behavior.
- Use stale-while-revalidate for safe public assets.
- Use network-first for document navigation with the offline fallback.
- Never runtime-cache Supabase Auth, REST, RPC, Realtime, invite, or mutation responses.
- Clean old caches after activation.
- notify clients when a new build is waiting and let the user select “Update now.”

Request `navigator.storage.persist()` after installation or after the user creates meaningful data. Display storage use and pending-sync count in Settings. Explain that clearing browser/site data removes the offline copy.

Register a `nestlist-sync` background-sync tag when the outbox is nonempty and the API exists. Also sync on foreground events because Background Sync support and timing vary.

## 12. Authentication and account lifecycle

- Use `@supabase/ssr` for server/browser clients and middleware-based session refresh.
- Offer email/password and Google sign-in. Email verification and password reset are online-only.
- On first login, create the profile, device, personal space, membership, and Inbox in one idempotent database function.
- Complete initial hydration before displaying “Ready offline.”
- Namespace all local data by authenticated user ID.
- If the token expires while offline, allow access to that account's already-unlocked local workspace and pause sync with a clear status.
- On reconnect, refresh the session before pushing mutations.
- On sign-out with pending mutations, offer: “Sync then sign out,” “Export unsynced changes,” or “Discard local changes.” Do not silently destroy the outbox.
- After confirmed sign-out, remove that user's IndexedDB database, unregister their push subscription from the server when online, and clear account-specific caches.
- Add optional local app-lock PIN as a post-MVP feature. Do not claim IndexedDB is encrypted at rest by the application in the MVP.

## 13. Task capture and natural-language parsing

Parsing must run locally, without an LLM or network call.

Examples:

- `Call mum tomorrow 9am`
- `rent every month`
- `milk #groceries`
- `Send report Friday 5pm @Asha deep`

Parser pipeline:

1. Extract an explicit `#list` token.
2. Extract an `@assignee` only when it uniquely matches an active space member.
3. Parse date/time locally with `chrono-node` using the user's locale and timezone.
4. Parse recurrence phrases into a supported RRULE subset.
5. Parse effort aliases: `quick`, `normal`, `deep`.
6. Keep the remaining text as the task title.
7. Show parsed chips before save and allow one-tap correction.

Never silently pick among duplicate member names. Unsupported or ambiguous recurrence text remains part of the title and prompts the user to choose a schedule.

## 14. Reminder and push system

### Browser setup

- Ask for notification permission only after the user enables reminders or creates the first timed task.
- Register a Web Push subscription with the public VAPID key.
- Send the subscription to an authenticated server route or Edge Function.
- Store one subscription per device/browser endpoint.
- Expire subscriptions on `404` or `410` from the push provider.

### Scheduling

- Supabase Cron invokes `send-reminders` every minute.
- The function claims due, unsent deliveries using a database transaction/locking strategy.
- It sends only to the task assignee; personal tasks go to the owner.
- It records each attempt and is idempotent through the delivery unique key.
- Store due instants in UTC and preserve the source IANA timezone for display and recurrence calculation.

### Notification actions

- Default click opens `/today?task=<id>`.
- `Done` posts an idempotent completion command when online; if offline, pass the command to an open client or persist it to IndexedDB from the service worker.
- `Snooze 10 min` creates a new reminder instant and idempotency key.
- If browser action buttons are unsupported, clicking the notification opens the task sheet with these actions visible.

### Offline behavior

- While the app is open, schedule timers for the next due reminder and rescan after wake/focus.
- When fully closed and offline, show no false guarantee. The reminder appears once a network connection permits server push, depending on OS/browser behavior.

## 15. Screens and interactions

### App shell

- Desktop: left navigation, main content, optional detail panel.
- Mobile: top context bar, bottom navigation for Today, Planned, Later, Circles, and More.
- Persistent floating Quick Add button on mobile.
- Global sync indicator: `Synced`, `Syncing`, `Offline — N changes saved`, `Action needed`.
- Respect safe areas, reduced motion, keyboard navigation, and 44px touch targets.

### Today

- Greeting/date and daily capacity bar.
- Sections: Personal, From Circles, and Routines.
- Inline add with natural-language chips.
- Swipe or context actions: complete, tomorrow, Later, edit.
- Over-capacity state offers moving tasks but does not shame or block.

### Planned

- Seven-day strip plus grouped future dates.
- Dragging is optional; every action must have an accessible menu equivalent.
- Unscheduled recurring series can be edited from this view.

### Later

- Backlog without dates.
- Multi-select schedule action.
- Sort by manual rank, age, effort, or list.

### Routines

- Routine cards with today's checklist progress.
- Builder for title, selected weekdays, timezone, items, order, assignee, and optional local reminder time.
- Calendar/history view derived from completion rows.

### Circles

- Circle cards show member avatars, open count, and pending assignments.
- Circle detail has tasks, members, activity, and settings tabs.
- Invite by expiring email link; accept flow requires online authentication.
- Show who created, completed, reassigned, or postponed an item.

### Task sheet

- Title, notes, list, assignee, date/bucket, reminder, effort, recurrence, activity, and destructive actions.
- Auto-save locally with a visible saved/sync state.
- Deletion confirmation explains Circle-owner rules.

### Search and filters

- Search local IndexedDB so it works offline.
- Filters: status, date, list/Circle, assignee, effort, and creator.
- Normalize text for case-insensitive search; avoid sending search terms to external services.

### Settings

- Profile, timezone, default capacity, week start, theme.
- Notifications and per-device subscription state.
- Offline storage status, last sync, pending outbox, retry action.
- Export local data as JSON and tasks as CSV.
- Account sign-out and deletion flows.

## 16. Postponement review

Increment `postpone_count` only when an open task moves to a later calendar date or from Today to Later. Do not increment for timezone correction or list reordering.

At a threshold of 3 postponements, add the task to a daily review queue. Present:

- Do it today
- Mark done
- Pick a realistic date
- Move to Later
- Drop it

The user can dismiss the prompt for the current day. Never automatically delete a task.

## 17. Accessibility and visual direction

Create an original calm, warm productivity UI; do not imitate Owly's screenshots or artwork.

- WCAG 2.2 AA contrast.
- Full keyboard and screen-reader support.
- Visible focus rings and semantic buttons/checkboxes.
- Status is never conveyed by color alone.
- Support light, dark, and system themes.
- Use restrained motion and honor `prefers-reduced-motion`.
- Use optimistic transitions under 150 ms; never hide pending sync state.
- Empty states should explain the next useful action in one sentence.

## 18. Server functions and RPC contracts

Implement and test these contracts:

### `bootstrap_user()`

Idempotently creates profile defaults, device registration support, personal space, owner membership, and Inbox. Returns all bootstrap IDs.

### `push_mutations(p_device_id uuid, p_batch jsonb)`

Returns ordered results:

```ts
type PushResult = {
  mutationId: string;
  status: "accepted" | "duplicate" | "conflict" | "forbidden" | "invalid";
  entityType: string;
  entityId: string;
  serverVersion?: number;
  serverEntity?: unknown;
  conflictId?: string;
  message?: string;
};
```

Limit batch size and JSON payload, validate every field, and guarantee that one invalid item does not ambiguously acknowledge another. Prefer per-item savepoints or return a whole-batch failure before any application if atomic semantics are selected; document and test the chosen behavior.

### `pull_changes(p_cursor bigint, p_limit integer)`

Returns:

```ts
type PullPage = {
  changes: Array<{
    sequence: number;
    spaceId: string;
    entityType: string;
    entityId: string;
    operation: "upsert" | "delete";
    payload: unknown;
  }>;
  nextCursor: number;
  hasMore: boolean;
  accessibleSpaceIds: string[];
  serverTime: string;
};
```

Clamp the limit, derive identity from JWT, and ensure removed members cannot retrieve old payloads through the change log.

### `accept_space_invite(p_raw_token text)`

Hashes the token, checks expiration/revocation/email constraints, adds or reactivates membership, marks the invite accepted, and returns the Circle ID in one transaction.

### `claim_due_notifications(p_limit integer)`

Server-only function that atomically claims due reminders and prevents concurrent Cron workers from double-sending.

## 19. Security checklist

- RLS enabled and tested for every exposed table/view/function.
- Publishable key only in client code; service credentials only in server/Edge secrets.
- Content Security Policy, `nosniff`, frame restrictions, referrer policy, and strict service-worker cache headers.
- Validate redirects and OAuth callback origins.
- Hash invite tokens and rate-limit invitation creation/acceptance.
- Validate task lengths, enum values, UUID ownership, and batch size server-side.
- Escape/sanitize displayed content; task notes are plain text in v1, not arbitrary HTML.
- Web Push payloads contain minimal data and no private note bodies on lock screens.
- Audit member removal, owner transfer, invite actions, task deletion, and account deletion.
- Add abuse limits for invites, push subscriptions, and mutation throughput.
- Dependency audit and secret scan in CI.
- Account deletion removes cloud data according to documented retention and clears the active device's local copy.

## 20. Testing strategy

### Unit

- Natural-language parsing with locale/timezone fixtures.
- Capacity math and From Circle exclusion.
- Recurrence and DST boundaries.
- Rank generation/rebalancing.
- Outbox state transitions and retry backoff.
- Conflict merge rules.
- Routine eligibility and completion by local date.

### Database/pgTAP

- Every RLS allow and deny path.
- Removed-member access.
- Assignee membership constraint.
- Duplicate mutation replay.
- Stale base-version merge/conflict behavior.
- Change-log filtering and tombstones.
- Concurrent reminder claiming.
- Invite expiration and single use.

### Integration

- Dexie entity update and outbox insertion are atomic.
- Push acknowledgement removes only acknowledged mutations.
- Pull cursor advances only after local commit.
- Mid-sync network failure resumes safely.
- Expired auth pauses sync and preserves data.
- Space revocation purges cached data.

### Playwright E2E

1. Register, bootstrap, and create tasks.
2. Installability/manifest and service-worker checks.
3. Go offline, reload, create/edit/complete, close, reopen, and verify persistence.
4. Reconnect and verify exactly-once cloud state.
5. Two browser contexts collaborate in one Circle.
6. Revoke a member and verify access/purge.
7. Complete and snooze from a notification-compatible test harness.
8. Test mobile viewport, keyboard-only navigation, dark theme, and reduced motion.

For offline E2E tests, disconnect the browser context/network at the OS or Playwright routing level and verify service-worker behavior explicitly; do not rely only on a page-level DevTools offline toggle.

## 21. Observability

- Structured logs with request ID, user ID hash, device ID hash, mutation count, result status, and duration; never log task text or raw push subscriptions.
- Metrics: sync success rate, pending-outbox age, duplicate replay count, conflict rate, reminder delay, push failure rate, and Realtime reconnect count.
- Error reporting must scrub task content and auth tokens.
- Add a user-visible diagnostics export containing versions, timestamps, counts, and error codes but no private task bodies unless explicitly included by the user.

## 22. Phased implementation order

### Phase 0 — Foundation

- Scaffold Next.js, strict TypeScript, UI tokens, lint/test/CI.
- Configure Supabase local development and migrations.
- Add Auth, protected app layout, bootstrap RPC, and account-scoped Dexie database.

Exit: user can sign in and see an empty personal Inbox.

### Phase 1 — Personal local-first tasks

- Implement repositories, outbox, tasks, Today/Planned/Later, effort, capacity, search, and offline shell.
- Implement `push_mutations`, `pull_changes`, cursoring, retry, and sync status.

Exit: full personal CRUD works through browser restart while offline and syncs exactly once.

### Phase 2 — Circles and collaboration

- Add spaces/members/invites, permission matrix, shared views, activity, Realtime sync triggers, revocation purge, and conflict review.

Exit: two accounts collaborate safely online and after independent offline edits.

### Phase 3 — Routines and recurrence

- Add routine templates/completions, recurring series, occurrence generation, DST tests, and history.

Exit: routines reset by date without destructive mutation and recurring tasks never duplicate.

### Phase 4 — Notifications

- Add device subscriptions, Web Push, Cron, delivery ledger, snooze/done actions, and local foreground reminders.

Exit: correct assignee receives one notification per due event and duplicate Cron execution is harmless.

### Phase 5 — Polish and release

- Postponement review, export, onboarding, accessibility audit, performance, storage persistence prompt, update flow, diagnostics, and production security review.

Exit: all Definition of Done items and release checklist pass.

Do not begin a later phase while an earlier phase's data integrity or RLS tests are failing.

## 23. Environment variables

Provide `.env.example` with placeholders only:

```dotenv
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_VAPID_PUBLIC_KEY=

# Server/Edge only; never prefix with NEXT_PUBLIC_
SUPABASE_SECRET_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:admin@example.com
CRON_SHARED_SECRET=
```

Use the current Supabase key names shown by the target project. Support legacy `anon`/service-role naming only if the existing project requires it, and keep elevated credentials server-only.

## 24. Required documentation

Create and maintain:

- `README.md`: setup, local Supabase, commands, deployment, and supported browsers.
- `docs/architecture.md`: local-first data flow and boundaries.
- `docs/sync-protocol.md`: mutation formats, cursor behavior, conflict rules, and recovery.
- `docs/security.md`: RLS matrix, secrets, threat model, and offline-data caveats.
- `docs/pwa.md`: caching strategies, update lifecycle, notification limitations, and testing.
- `docs/runbook.md`: failed sync, stuck Cron, push failures, restore, and migration rollback.

## 25. Codex execution rules

1. Inspect the existing repository before scaffolding; preserve compatible code and user changes.
2. Write migrations rather than editing a live schema manually.
3. Implement vertical slices and keep the app runnable after every phase.
4. Put all entity writes through local repositories and the outbox.
5. Never bypass RLS from browser code.
6. Do not invent successful sync states; display acknowledged state only after the local acknowledgement transaction commits.
7. Add tests with every feature, especially RLS and offline replay.
8. Run format, lint, typecheck, unit tests, database tests, production build, and relevant Playwright tests before declaring completion.
9. If credentials are missing, finish all local work, document the exact missing values, and stop only at the deployment step that truly requires them.
10. Do not clone Owly's branding or interface. Deliver the behavior with an original product identity and design system.

## 26. Final release checklist

- [ ] Fresh install and database migration succeed.
- [ ] No secrets are committed.
- [ ] All tables/functions have reviewed RLS or justified server-only access.
- [ ] Personal flow works offline after first sync.
- [ ] Shared offline edits converge without duplicates.
- [ ] Revoked access is enforced and cached data is purged on reconnect.
- [ ] Recurrence passes DST/month-end/leap-year cases.
- [ ] Reminder delivery is idempotent and assigned correctly.
- [ ] Manifest, icons, maskable icons, offline route, service worker, and update prompt work.
- [ ] Mobile install tested on iOS Safari and Android Chrome where available.
- [ ] Accessibility and keyboard checks pass.
- [ ] Lighthouse, lint, typecheck, tests, and production build pass.
- [ ] Backup, rollback, privacy, account deletion, and incident runbooks are documented.

## 27. Acceptance scenarios

### Scenario A — Offline personal planning

Aditya signs in at home, completes initial sync, installs the PWA, then loses internet. He creates three tasks, moves one to Later, completes another, closes the app, and opens it again. All changes are present. When internet returns, the header changes from `Offline — 4 changes saved` to `Synced`, and Supabase contains exactly the final three task records with no duplicate operations.

### Scenario B — Shared Circle

User A creates a Family Circle and assigns “Buy medicine” to User B for 7 PM. User B sees it in From Circles, gets the reminder on their subscribed device, and completes it. Both users see who completed it. The task does not consume User B's personal daily-capacity bar unless they explicitly enable that preference.

### Scenario C — Concurrent edits

User A edits a task title offline while User B changes its due date online. On reconnect, both changes merge because they touch different fields. If both edited the title, the latest accepted patch becomes visible, a conflict record is retained, and the affected user can review both values.

### Scenario D — Access removal

A Circle owner removes User B while User B is offline. User B can still see the stale local copy until reconnect, a documented offline limitation. On reconnect, server writes are rejected, the Circle is purged locally, and any blocked draft is offered as recoverable plain text rather than silently lost.

### Scenario E — Daily routine

A weekday Morning Routine contains Water, Medication, and Plan Day. Completing an item creates a completion for the user's local date. At the next eligible local day the checklist appears unchecked without deleting yesterday's history or requiring a midnight job.

---

This plan deliberately separates installability, offline application data, durable synchronization, Realtime hints, and reminder delivery. Keeping those concerns separate is what makes the result dependable rather than merely appearing offline-capable.
