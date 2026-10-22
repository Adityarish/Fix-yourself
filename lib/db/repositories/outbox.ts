import type {
  EntityType,
  MutationOperation,
  OutboxMutation,
} from "@/lib/db/types";

export function getDeviceId(userId: string) {
  const key = `nestlist-device-id:${userId}`;
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return id;
}

export function createOutboxMutation(input: {
  userId: string;
  spaceId: string;
  entityType: EntityType;
  entityId: string;
  operation: MutationOperation;
  baseVersion: number | null;
  patch: Record<string, unknown>;
  mutationId?: string;
  createdAt?: string;
}): OutboxMutation {
  return {
    mutationId: input.mutationId ?? crypto.randomUUID(),
    deviceId: getDeviceId(input.userId),
    userId: input.userId,
    spaceId: input.spaceId,
    entityType: input.entityType,
    entityId: input.entityId,
    operation: input.operation,
    baseVersion: input.baseVersion,
    patch: structuredClone(input.patch),
    createdAt: input.createdAt ?? new Date().toISOString(),
    attempts: 0,
    state: "pending",
  };
}

export function retryDelay(attempts: number, random = Math.random()) {
  const capped = Math.min(Math.max(attempts, 0), 8);
  return Math.round(Math.min(60_000, 750 * 2 ** capped) * (0.8 + random * 0.4));
}
