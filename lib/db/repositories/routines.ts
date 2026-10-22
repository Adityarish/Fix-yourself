import { z } from "zod";
import { getDatabase } from "@/lib/db/client-db";
import { createOutboxMutation } from "@/lib/db/repositories/outbox";
import type {
  LocalRoutine,
  LocalRoutineCompletion,
  LocalRoutineItem,
} from "@/lib/db/types";

const routineSchema = z.object({
  title: z.string().trim().min(1).max(200),
  timezone: z.string().min(1).max(80),
  daysOfWeek: z.array(z.number().int().min(0).max(6)).min(1),
  items: z
    .array(
      z.object({
        title: z.string().trim().min(1).max(500),
        reminderLocalTime: z.string().nullable().optional(),
        assigneeId: z.string().uuid().nullable().optional(),
      }),
    )
    .min(1),
});

export async function createRoutine(
  userId: string,
  spaceId: string,
  values: z.input<typeof routineSchema>,
) {
  const parsed = routineSchema.parse(values);
  const db = getDatabase(userId);
  const now = new Date().toISOString();
  const routineId = crypto.randomUUID();
  const routineMutation = crypto.randomUUID();
  const routine: LocalRoutine = {
    id: routineId,
    spaceId,
    title: parsed.title,
    timezone: parsed.timezone,
    daysOfWeek: [...new Set(parsed.daysOfWeek)].sort(),
    active: true,
    rank: `${Date.now().toString(36)}-${routineId}`,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    _serverVersion: 0,
    _syncStatus: "pending",
    _lastMutationId: routineMutation,
    _deleted: false,
  };
  const items: LocalRoutineItem[] = parsed.items.map((item, index) => ({
    id: crypto.randomUUID(),
    routineId,
    title: item.title,
    notes: null,
    reminderLocalTime: item.reminderLocalTime ?? null,
    assigneeId: item.assigneeId ?? null,
    rank: `r${String(index + 1).padStart(6, "0")}`,
    createdAt: now,
    updatedAt: now,
    _serverVersion: 0,
    _syncStatus: "pending",
    _lastMutationId: null,
    _deleted: false,
  }));
  await db.transaction(
    "rw",
    db.routines,
    db.routineItems,
    db.outbox,
    async () => {
      await db.routines.add(routine);
      await db.outbox.add(
        createOutboxMutation({
          userId,
          spaceId,
          entityType: "routine",
          entityId: routineId,
          operation: "create",
          baseVersion: null,
          mutationId: routineMutation,
          patch: routine as unknown as Record<string, unknown>,
        }),
      );
      for (const item of items) {
        const mutationId = crypto.randomUUID();
        item._lastMutationId = mutationId;
        await db.routineItems.add(item);
        await db.outbox.add(
          createOutboxMutation({
            userId,
            spaceId,
            entityType: "routineItem",
            entityId: item.id,
            operation: "create",
            baseVersion: null,
            mutationId,
            patch: item as unknown as Record<string, unknown>,
          }),
        );
      }
    },
  );
  return { routine, items };
}

export async function setRoutineCompletion(
  userId: string,
  spaceId: string,
  routineItemId: string,
  localDate: string,
  complete: boolean,
) {
  const db = getDatabase(userId);
  const key = `${routineItemId}:${localDate}`;
  const mutationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const completion: LocalRoutineCompletion = {
    key,
    routineItemId,
    localDate,
    completedBy: userId,
    completedAt: now,
    _serverVersion: 0,
    _syncStatus: "pending",
    _lastMutationId: mutationId,
    _deleted: !complete,
  };
  await db.transaction("rw", db.routineCompletions, db.outbox, async () => {
    await db.routineCompletions.put(completion);
    await db.outbox.add(
      createOutboxMutation({
        userId,
        spaceId,
        entityType: "routineCompletion",
        entityId: routineItemId,
        operation: complete ? "complete" : "reopen",
        baseVersion: null,
        mutationId,
        patch: { localDate, completedAt: now },
      }),
    );
  });
}
