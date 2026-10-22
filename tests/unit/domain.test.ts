import { describe, expect, it } from "vitest";
import { capacityTone, capacityUsed } from "@/lib/tasks/capacity";
import {
  localDateKey,
  localDateTimeToUtc,
  materializeOccurrences,
} from "@/lib/tasks/recurrence";
import { rankBetween, rebalanceRanks } from "@/lib/tasks/rank";
import {
  changedFieldsAfterBase,
  overlappingFields,
} from "@/lib/sync/conflicts";
import type { LocalTask } from "@/lib/db/types";

const task = (overrides: Partial<LocalTask>): LocalTask => ({
  id: crypto.randomUUID(),
  spaceId: "personal",
  listId: "list",
  creatorId: "user",
  assigneeId: null,
  title: "Task",
  notes: null,
  status: "open",
  bucket: "today",
  effort: "normal",
  scheduledDate: "2026-10-22",
  remindAt: null,
  reminderTimezone: "Asia/Kolkata",
  rank: "a",
  postponeCount: 0,
  completedAt: null,
  completedBy: null,
  droppedAt: null,
  seriesId: null,
  occurrenceKey: null,
  createdAt: "",
  updatedAt: "",
  version: 1,
  _serverVersion: 1,
  _syncStatus: "synced",
  _lastMutationId: null,
  _deleted: false,
  ...overrides,
});

describe("domain rules", () => {
  it("excludes Circle tasks from personal capacity", () =>
    expect(
      capacityUsed(
        [task({ effort: "deep" }), task({ spaceId: "circle", effort: "deep" })],
        "2026-10-22",
        "personal",
      ),
    ).toBe(4));
  it("uses calm, near, and over capacity states", () => {
    expect(capacityTone(5, 8)).toBe("calm");
    expect(capacityTone(6, 8)).toBe("near");
    expect(capacityTone(9, 8)).toBe("over");
  });
  it("materializes deterministic month-end and leap-year occurrences", () => {
    const monthly = materializeOccurrences(
      "FREQ=MONTHLY",
      new Date("2024-01-31T09:00:00Z"),
      61,
    );
    expect(monthly.map((date) => date.toISOString().slice(0, 10))).toEqual([
      "2024-01-31",
      "2024-02-29",
      "2024-03-31",
    ]);
    const yearly = materializeOccurrences(
      "FREQ=YEARLY",
      new Date("2024-02-29T09:00:00Z"),
      800,
    );
    expect(yearly[1].toISOString()).toContain("2025-02-28");
  });
  it("keeps the local wall time across DST", () => {
    const dates = materializeOccurrences(
      "FREQ=DAILY",
      new Date("2026-03-07T14:00:00Z"),
      3,
      "America/New_York",
    );
    expect(dates.map((date) => date.toISOString())).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
      "2026-03-10T13:00:00.000Z",
    ]);
    expect(localDateKey(dates[1], "America/New_York")).toBe("2026-03-08");
    expect(
      localDateTimeToUtc(
        "2026-03-08",
        "09:00:00",
        "America/New_York",
      ).toISOString(),
    ).toBe("2026-03-08T13:00:00.000Z");
  });
  it("materializes weekdays without weekend entries", () =>
    expect(
      materializeOccurrences(
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        new Date("2026-10-22T09:00:00Z"),
        10,
      ).every((date) => ![0, 6].includes(date.getUTCDay())),
    ).toBe(true));
  it("creates sortable ranks and a stable rebalance", () => {
    expect(rankBetween("A", "C") > "A").toBe(true);
    expect(rankBetween("A", "C") < "C").toBe(true);
    expect(rebalanceRanks(3)).toEqual(["r000001", "r000002", "r000003"]);
  });
  it("finds overlapping concurrent fields", () => {
    const fields = changedFieldsAfterBase(
      [
        { version: 2, changedFields: ["scheduledDate"] },
        { version: 3, changedFields: ["title"] },
      ],
      1,
    );
    expect(overlappingFields(fields, { title: "Client" })).toEqual(["title"]);
  });
});
