import { describe, expect, it } from "vitest";
import { parseTask } from "@/lib/tasks/parser";

describe("task parser", () => {
  const now = new Date("2026-10-22T08:00:00+05:30");
  it("extracts date, time, effort, list, and a unique assignee locally", () => {
    const task = parseTask("Send report Friday 5pm @Asha #work deep", now, [
      { id: "11111111-1111-4111-8111-111111111111", displayName: "Asha" },
    ]);
    expect(task.title).toBe("Send report");
    expect(task.effort).toBe("deep");
    expect(task.list).toBe("work");
    expect(task.assigneeId).toBeTruthy();
    expect(task.remindAt).toBeTruthy();
  });
  it("turns supported recurrence phrases into RRULE", () =>
    expect(parseTask("Rent every month", now).recurrence).toBe("FREQ=MONTHLY"));
  it("does not choose between duplicate member names", () =>
    expect(
      parseTask("Call @Asha", now, [
        { id: "1", displayName: "Asha" },
        { id: "2", displayName: "ASHA" },
      ]).ambiguousAssignee,
    ).toBe("Asha"));
});
