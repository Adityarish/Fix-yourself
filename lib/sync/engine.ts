import { getDatabase } from "@/lib/db/client-db";
import { retryDelay } from "@/lib/db/repositories/outbox";
import type { LocalTask, OutboxMutation } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/browser";

type ServerTask = {
  id: string;
  space_id: string;
  list_id: string;
  creator_id: string;
  assignee_id: string | null;
  title: string;
  notes: string | null;
  status: LocalTask["status"];
  bucket: LocalTask["bucket"];
  effort: LocalTask["effort"];
  scheduled_date: string | null;
  remind_at: string | null;
  reminder_timezone: string | null;
  rank: string;
  postpone_count: number;
  completed_at: string | null;
  completed_by: string | null;
  dropped_at: string | null;
  series_id: string | null;
  occurrence_key: string | null;
  created_at: string;
  updated_at: string;
  version: number;
  deleted_at: string | null;
};
type PushResult = {
  mutationId: string;
  status: "accepted" | "duplicate" | "conflict" | "forbidden" | "invalid";
  entityType: string;
  entityId: string;
  serverEntity?: Record<string, unknown>;
  conflictId?: string;
  message?: string;
};
type PullChange = {
  sequence: number;
  spaceId: string;
  entityType: string;
  entityId: string;
  operation: "upsert" | "delete";
  payload: Record<string, unknown> | null;
  actorId?: string | null;
  createdAt?: string;
};
type PullPage = {
  changes: PullChange[];
  nextCursor: number;
  hasMore: boolean;
  accessibleSpaceIds: string[];
  serverTime: string;
};

const inFlight = new Map<string, Promise<void>>();

function toLocalTask(row: ServerTask): LocalTask {
  return {
    id: row.id,
    spaceId: row.space_id,
    listId: row.list_id,
    creatorId: row.creator_id,
    assigneeId: row.assignee_id,
    title: row.title,
    notes: row.notes,
    status: row.status,
    bucket: row.bucket,
    effort: row.effort,
    scheduledDate: row.scheduled_date,
    remindAt: row.remind_at,
    reminderTimezone: row.reminder_timezone,
    rank: row.rank,
    postponeCount: row.postpone_count,
    completedAt: row.completed_at,
    completedBy: row.completed_by,
    droppedAt: row.dropped_at,
    seriesId: row.series_id,
    occurrenceKey: row.occurrence_key,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    version: Number(row.version),
    _serverVersion: Number(row.version),
    _syncStatus: "synced",
    _lastMutationId: null,
    _deleted: Boolean(row.deleted_at),
  };
}

export function syncNow(userId: string, deviceId: string) {
  const current = inFlight.get(userId);
  if (current) return current;
  const work = withSyncLock(userId, () => sync(userId, deviceId)).finally(() =>
    inFlight.delete(userId),
  );
  inFlight.set(userId, work);
  return work;
}

async function withSyncLock(userId: string, callback: () => Promise<void>) {
  if (typeof navigator !== "undefined" && navigator.locks) {
    return navigator.locks.request(`nestlist-sync:${userId}`, callback);
  }
  return callback();
}

async function sync(userId: string, deviceId: string) {
  const db = getDatabase(userId);
  const previous = await db.syncState.get("main");
  if (!navigator.onLine) {
    await db.syncState.put({
      key: "main",
      lastSequence: previous?.lastSequence ?? 0,
      lastSyncedAt: previous?.lastSyncedAt ?? null,
      status: "offline",
    });
    return;
  }
  await db.syncState.put({
    key: "main",
    lastSequence: previous?.lastSequence ?? 0,
    lastSyncedAt: previous?.lastSyncedAt ?? null,
    status: "syncing",
  });
  try {
    const supabase = createClient();
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      await db.syncState.put({
        key: "main",
        lastSequence: previous?.lastSequence ?? 0,
        lastSyncedAt: previous?.lastSyncedAt ?? null,
        status: "auth-paused",
        errorCode: "AUTH_REQUIRED",
      });
      return;
    }
    await hydrateSnapshot(db, supabase);
    await pushPending(db, supabase, deviceId);
    await pullAll(db, supabase);
  } catch (error) {
    const sending = await db.outbox.where("state").equals("sending").toArray();
    const now = Date.now();
    if (sending.length)
      await db.outbox.bulkPut(
        sending.map((item) => ({
          ...item,
          state: "pending" as const,
          nextAttemptAt: new Date(
            now + retryDelay(item.attempts),
          ).toISOString(),
          lastError: "Sync interrupted; it will retry.",
        })),
      );
    const state = await db.syncState.get("main");
    await db.syncState.put({
      key: "main",
      lastSequence: state?.lastSequence ?? 0,
      lastSyncedAt: state?.lastSyncedAt ?? null,
      status: "error",
      errorCode: "SYNC_FAILED",
    });
    throw error;
  }
}

async function hydrateSnapshot(
  db: ReturnType<typeof getDatabase>,
  supabase: ReturnType<typeof createClient>,
) {
  const { data, error } = await supabase.rpc("workspace_snapshot");
  if (error) throw error;
  const snapshot = data as Record<string, unknown>;
  const rows = snapshot as Record<string, Array<Record<string, unknown>>>;
  const profile = snapshot.profile as Record<string, unknown> | null;
  const synced = {
    _serverVersion: 0,
    _syncStatus: "synced" as const,
    _lastMutationId: null,
    _deleted: false,
  };
  await db.transaction(
    "rw",
    [
      db.spaces,
      db.spaceMembers,
      db.lists,
      db.tasks,
      db.taskSeries,
      db.routines,
      db.routineItems,
      db.routineCompletions,
      db.capacities,
      db.conflicts,
      db.meta,
    ],
    async () => {
      if (profile)
        await db.meta.put({
          key: "profile",
          value: {
            displayName: profile.display_name,
            timezone: profile.timezone,
            defaultCapacity: profile.default_capacity,
            weekStartsOn: profile.week_starts_on,
            theme: profile.theme,
            dailyDigestEnabled: profile.daily_digest_enabled,
            dailyDigestTime: String(profile.daily_digest_time ?? "08:00").slice(
              0,
              5,
            ),
          },
        });
      for (const row of rows.spaces ?? [])
        await db.spaces.put({
          id: String(row.id),
          kind: row.kind as "personal" | "circle",
          name: String(row.name),
          ownerId: String(row.owner_id),
          color: row.color as string | null,
          icon: row.icon as string | null,
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          ...synced,
        });
      for (const row of rows.members ?? [])
        await db.spaceMembers.put({
          key: `${row.space_id}:${row.user_id}`,
          spaceId: String(row.space_id),
          userId: String(row.user_id),
          displayName: row.display_name as string | null,
          avatarUrl: row.avatar_url as string | null,
          role: row.role as "owner" | "admin" | "member",
          status: row.status as "active" | "removed",
          joinedAt: String(row.joined_at),
          removedAt: row.removed_at as string | null,
          ...synced,
        });
      for (const row of rows.lists ?? [])
        await db.lists.put({
          id: String(row.id),
          spaceId: String(row.space_id),
          name: String(row.name),
          color: row.color as string | null,
          icon: row.icon as string | null,
          rank: String(row.rank),
          createdBy: String(row.created_by),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          ...synced,
        });
      for (const row of rows.tasks ?? []) {
        const task = toLocalTask(row as unknown as ServerTask);
        const current = await db.tasks.get(task.id);
        if (current?._syncStatus === "pending") continue;
        await db.tasks.put(task);
      }
      for (const row of rows.taskSeries ?? [])
        await db.taskSeries.put({
          id: String(row.id),
          spaceId: String(row.space_id),
          listId: String(row.list_id),
          creatorId: String(row.creator_id),
          assigneeId: row.assignee_id as string | null,
          title: String(row.title),
          notes: row.notes as string | null,
          effort: row.effort as "quick" | "normal" | "deep",
          rrule: String(row.rrule),
          timezone: String(row.timezone),
          startAt: String(row.start_at),
          untilAt: row.until_at as string | null,
          active: Boolean(row.active),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          ...synced,
        });
      for (const row of rows.routines ?? []) {
        const current = await db.routines.get(String(row.id));
        if (current?._syncStatus === "pending") continue;
        await db.routines.put({
          id: String(row.id),
          spaceId: String(row.space_id),
          title: String(row.title),
          timezone: String(row.timezone),
          daysOfWeek: row.days_of_week as number[],
          active: Boolean(row.active),
          rank: String(row.rank),
          createdBy: String(row.created_by),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          ...synced,
        });
      }
      for (const row of rows.routineItems ?? []) {
        const current = await db.routineItems.get(String(row.id));
        if (current?._syncStatus === "pending") continue;
        await db.routineItems.put({
          id: String(row.id),
          routineId: String(row.routine_id),
          title: String(row.title),
          notes: row.notes as string | null,
          reminderLocalTime: row.reminder_local_time as string | null,
          assigneeId: row.assignee_id as string | null,
          rank: String(row.rank),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
          ...synced,
        });
      }
      for (const row of rows.routineCompletions ?? [])
        await db.routineCompletions.put({
          key: `${row.routine_item_id}:${row.local_date}`,
          routineItemId: String(row.routine_item_id),
          localDate: String(row.local_date),
          completedBy: String(row.completed_by),
          completedAt: String(row.completed_at),
          ...synced,
        });
      for (const row of rows.capacities ?? [])
        await db.capacities.put({
          key: `${row.user_id}:${row.local_date}`,
          userId: String(row.user_id),
          localDate: String(row.local_date),
          capacity: Number(row.capacity),
          ...synced,
        });
      for (const row of rows.conflicts ?? [])
        await db.conflicts.put({
          id: String(row.id),
          spaceId: String(row.space_id),
          entityType: String(row.entity_type),
          entityId: String(row.entity_id),
          mutationId: String(row.mutation_id),
          overlappingFields: row.overlapping_fields as string[],
          serverBefore: row.server_before as Record<string, unknown> | null,
          clientPatch: row.client_patch as Record<string, unknown>,
          resolvedValue: row.resolved_value as Record<string, unknown> | null,
          resolution: String(row.resolution),
          createdAt: String(row.created_at),
          reviewedAt: row.reviewed_at as string | null,
        });
    },
  );
}

async function pushPending(
  db: ReturnType<typeof getDatabase>,
  supabase: ReturnType<typeof createClient>,
  deviceId: string,
) {
  while (true) {
    const now = new Date().toISOString();
    const pending = (
      await db.outbox.where("state").equals("pending").sortBy("createdAt")
    )
      .filter((item) => !item.nextAttemptAt || item.nextAttemptAt <= now)
      .slice(0, 100);
    if (!pending.length) break;
    await db.outbox.bulkPut(
      pending.map((item) => ({
        ...item,
        state: "sending" as const,
        attempts: item.attempts + 1,
      })),
    );
    const { data, error } = await supabase.rpc("push_mutations", {
      p_device_id: deviceId,
      p_batch: pending.map(serializeMutation),
    });
    if (error) throw error;
    const results = data as PushResult[];
    await db.transaction(
      "rw",
      [
        db.tasks,
        db.taskSeries,
        db.routines,
        db.routineItems,
        db.routineCompletions,
        db.capacities,
        db.outbox,
        db.conflicts,
        db.recovery,
      ],
      async () => {
        const acknowledged = new Set<string>();
        for (const result of results) {
          const mutation = pending.find(
            (item) => item.mutationId === result.mutationId,
          );
          if (!mutation) continue;
          acknowledged.add(mutation.mutationId);
          if (
            result.status === "accepted" ||
            result.status === "duplicate" ||
            (result.status === "conflict" && result.serverEntity)
          ) {
            await applyAcknowledgement(db, mutation, result.serverEntity);
            await db.outbox.delete(mutation.mutationId);
            if (result.status === "conflict" && result.conflictId)
              await db.conflicts.put({
                id: result.conflictId,
                spaceId: mutation.spaceId,
                entityType: mutation.entityType,
                entityId: mutation.entityId,
                mutationId: mutation.mutationId,
                overlappingFields: [],
                serverBefore: result.serverEntity ?? null,
                clientPatch: mutation.patch,
                resolvedValue: result.serverEntity ?? null,
                resolution: "client_last_write",
                createdAt: new Date().toISOString(),
                reviewedAt: null,
              });
          } else if (
            result.status === "forbidden" ||
            result.status === "invalid"
          ) {
            await db.outbox.put({
              ...mutation,
              state: "blocked",
              lastError: result.message ?? result.status,
            });
            if (result.status === "forbidden")
              await preserveRecovery(
                db,
                mutation,
                result.message ?? "Access was removed.",
              );
          } else {
            await db.outbox.put({
              ...mutation,
              state: "blocked",
              lastError: result.message ?? "Conflict needs review",
            });
            if (result.conflictId)
              await db.conflicts.put({
                id: result.conflictId,
                spaceId: mutation.spaceId,
                entityType: mutation.entityType,
                entityId: mutation.entityId,
                mutationId: mutation.mutationId,
                overlappingFields: [],
                serverBefore: result.serverEntity ?? null,
                clientPatch: mutation.patch,
                resolvedValue: null,
                resolution: "server-recorded",
                createdAt: new Date().toISOString(),
                reviewedAt: null,
              });
          }
        }
        for (const mutation of pending.filter(
          (item) => !acknowledged.has(item.mutationId),
        ))
          await db.outbox.put({
            ...mutation,
            state: "pending",
            nextAttemptAt: new Date(
              Date.now() + retryDelay(mutation.attempts),
            ).toISOString(),
            lastError: "The server did not acknowledge this change.",
          });
      },
    );
    if (
      pending.every((item) =>
        results.some(
          (result) =>
            result.mutationId === item.mutationId &&
            !["accepted", "duplicate"].includes(result.status),
        ),
      )
    )
      break;
  }
}

async function applyAcknowledgement(
  db: ReturnType<typeof getDatabase>,
  mutation: OutboxMutation,
  entity?: Record<string, unknown>,
) {
  if (!entity) return;
  if (mutation.entityType === "task")
    await db.tasks.put(toLocalTask(entity as unknown as ServerTask));
  if (mutation.entityType === "taskSeries")
    await db.taskSeries.update(mutation.entityId, {
      _syncStatus: "synced",
      _lastMutationId: null,
    });
  if (mutation.entityType === "routine")
    await db.routines.update(mutation.entityId, {
      _syncStatus: "synced",
      _lastMutationId: null,
    });
  if (mutation.entityType === "routineItem")
    await db.routineItems.update(mutation.entityId, {
      _syncStatus: "synced",
      _lastMutationId: null,
    });
  if (mutation.entityType === "routineCompletion")
    await db.routineCompletions.update(
      `${mutation.entityId}:${String(mutation.patch.localDate)}`,
      { _syncStatus: "synced", _lastMutationId: null },
    );
  if (mutation.entityType === "capacity")
    await db.capacities.update(
      `${mutation.userId}:${String(mutation.patch.localDate)}`,
      { _syncStatus: "synced", _lastMutationId: null },
    );
}

async function preserveRecovery(
  db: ReturnType<typeof getDatabase>,
  mutation: OutboxMutation,
  reason: string,
) {
  const task =
    mutation.entityType === "task"
      ? await db.tasks.get(mutation.entityId)
      : null;
  await db.recovery.put({
    id: mutation.mutationId,
    spaceId: mutation.spaceId,
    entityType: mutation.entityType,
    entityId: mutation.entityId,
    title: task?.title ?? mutation.entityType,
    body: task?.notes ?? JSON.stringify(mutation.patch),
    reason,
    createdAt: new Date().toISOString(),
  });
}

async function pullAll(
  db: ReturnType<typeof getDatabase>,
  supabase: ReturnType<typeof createClient>,
) {
  let cursor = (await db.syncState.get("main"))?.lastSequence ?? 0;
  let hasMore = true;
  while (hasMore) {
    const { data, error } = await supabase.rpc("pull_changes", {
      p_cursor: cursor,
      p_limit: 200,
    });
    if (error) throw error;
    const page = data as PullPage;
    await db.transaction(
      "rw",
      [
        db.tasks,
        db.spaces,
        db.spaceMembers,
        db.lists,
        db.taskSeries,
        db.routines,
        db.routineItems,
        db.routineCompletions,
        db.capacities,
        db.activity,
        db.conflicts,
        db.outbox,
        db.syncState,
        db.recovery,
      ],
      async () => {
        for (const change of page.changes) await applyChange(db, change);
        await purgeRevokedSpaces(db, new Set(page.accessibleSpaceIds));
        await db.syncState.put({
          key: "main",
          lastSequence: page.nextCursor,
          lastSyncedAt: page.serverTime,
          status: "idle",
        });
      },
    );
    cursor = page.nextCursor;
    hasMore = page.hasMore;
  }
  const remaining = await db.outbox
    .where("state")
    .anyOf("pending", "sending")
    .count();
  await db.syncState.put({
    key: "main",
    lastSequence: cursor,
    lastSyncedAt: new Date().toISOString(),
    status: remaining ? "error" : "idle",
  });
}

async function applyChange(
  db: ReturnType<typeof getDatabase>,
  change: PullChange,
) {
  if (change.entityType === "task") {
    if (change.operation === "delete" || !change.payload)
      await db.tasks.update(change.entityId, {
        _deleted: true,
        _syncStatus: "synced",
      });
    else {
      const task = toLocalTask(change.payload as unknown as ServerTask);
      const current = await db.tasks.get(task.id);
      if (!current || current._serverVersion <= task._serverVersion)
        await db.tasks.put(task);
    }
  }
  if (change.entityType === "routine" && change.operation === "delete")
    await db.routines.update(change.entityId, {
      active: false,
      _deleted: true,
      _syncStatus: "synced",
    });
  await db.activity.put({
    sequence: change.sequence,
    spaceId: change.spaceId,
    entityType: change.entityType,
    entityId: change.entityId,
    operation: change.operation,
    actorId: change.actorId ?? null,
    createdAt: change.createdAt ?? new Date().toISOString(),
    summary: `${change.entityType} ${change.operation}`,
  });
}

async function purgeRevokedSpaces(
  db: ReturnType<typeof getDatabase>,
  accessible: Set<string>,
) {
  const [spaces, tasks, lists, series, routines, activity, conflicts] =
    await Promise.all([
      db.spaces.toArray(),
      db.tasks.toArray(),
      db.lists.toArray(),
      db.taskSeries.toArray(),
      db.routines.toArray(),
      db.activity.toArray(),
      db.conflicts.toArray(),
    ]);
  const spaceIds = new Set([
    ...spaces.map((space) => space.id),
    ...tasks.map((task) => task.spaceId),
    ...lists.map((list) => list.spaceId),
    ...series.map((item) => item.spaceId),
    ...routines.map((item) => item.spaceId),
    ...activity.map((item) => item.spaceId),
    ...conflicts.map((item) => item.spaceId),
  ]);
  for (const spaceId of spaceIds) {
    if (accessible.has(spaceId)) continue;
    const pending = await db.outbox.where("spaceId").equals(spaceId).toArray();
    for (const mutation of pending)
      await preserveRecovery(
        db,
        mutation,
        "You no longer have access to this Circle.",
      );
    await db.tasks.where("spaceId").equals(spaceId).delete();
    await db.spaces.delete(spaceId);
    await db.spaceMembers.where("spaceId").equals(spaceId).delete();
    await db.lists.where("spaceId").equals(spaceId).delete();
    await db.taskSeries.where("spaceId").equals(spaceId).delete();
    const routines = await db.routines
      .where("spaceId")
      .equals(spaceId)
      .toArray();
    const routineIds = routines.map((routine) => routine.id);
    const routineItems = (await db.routineItems.toArray()).filter((item) =>
      routineIds.includes(item.routineId),
    );
    const routineItemIds = routineItems.map((item) => item.id);
    for (const id of routineIds) await db.routines.delete(id);
    for (const id of routineItemIds) await db.routineItems.delete(id);
    const completions = await db.routineCompletions.toArray();
    for (const item of completions)
      if (routineItemIds.includes(item.routineItemId))
        await db.routineCompletions.delete(item.key);
    await db.activity.where("spaceId").equals(spaceId).delete();
    await db.conflicts.where("spaceId").equals(spaceId).delete();
    await db.outbox.where("spaceId").equals(spaceId).delete();
  }
}

function serializeMutation(item: OutboxMutation) {
  return {
    mutationId: item.mutationId,
    deviceId: item.deviceId,
    entityType: item.entityType,
    entityId: item.entityId,
    spaceId: item.spaceId,
    operation: item.operation,
    baseVersion: item.baseVersion,
    patch: item.patch,
    createdAt: item.createdAt,
  };
}
