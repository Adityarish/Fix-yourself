import { parse } from "chrono-node";
import { z } from "zod";
import type { Effort } from "@/lib/db/types";
import { recurrencePhraseToRrule } from "@/lib/tasks/recurrence";

const quickTask = z.object({ title: z.string().trim().min(1).max(500) });
export interface AssigneeCandidate {
  id: string;
  displayName: string;
}

export interface ParsedTask {
  title: string;
  effort: Effort;
  scheduledDate: string | null;
  remindAt: string | null;
  list: string | null;
  assigneeId: string | null;
  assigneeLabel: string | null;
  recurrence: string | null;
  ambiguousAssignee: string | null;
}

export function parseTask(
  input: string,
  now = new Date(),
  members: AssigneeCandidate[] = [],
): ParsedTask {
  const raw = input.trim();
  const listMatch = raw.match(/(?:^|\s)#([\p{L}\p{N}_-]+)/u);
  const assigneeMatch = raw.match(/(?:^|\s)@([\p{L}\p{N}_-]+)/u);
  const effortMatch = raw.match(/(?:^|\s)(quick|normal|deep)(?=\s|$)/i);
  const recurrenceMatch = raw.match(
    /\b(every\s+(?:day|week|month|year|weekday|weekend|\d+\s+days?))\b/i,
  );
  const dateResult = parse(raw, now, { forwardDate: true })[0];
  const assigneeMatches = assigneeMatch
    ? members.filter(
        (member) =>
          member.displayName.localeCompare(assigneeMatch[1], undefined, {
            sensitivity: "base",
          }) === 0,
      )
    : [];
  let title = raw;
  for (const token of [
    listMatch?.[0],
    assigneeMatch?.[0],
    effortMatch?.[0],
    recurrenceMatch?.[0],
    dateResult?.text,
  ]) {
    if (token) title = title.replace(token, " ");
  }
  title = title.replace(/\s+/g, " ").trim();
  const valid = quickTask.safeParse({ title });
  if (!valid.success)
    throw new Error("Add a task name (up to 500 characters).");
  const parsedDate = dateResult?.start.date();
  return {
    title: valid.data.title,
    effort: (effortMatch?.[1]?.toLowerCase() as Effort | undefined) ?? "normal",
    scheduledDate: parsedDate ? localDate(parsedDate) : null,
    remindAt: dateResult?.start.isCertain("hour")
      ? (parsedDate?.toISOString() ?? null)
      : null,
    list: listMatch?.[1] ?? null,
    assigneeId: assigneeMatches.length === 1 ? assigneeMatches[0].id : null,
    assigneeLabel:
      assigneeMatches.length === 1 ? assigneeMatches[0].displayName : null,
    recurrence: recurrenceMatch
      ? recurrencePhraseToRrule(recurrenceMatch[1])
      : null,
    ambiguousAssignee:
      assigneeMatch && assigneeMatches.length !== 1 ? assigneeMatch[1] : null,
  };
}

export function localDate(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
