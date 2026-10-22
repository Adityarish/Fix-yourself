export type Effort = "quick" | "normal" | "deep";
export type TaskStatus = "open" | "completed" | "dropped";
export type Bucket = "today" | "planned" | "later";
export type SyncStatus = "local" | "pending" | "synced" | "blocked";
export type SpaceKind = "personal" | "circle";
export type MemberRole = "owner" | "admin" | "member";
export type MemberStatus = "active" | "removed";
export type EntityType =
  | "task"
  | "taskSeries"
  | "routine"
  | "routineItem"
  | "routineCompletion"
  | "capacity"
  | "space";
export type MutationOperation =
  "create" | "patch" | "complete" | "reopen" | "drop" | "delete" | "reorder";

export interface LocalMetadata {
  _serverVersion: number;
  _syncStatus: SyncStatus;
  _lastMutationId: string | null;
  _deleted: boolean;
}

export interface LocalSpace extends LocalMetadata {
  id: string;
  kind: SpaceKind;
  name: string;
  ownerId: string;
  color: string | null;
  icon: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LocalSpaceMember extends LocalMetadata {
  key: string;
  spaceId: string;
  userId: string;
  displayName: string | null;
  avatarUrl: string | null;
  role: MemberRole;
  status: MemberStatus;
  joinedAt: string;
  removedAt: string | null;
}

export interface LocalList extends LocalMetadata {
  id: string;
  spaceId: string;
  name: string;
  color: string | null;
  icon: string | null;
  rank: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalTask extends LocalMetadata {
  id: string;
  spaceId: string;
  listId: string;
  creatorId: string;
  assigneeId: string | null;
  title: string;
  notes: string | null;
  status: TaskStatus;
  bucket: Bucket;
  effort: Effort;
  scheduledDate: string | null;
  remindAt: string | null;
  reminderTimezone: string | null;
  rank: string;
  postponeCount: number;
  completedAt: string | null;
  completedBy: string | null;
  droppedAt: string | null;
  seriesId: string | null;
  occurrenceKey: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface LocalTaskSeries extends LocalMetadata {
  id: string;
  spaceId: string;
  listId: string;
  creatorId: string;
  assigneeId: string | null;
  title: string;
  notes: string | null;
  effort: Effort;
  rrule: string;
  timezone: string;
  startAt: string;
  untilAt: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LocalRoutine extends LocalMetadata {
  id: string;
  spaceId: string;
  title: string;
  timezone: string;
  daysOfWeek: number[];
  active: boolean;
  rank: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalRoutineItem extends LocalMetadata {
  id: string;
  routineId: string;
  title: string;
  notes: string | null;
  reminderLocalTime: string | null;
  assigneeId: string | null;
  rank: string;
  createdAt: string;
  updatedAt: string;
}

export interface LocalRoutineCompletion extends LocalMetadata {
  key: string;
  routineItemId: string;
  localDate: string;
  completedBy: string;
  completedAt: string;
}

export interface LocalCapacity extends LocalMetadata {
  key: string;
  userId: string;
  localDate: string;
  capacity: number;
}

export interface LocalActivity {
  sequence: number;
  spaceId: string;
  entityType: EntityType | string;
  entityId: string;
  operation: string;
  actorId: string | null;
  createdAt: string;
  summary: string;
}

export interface LocalConflict {
  id: string;
  spaceId: string;
  entityType: string;
  entityId: string;
  mutationId: string;
  overlappingFields: string[];
  serverBefore: Record<string, unknown> | null;
  clientPatch: Record<string, unknown>;
  resolvedValue: Record<string, unknown> | null;
  resolution: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RecoveryDraft {
  id: string;
  spaceId: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  reason: string;
  createdAt: string;
}

export interface OutboxMutation {
  mutationId: string;
  deviceId: string;
  userId: string;
  spaceId: string;
  entityType: EntityType;
  entityId: string;
  operation: MutationOperation;
  baseVersion: number | null;
  patch: Record<string, unknown>;
  createdAt: string;
  attempts: number;
  nextAttemptAt?: string;
  state: "pending" | "sending" | "blocked" | "failed";
  lastError?: string;
}
