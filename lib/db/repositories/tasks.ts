import { z } from "zod";
import { getDatabase } from "@/lib/db/client-db";
import { createOutboxMutation } from "@/lib/db/repositories/outbox";
import type { Bucket, Effort, LocalTask } from "@/lib/db/types";

const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000).nullable().optional(),
  bucket: z.enum(["today", "planned", "later"]),
  effort: z.enum(["quick", "normal", "deep"]),
  scheduledDate: z.string().date().nullable(),
  remindAt: z.string().datetime().nullable().optional(),
  reminderTimezone: z.string().min(1).max(80).nullable().optional(),
  assigneeId: z.string().uuid().nullable().optional(),
  seriesId: z.string().uuid().nullable().optional(),
  occurrenceKey: z.string().max(160).nullable().optional(),
});

const taskPatchSchema = z
  .object({
    listId: z.string().uuid(),
    title: z.string().trim().min(1).max(500),
    notes: z.string().max(20000).nullable(),
    bucket: z.enum(["today", "planned", "later"]),
    effort: z.enum(["quick", "normal", "deep"]),
    scheduledDate: z.string().date().nullable(),
    remindAt: z.string().datetime().nullable(),
    reminderTimezone: z.string().min(1).max(80).nullable(),
    assigneeId: z.string().uuid().nullable(),
    status: z.enum(["open", "completed", "dropped"]),
    completedAt: z.string().datetime().nullable(),
    completedBy: z.string().uuid().nullable(),
    droppedAt: z.string().datetime().nullable(),
    postponeCount: z.number().int().min(0),
    rank: z.string().min(1).max(200),
  })
  .partial()
  .refine(
    (patch) => Object.keys(patch).length > 0,
    "Make at least one change.",
  );

function assertBucket(bucket: Bucket, scheduledDate: string | null) {
  if ((bucket === "later") !== (scheduledDate === null))
    throw new Error(
      "Later tasks cannot have a scheduled date; scheduled tasks need a date.",
    );
}

export async function createTask(
  userId: string,
  spaceId: string,
  listId: string,
  values: z.input<typeof createTaskSchema>,
) {
  const parsed = createTaskSchema.parse(values);
  assertBucket(parsed.bucket, parsed.scheduledDate);
  const db = getDatabase(userId);
  const id = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const task: LocalTask = {
    id,
    spaceId,
    listId,
    creatorId: userId,
    assigneeId: parsed.assigneeId ?? null,
    title: parsed.title,
    notes: parsed.notes ?? null,
    status: "open",
    bucket: parsed.bucket as Bucket,
    effort: parsed.effort as Effort,
    scheduledDate: parsed.scheduledDate,
    remindAt: parsed.remindAt ?? null,
    reminderTimezone:
      parsed.reminderTimezone ??
      Intl.DateTimeFormat().resolvedOptions().timeZone,
    rank: `${Date.now().toString(36)}-${id}`,
    postponeCount: 0,
    completedAt: null,
    completedBy: null,
    droppedAt: null,
    seriesId: parsed.seriesId ?? null,
    occurrenceKey: parsed.occurrenceKey ?? null,
    createdAt: now,
    updatedAt: now,
    version: 0,
    _serverVersion: 0,
    _syncStatus: "pending",
    _lastMutationId: mutationId,
    _deleted: false,
  };
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.add(task);
    await db.outbox.add(
      createOutboxMutation({
        userId,
        spaceId,
        entityType: "task",
        entityId: id,
        operation: "create",
        baseVersion: null,
        mutationId,
        createdAt: now,
        patch: task as unknown as Record<string, unknown>,
      }),
    );
  });
  return task;
}

export async function updateTask(
  userId: string,
  task: LocalTask,
  patch: Partial<
    Pick<
      LocalTask,
      | "title"
      | "listId"
      | "notes"
      | "bucket"
      | "effort"
      | "scheduledDate"
      | "status"
      | "completedAt"
      | "completedBy"
      | "droppedAt"
      | "postponeCount"
      | "remindAt"
      | "reminderTimezone"
      | "assigneeId"
      | "rank"
    >
  >,
) {
  const validatedPatch = taskPatchSchema.parse(patch);
  const nextBucket = validatedPatch.bucket ?? task.bucket;
  const nextScheduledDate = Object.hasOwn(validatedPatch, "scheduledDate")
    ? (validatedPatch.scheduledDate ?? null)
    : task.scheduledDate;
  assertBucket(nextBucket, nextScheduledDate);
  const movedLater =
    task.status === "open" &&
    ((task.scheduledDate !== null &&
      nextScheduledDate !== null &&
      nextScheduledDate > task.scheduledDate) ||
      (task.bucket === "today" && nextBucket === "later"));
  if (movedLater && !Object.hasOwn(validatedPatch, "postponeCount"))
    validatedPatch.postponeCount = task.postponeCount + 1;
  const mutationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const operation =
    validatedPatch.status === "completed"
      ? "complete"
      : validatedPatch.status === "open"
        ? "reopen"
        : validatedPatch.status === "dropped"
          ? "drop"
          : Object.keys(validatedPatch).length === 1 && validatedPatch.rank
            ? "reorder"
            : "patch";
  const db = getDatabase(userId);
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    const pendingForTask = await db.outbox
      .where("entityId")
      .equals(task.id)
      .filter(
        (mutation) =>
          mutation.entityType === "task" &&
          (mutation.state === "pending" || mutation.state === "sending"),
      )
      .count();
    await db.tasks.update(task.id, {
      ...validatedPatch,
      updatedAt: now,
      _syncStatus: "pending",
      _lastMutationId: mutationId,
    });
    await db.outbox.add(
      createOutboxMutation({
        userId,
        spaceId: task.spaceId,
        entityType: "task",
        entityId: task.id,
        operation,
        baseVersion: (task._serverVersion || task.version) + pendingForTask,
        mutationId,
        createdAt: now,
        patch: validatedPatch as Record<string, unknown>,
      }),
    );
  });
}

export async function completeTask(
  userId: string,
  task: LocalTask,
  completed: boolean,
) {
  const now = new Date().toISOString();
  return updateTask(
    userId,
    task,
    completed
      ? {
          status: "completed",
          completedAt: now,
          completedBy: userId,
          droppedAt: null,
        }
      : {
          status: "open",
          completedAt: null,
          completedBy: null,
          droppedAt: null,
        },
  );
}

export async function dropTask(userId: string, task: LocalTask) {
  return updateTask(userId, task, {
    status: "dropped",
    droppedAt: new Date().toISOString(),
    completedAt: null,
    completedBy: null,
  });
}

export async function deleteTask(userId: string, task: LocalTask) {
  const db = getDatabase(userId);
  const mutationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.transaction("rw", db.tasks, db.outbox, async () => {
    await db.tasks.update(task.id, {
      _deleted: true,
      _syncStatus: "pending",
      _lastMutationId: mutationId,
      updatedAt: now,
    });
    await db.outbox.add(
      createOutboxMutation({
        userId,
        spaceId: task.spaceId,
        entityType: "task",
        entityId: task.id,
        operation: "delete",
        baseVersion: task._serverVersion || task.version,
        mutationId,
        createdAt: now,
        patch: {},
      }),
    );
  });
}
