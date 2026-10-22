import { z } from "zod";
import { getDatabase } from "@/lib/db/client-db";
import { createOutboxMutation } from "@/lib/db/repositories/outbox";

export async function setCapacity(
  userId: string,
  personalSpaceId: string,
  localDate: string,
  value: number,
) {
  const capacity = z.number().int().min(1).max(40).parse(value);
  z.string().date().parse(localDate);
  const db = getDatabase(userId);
  const key = `${userId}:${localDate}`;
  const mutationId = crypto.randomUUID();
  await db.transaction("rw", db.capacities, db.outbox, async () => {
    await db.capacities.put({
      key,
      userId,
      localDate,
      capacity,
      _serverVersion: 0,
      _syncStatus: "pending",
      _lastMutationId: mutationId,
      _deleted: false,
    });
    await db.outbox.add(
      createOutboxMutation({
        userId,
        spaceId: personalSpaceId,
        entityType: "capacity",
        entityId: userId,
        operation: "patch",
        baseVersion: null,
        mutationId,
        patch: { localDate, capacity },
      }),
    );
  });
}
