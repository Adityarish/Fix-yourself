import Dexie, { type EntityTable } from "dexie";
import type {
  LocalActivity,
  LocalCapacity,
  LocalConflict,
  LocalList,
  LocalRoutine,
  LocalRoutineCompletion,
  LocalRoutineItem,
  LocalSpace,
  LocalSpaceMember,
  LocalTask,
  LocalTaskSeries,
  OutboxMutation,
  RecoveryDraft,
} from "./types";

export interface SyncState {
  key: string;
  lastSequence: number;
  lastSyncedAt: string | null;
  status: "idle" | "syncing" | "offline" | "error" | "auth-paused";
  errorCode?: string;
}

export interface MetaRecord {
  key: string;
  value: unknown;
}

export class NestListDatabase extends Dexie {
  spaces!: EntityTable<LocalSpace, "id">;
  spaceMembers!: EntityTable<LocalSpaceMember, "key">;
  lists!: EntityTable<LocalList, "id">;
  tasks!: EntityTable<LocalTask, "id">;
  taskSeries!: EntityTable<LocalTaskSeries, "id">;
  routines!: EntityTable<LocalRoutine, "id">;
  routineItems!: EntityTable<LocalRoutineItem, "id">;
  routineCompletions!: EntityTable<LocalRoutineCompletion, "key">;
  capacities!: EntityTable<LocalCapacity, "key">;
  activity!: EntityTable<LocalActivity, "sequence">;
  outbox!: EntityTable<OutboxMutation, "mutationId">;
  syncState!: EntityTable<SyncState, "key">;
  conflicts!: EntityTable<LocalConflict, "id">;
  recovery!: EntityTable<RecoveryDraft, "id">;
  meta!: EntityTable<MetaRecord, "key">;

  constructor(userId: string) {
    super(`nestlist:${userId}:v1`);
    this.version(1).stores({
      tasks:
        "id, spaceId, status, bucket, scheduledDate, updatedAt, _syncStatus, _deleted",
      outbox: "mutationId, userId, spaceId, entityId, createdAt, state",
      syncState: "key",
    });
    this.version(2)
      .stores({
        spaces: "id, kind, ownerId, updatedAt, _syncStatus, _deleted",
        spaceMembers: "key, spaceId, userId, status, role, _deleted",
        lists: "id, spaceId, rank, _deleted",
        tasks:
          "id, spaceId, listId, creatorId, assigneeId, status, bucket, scheduledDate, updatedAt, _syncStatus, _deleted",
        taskSeries: "id, spaceId, active, startAt, _deleted",
        routines: "id, spaceId, rank, active, _deleted",
        routineItems: "id, routineId, rank, assigneeId, _deleted",
        routineCompletions:
          "key, routineItemId, localDate, completedBy, _deleted",
        capacities: "key, userId, localDate, _syncStatus",
        activity: "sequence, spaceId, entityType, entityId, createdAt",
        outbox:
          "mutationId, userId, spaceId, entityType, entityId, createdAt, state, nextAttemptAt",
        syncState: "key",
        conflicts: "id, spaceId, entityType, entityId, reviewedAt",
        recovery: "id, spaceId, entityType, createdAt",
        meta: "key",
      })
      .upgrade(async (transaction) => {
        const tasks = transaction.table("tasks");
        await tasks.toCollection().modify((task) => {
          task.assigneeId ??= null;
          task.reminderTimezone ??= null;
          task.completedBy ??= null;
          task.droppedAt ??= null;
          task.seriesId ??= null;
          task.occurrenceKey ??= null;
          task._serverVersion ??= task.version ?? 0;
        });
      });
  }
}

const databases = new Map<string, NestListDatabase>();

export function getDatabase(userId: string) {
  let database = databases.get(userId);
  if (!database) {
    database = new NestListDatabase(userId);
    databases.set(userId, database);
  }
  return database;
}

export async function deleteUserDatabase(userId: string) {
  const database = databases.get(userId) ?? new NestListDatabase(userId);
  database.close();
  await Dexie.delete(database.name);
  databases.delete(userId);
}
