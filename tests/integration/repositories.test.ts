import { afterEach, describe, expect, it } from "vitest";
import Dexie from "dexie";
import { createTask, updateTask } from "@/lib/db/repositories/tasks";
import { getDatabase } from "@/lib/db/client-db";

describe("local repository transaction", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  afterEach(async () => Dexie.delete(`nestlist:${userId}:v1`));
  it("commits the entity and immutable outbox row together", async () => {
    const task = await createTask(
      userId,
      "22222222-2222-4222-8222-222222222222",
      "33333333-3333-4333-8333-333333333333",
      {
        title: "Offline task",
        bucket: "later",
        effort: "quick",
        scheduledDate: null,
      },
    );
    const db = getDatabase(userId);
    expect(await db.tasks.get(task.id)).toBeTruthy();
    expect(await db.outbox.where("entityId").equals(task.id).count()).toBe(1);
    await updateTask(userId, task, {
      bucket: "today",
      scheduledDate: "2026-10-22",
    });
    expect((await db.tasks.get(task.id))?.scheduledDate).toBe("2026-10-22");
    expect(await db.outbox.where("entityId").equals(task.id).count()).toBe(2);
  });
});
