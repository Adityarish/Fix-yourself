import type { LocalTask } from "@/lib/db/types";

export const effortPoints = { quick: 1, normal: 2, deep: 4 } as const;

export function capacityUsed(
  tasks: LocalTask[],
  date: string,
  personalSpaceId: string,
) {
  return tasks
    .filter(
      (task) =>
        task.spaceId === personalSpaceId &&
        task.scheduledDate === date &&
        task.status !== "dropped" &&
        !task._deleted,
    )
    .reduce((total, task) => total + effortPoints[task.effort], 0);
}

export function capacityTone(used: number, capacity: number) {
  const ratio = capacity > 0 ? used / capacity : 1;
  if (ratio > 1) return "over" as const;
  if (ratio >= 0.75) return "near" as const;
  return "calm" as const;
}
