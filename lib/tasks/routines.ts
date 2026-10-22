import type {
  LocalRoutine,
  LocalRoutineCompletion,
  LocalRoutineItem,
} from "@/lib/db/types";
import { localDateKey } from "@/lib/tasks/recurrence";

export function routineLocalDate(routine: LocalRoutine, date: Date) {
  return localDateKey(date, routine.timezone);
}

export function isRoutineEligible(routine: LocalRoutine, date: Date) {
  const localDate = routineLocalDate(routine, date);
  const weekday = new Date(`${localDate}T00:00:00Z`).getUTCDay();
  return (
    routine.active && !routine._deleted && routine.daysOfWeek.includes(weekday)
  );
}

export function routineProgress(
  items: LocalRoutineItem[],
  completions: LocalRoutineCompletion[],
  routineId: string,
  localDate: string,
) {
  const eligible = items.filter(
    (item) => item.routineId === routineId && !item._deleted,
  );
  const completed = new Set(
    completions
      .filter((item) => item.localDate === localDate && !item._deleted)
      .map((item) => item.routineItemId),
  );
  return {
    total: eligible.length,
    completed: eligible.filter((item) => completed.has(item.id)).length,
  };
}
