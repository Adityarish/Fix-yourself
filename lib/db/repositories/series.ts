import { z } from "zod";
import { getDatabase } from "@/lib/db/client-db";
import { createOutboxMutation } from "@/lib/db/repositories/outbox";
import type { Effort, LocalTask, LocalTaskSeries } from "@/lib/db/types";
import {
  localDateKey,
  materializeOccurrences,
  occurrenceKey,
  parseRrule,
} from "@/lib/tasks/recurrence";

const schema = z.object({
  title: z.string().trim().min(1).max(500),
  notes: z.string().max(20000).nullable().optional(),
  effort: z.enum(["quick", "normal", "deep"]),
  rrule: z.string().min(1).max(300),
  timezone: z.string().min(1).max(80),
  startAt: z.string().datetime(),
  assigneeId: z.string().uuid().nullable().optional(),
});

export async function createRecurringTask(
  userId: string,
  spaceId: string,
  listId: string,
  values: z.input<typeof schema>,
) {
  const parsed = schema.parse(values);
  parseRrule(parsed.rrule);
  const db = getDatabase(userId);
  const id = crypto.randomUUID();
  const mutationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const series: LocalTaskSeries = {
    id,
    spaceId,
    listId,
    creatorId: userId,
    assigneeId: parsed.assigneeId ?? null,
    title: parsed.title,
    notes: parsed.notes ?? null,
    effort: parsed.effort as Effort,
    rrule: parsed.rrule,
    timezone: parsed.timezone,
    startAt: parsed.startAt,
    untilAt: null,
    active: true,
    createdAt: now,
    updatedAt: now,
    _serverVersion: 0,
    _syncStatus: "pending",
    _lastMutationId: mutationId,
    _deleted: false,
  };
  const dates = materializeOccurrences(
    parsed.rrule,
    new Date(parsed.startAt),
    60,
    parsed.timezone,
  );
  await db.transaction("rw", db.taskSeries, db.tasks, db.outbox, async () => {
    await db.taskSeries.add(series);
    await db.outbox.add(
      createOutboxMutation({
        userId,
        spaceId,
        entityType: "taskSeries",
        entityId: id,
        operation: "create",
        baseVersion: null,
        mutationId,
        createdAt: now,
        patch: series as unknown as Record<string, unknown>,
      }),
    );
    for (const [index, date] of dates.entries()) {
      const taskId = crypto.randomUUID();
      const taskMutation = crypto.randomUUID();
      const scheduledDate = localDateKey(date, parsed.timezone);
      const today = localDateKey(new Date(), parsed.timezone);
      const task: LocalTask = {
        id: taskId,
        spaceId,
        listId,
        creatorId: userId,
        assigneeId: parsed.assigneeId ?? null,
        title: parsed.title,
        notes: parsed.notes ?? null,
        status: "open",
        bucket: scheduledDate === today ? "today" : "planned",
        effort: parsed.effort as Effort,
        scheduledDate,
        remindAt: date.toISOString(),
        reminderTimezone: parsed.timezone,
        rank: `${date.getTime().toString(36)}-${taskId}`,
        postponeCount: 0,
        completedAt: null,
        completedBy: null,
        droppedAt: null,
        seriesId: id,
        occurrenceKey: occurrenceKey(date),
        createdAt: now,
        updatedAt: now,
        version: 0,
        _serverVersion: 0,
        _syncStatus: "pending",
        _lastMutationId: taskMutation,
        _deleted: false,
      };
      await db.tasks.add(task);
      await db.outbox.add(
        createOutboxMutation({
          userId,
          spaceId,
          entityType: "task",
          entityId: taskId,
          operation: "create",
          baseVersion: null,
          mutationId: taskMutation,
          createdAt: new Date(Date.parse(now) + index + 1).toISOString(),
          patch: task as unknown as Record<string, unknown>,
        }),
      );
    }
  });
  return series;
}
