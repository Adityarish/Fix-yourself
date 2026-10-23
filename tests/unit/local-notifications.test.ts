import { afterEach, describe, expect, it, vi } from "vitest";
import {
  NOTICE_EVENT,
  showLocalNotice,
  startReminderScheduler,
} from "@/lib/notifications/local";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe("local notifications", () => {
  it("shows an in-app popup when system notifications are denied", async () => {
    vi.stubGlobal("Notification", { permission: "denied" });
    const listener = vi.fn();
    window.addEventListener(NOTICE_EVENT, listener);
    expect(
      await showLocalNotice({
        title: "Test",
        body: "Hello",
        tag: "test",
        url: "/today",
      }),
    ).toBe(false);
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(NOTICE_EVENT, listener);
  });
  it("delivers successive reminders, skips other assignees and deduplicates", async () => {
    vi.useFakeTimers();
    const now = Date.now();
    const notify = vi.fn().mockResolvedValue(true);
    const tasks = [
      {
        id: "1",
        title: "First",
        creatorId: "me",
        remindAt: new Date(now).toISOString(),
      },
      {
        id: "2",
        title: "Second",
        creatorId: "me",
        remindAt: new Date(now + 2000).toISOString(),
      },
      {
        id: "3",
        title: "Other",
        creatorId: "me",
        assigneeId: "other",
        remindAt: new Date(now).toISOString(),
      },
      {
        id: "4",
        title: "Future",
        creatorId: "me",
        remindAt: new Date(now + 3e9).toISOString(),
      },
    ];
    const stop = startReminderScheduler(tasks, "me", new Set(), notify);
    await vi.advanceTimersByTimeAsync(4000);
    expect(notify.mock.calls.map(([notice]) => notice.body)).toEqual([
      "First",
      "Second",
    ]);
    stop();
  });
  it("retries a failed delivery instead of marking it delivered", async () => {
    vi.useFakeTimers();
    const notify = vi
      .fn()
      .mockRejectedValueOnce(new Error("failed"))
      .mockResolvedValue(true);
    const stop = startReminderScheduler(
      [
        {
          id: "1",
          title: "Retry",
          creatorId: "me",
          remindAt: new Date().toISOString(),
        },
      ],
      "me",
      new Set(),
      notify,
    );
    await vi.advanceTimersByTimeAsync(2000);
    expect(notify).toHaveBeenCalledTimes(2);
    stop();
  });
});
