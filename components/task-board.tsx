"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  MoreHorizontal,
  Plus,
  X,
} from "lucide-react";
import {
  CirclesPanel,
  PostponementReview,
  RoutinesPanel,
  SettingsPanel,
} from "@/components/feature-panels";
import { getDatabase } from "@/lib/db/client-db";
import {
  completeTask,
  createTask,
  deleteTask,
  dropTask,
  updateTask,
} from "@/lib/db/repositories/tasks";
import { createRecurringTask } from "@/lib/db/repositories/series";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { createSpaceList } from "@/lib/db/repositories/spaces";
import type { Effort, LocalTask } from "@/lib/db/types";
import { createClient } from "@/lib/supabase/browser";
import { syncNow } from "@/lib/sync/engine";
import { capacityTone, capacityUsed, effortPoints } from "@/lib/tasks/capacity";
import { localDate, parseTask } from "@/lib/tasks/parser";

type ViewName =
  | "today"
  | "planned"
  | "later"
  | "routines"
  | "circles"
  | "search"
  | "settings";

function dateTimeLocalValue(iso: string | null) {
  if (!iso) return "";
  const date = new Date(iso);
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
}

function dateFromKey(key: string) {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function nextDateKey(key: string) {
  const date = dateFromKey(key);
  date.setDate(date.getDate() + 1);
  return localDate(date);
}

function googleCalendarUrl(task: LocalTask) {
  if (!task.scheduledDate) return "";
  const start = task.scheduledDate.replaceAll("-", "");
  const end = nextDateKey(task.scheduledDate).replaceAll("-", "");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: task.title,
    dates: `${start}/${end}`,
  });
  if (task.notes) params.set("details", task.notes);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function escapeIcs(value: string) {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(";", "\\;")
    .replaceAll(",", "\\,")
    .replaceAll("\n", "\\n");
}

const monthNames = Array.from({ length: 12 }, (_, month) =>
  new Intl.DateTimeFormat(undefined, { month: "long" }).format(
    new Date(2024, month, 1),
  ),
);

const calendarYears = Array.from({ length: 131 }, (_, index) => 1970 + index);

export function TaskBoard({
  userId,
  displayName,
  view,
}: {
  userId: string;
  displayName: string;
  view: ViewName;
}) {
  const db = useMemo(() => getDatabase(userId), [userId]);
  const taskRows = useLiveQuery(
    () => db.tasks.filter((task) => !task._deleted).toArray(),
    [db],
  );
  const tasks = useMemo(() => taskRows ?? [], [taskRows]);
  const spaces =
    useLiveQuery(
      () => db.spaces.filter((space) => !space._deleted).toArray(),
      [db],
    ) ?? [];
  const members =
    useLiveQuery(
      () => db.spaceMembers.where("status").equals("active").toArray(),
      [db],
    ) ?? [];
  const lists =
    useLiveQuery(
      () => db.lists.filter((list) => !list._deleted).toArray(),
      [db],
    ) ?? [];
  const syncState = useLiveQuery(() => db.syncState.get("main"), [db]);
  const profileRecord = useLiveQuery(() => db.meta.get("profile"), [db]);
  const pending =
    useLiveQuery(
      () =>
        db.outbox.where("state").anyOf("pending", "sending", "blocked").count(),
      [db],
    ) ?? 0;
  const today = localDate(new Date());
  const capacityOverride = useLiveQuery(
    () => db.capacities.get(`${userId}:${today}`),
    [db, today, userId],
  );
  const [fallbackSpace, setFallbackSpace] = useState<{
    id: string;
    inboxId: string;
  } | null>(null);
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [online, setOnline] = useState(true);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [effortFilter, setEffortFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("");
  const [placeFilter, setPlaceFilter] = useState("all");
  const [assigneeFilter, setAssigneeFilter] = useState("all");
  const [creatorFilter, setCreatorFilter] = useState("all");
  const [selectedTask, setSelectedTask] = useState<LocalTask | null>(null);
  const [selectedLater, setSelectedLater] = useState<string[]>([]);
  const [plannedDate, setPlannedDate] = useState(() => localDate(new Date()));
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const date = new Date();
    date.setDate(1);
    date.setHours(12, 0, 0, 0);
    return date;
  });
  const personalSpace = spaces.find((space) => space.kind === "personal");
  const inbox =
    lists.find((list) => list.spaceId === personalSpace?.id) ?? null;
  const personalIds =
    personalSpace && inbox
      ? { id: personalSpace.id, inboxId: inbox.id }
      : fallbackSpace;

  useEffect(() => {
    let active = true;
    const cacheKey = `nestlist-space:${userId}`;
    const cached = localStorage.getItem(cacheKey);
    if (cached)
      try {
        const value = JSON.parse(cached) as { id: string; inboxId: string };
        queueMicrotask(() => active && setFallbackSpace(value));
      } catch {
        localStorage.removeItem(cacheKey);
      }
    async function bootstrap() {
      if (!navigator.onLine) return;
      try {
        const supabase = createClient();
        const { data, error } = await supabase.rpc("bootstrap_user", {
          p_device_id: getDeviceId(userId),
        });
        if (error) throw error;
        const value = data as {
          personal_space_id?: string;
          inbox_list_id?: string;
        };
        if (!value.personal_space_id || !value.inbox_list_id)
          throw new Error("Bootstrap returned no personal Inbox.");
        const ids = {
          id: value.personal_space_id,
          inboxId: value.inbox_list_id,
        };
        localStorage.setItem(cacheKey, JSON.stringify(ids));
        if (active) setFallbackSpace(ids);
        await syncNow(userId, getDeviceId(userId));
      } catch (error) {
        if (active)
          setMessage(
            error instanceof Error ? error.message : "Cloud setup is waiting.",
          );
      }
    }
    void bootstrap();
    const trigger = () => {
      setOnline(navigator.onLine);
      if (navigator.onLine)
        void syncNow(userId, getDeviceId(userId)).catch(() => undefined);
    };
    const markOffline = () => setOnline(false);
    setOnline(navigator.onLine);
    window.addEventListener("online", trigger);
    window.addEventListener("offline", markOffline);
    window.addEventListener("focus", trigger);
    const interval = window.setInterval(trigger, 30_000);
    return () => {
      active = false;
      window.removeEventListener("online", trigger);
      window.removeEventListener("offline", markOffline);
      window.removeEventListener("focus", trigger);
      window.clearInterval(interval);
    };
  }, [userId]);

  useEffect(() => {
    const url = new URL(window.location.href);
    const taskId = url.searchParams.get("task");
    const action = url.searchParams.get("action");
    if (action === "add") {
      queueMicrotask(() => setEditing(true));
      url.searchParams.delete("action");
      window.history.replaceState({}, "", url);
      return;
    }
    const task = tasks.find((item) => item.id === taskId);
    if (!task) return;
    if (!action) {
      queueMicrotask(() => setSelectedTask(task));
      return;
    }
    url.searchParams.delete("action");
    window.history.replaceState({}, "", url);
    if (action === "done")
      void completeTask(userId, task, true).then(() =>
        setMessage("Task completed from your reminder."),
      );
    if (action === "snooze")
      void updateTask(userId, task, {
        remindAt: new Date(Date.now() + 600_000).toISOString(),
      }).then(() => setMessage("Reminder snoozed for 10 minutes."));
  }, [tasks, userId]);

  const visible = useMemo(
    () =>
      tasks
        .filter((task) => {
          if (view === "today")
            return task.status === "open" && task.scheduledDate === today;
          if (view === "planned")
            return (
              task.status === "open" &&
              Boolean(task.scheduledDate && task.scheduledDate >= today)
            );
          if (view === "later")
            return task.status === "open" && task.bucket === "later";
          if (view === "search") {
            const normalized =
              `${task.title} ${task.notes ?? ""}`.toLocaleLowerCase();
            return (
              (!query.trim() ||
                normalized.includes(query.trim().toLocaleLowerCase())) &&
              (statusFilter === "all" || task.status === statusFilter) &&
              (effortFilter === "all" || task.effort === effortFilter) &&
              (!dateFilter || task.scheduledDate === dateFilter) &&
              (placeFilter === "all" ||
                (placeFilter.startsWith("space:")
                  ? task.spaceId === placeFilter.slice(6)
                  : task.listId === placeFilter.slice(5))) &&
              (assigneeFilter === "all" ||
                (assigneeFilter === "unassigned"
                  ? !task.assigneeId
                  : task.assigneeId === assigneeFilter)) &&
              (creatorFilter === "all" || task.creatorId === creatorFilter)
            );
          }
          return false;
        })
        .sort(
          (a, b) =>
            (a.scheduledDate ?? "9999").localeCompare(
              b.scheduledDate ?? "9999",
            ) || a.rank.localeCompare(b.rank),
        ),
    [
      tasks,
      view,
      today,
      query,
      statusFilter,
      effortFilter,
      dateFilter,
      placeFilter,
      assigneeFilter,
      creatorFilter,
    ],
  );

  const personalToday = visible.filter(
    (task) => task.spaceId === personalIds?.id,
  );
  const circleToday = visible.filter(
    (task) =>
      task.spaceId !== personalIds?.id &&
      (!task.assigneeId || task.assigneeId === userId),
  );
  const profileSettings = profileRecord?.value as
    { defaultCapacity?: number; displayName?: string } | undefined;
  const activeDisplayName = profileSettings?.displayName?.trim() || displayName;
  const capacity =
    capacityOverride?.capacity ?? profileSettings?.defaultCapacity ?? 8;
  const used = personalIds ? capacityUsed(tasks, today, personalIds.id) : 0;
  const tone = capacityTone(used, capacity);
  const doneToday = tasks.filter(
    (task) =>
      task.status === "completed" &&
      Boolean(task.completedAt) &&
      localDate(new Date(task.completedAt!)) === today,
  );

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!draft.trim() || !personalIds)
      return setMessage("Connect once to create your personal Inbox.");
    setBusy(true);
    try {
      const candidates = members
        .filter(
          (member) => member.spaceId === personalIds.id && member.displayName,
        )
        .map((member) => ({
          id: member.userId,
          displayName: member.displayName!,
        }));
      const parsed = parseTask(draft, new Date(), candidates);
      if (parsed.ambiguousAssignee)
        throw new Error(`Choose one member for @${parsed.ambiguousAssignee}.`);
      const scheduledDate =
        parsed.scheduledDate ??
        (view === "today"
          ? today
          : view === "planned"
            ? plannedDate
            : null);
      let targetListId = personalIds.inboxId;
      if (parsed.list) {
        const existingList = lists.find(
          (list) =>
            list.spaceId === personalIds.id &&
            list.name.toLocaleLowerCase() === parsed.list!.toLocaleLowerCase(),
        );
        if (existingList) targetListId = existingList.id;
        else {
          if (!navigator.onLine)
            throw new Error(
              `Connect once to create the #${parsed.list} list, or use an existing list offline.`,
            );
          targetListId = (await createSpaceList(personalIds.id, parsed.list))
            .id;
        }
      }
      if (parsed.recurrence)
        await createRecurringTask(userId, personalIds.id, targetListId, {
          title: parsed.title,
          effort: parsed.effort,
          rrule: parsed.recurrence,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          startAt:
            parsed.remindAt ??
            new Date(`${scheduledDate ?? today}T09:00:00`).toISOString(),
          assigneeId: parsed.assigneeId,
        });
      else
        await createTask(userId, personalIds.id, targetListId, {
          title: parsed.title,
          bucket: scheduledDate
            ? scheduledDate === today
              ? "today"
              : "planned"
            : "later",
          effort: parsed.effort,
          scheduledDate,
          remindAt: parsed.remindAt,
          assigneeId: parsed.assigneeId,
        });
      setDraft("");
      setEditing(false);
      setMessage(
        parsed.list ? `Saved in #${parsed.list}.` : "Saved on this device.",
      );
      if (navigator.onLine) void syncNow(userId, getDeviceId(userId));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save the task.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function scheduleSelected() {
    const date = prompt("Schedule selected tasks (YYYY-MM-DD)", today);
    if (!date) return;
    for (const id of selectedLater) {
      const task = tasks.find((item) => item.id === id);
      if (task)
        await updateTask(userId, task, {
          bucket: date === today ? "today" : "planned",
          scheduledDate: date,
        });
    }
    setSelectedLater([]);
  }

  const heading: Record<ViewName, string> = {
    today: "Today, at your pace.",
    planned: "A little further ahead.",
    later: "Saved for later.",
    routines: "Small things, often.",
    circles: "Plans you share.",
    search: "Find a task.",
    settings: "Your space, your way.",
  };
  const calendarDays = useMemo(() => {
    const first = new Date(
      calendarMonth.getFullYear(),
      calendarMonth.getMonth(),
      1,
      12,
    );
    const gridStart = new Date(first);
    gridStart.setDate(first.getDate() - first.getDay());
    return Array.from({ length: 42 }, (_, offset) => {
      const date = new Date(gridStart);
      date.setDate(gridStart.getDate() + offset);
      const key = localDate(date);
      return {
        date,
        key,
        inMonth: date.getMonth() === calendarMonth.getMonth(),
        tasks: visible.filter((task) => task.scheduledDate === key),
      };
    });
  }, [calendarMonth, visible]);
  const plannedDateTasks = visible.filter(
    (task) => task.scheduledDate === plannedDate,
  );
  const plannedDateLabel = new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(dateFromKey(plannedDate));

  function openGoogleCalendar(task: LocalTask) {
    const url = googleCalendarUrl(task);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  function exportPlannedCalendar() {
    if (!visible.length) return;
    const stamp = new Date().toISOString().replace(/[-:]/g, "").split(".")[0];
    const events = visible
      .filter((task) => task.scheduledDate)
      .map((task) => {
        const start = task.scheduledDate!.replaceAll("-", "");
        const end = nextDateKey(task.scheduledDate!).replaceAll("-", "");
        return [
          "BEGIN:VEVENT",
          `UID:${task.id}@nestlist.app`,
          `DTSTAMP:${stamp}Z`,
          `DTSTART;VALUE=DATE:${start}`,
          `DTEND;VALUE=DATE:${end}`,
          `SUMMARY:${escapeIcs(task.title)}`,
          ...(task.notes ? [`DESCRIPTION:${escapeIcs(task.notes)}`] : []),
          "END:VEVENT",
        ].join("\r\n");
      });
    const calendar = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//NestList//Planned Tasks//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      ...events,
      "END:VCALENDAR",
      "",
    ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([calendar], { type: "text/calendar" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "nestlist-planned.ics";
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
    setMessage(
      "Calendar file downloaded. Import it from Google Calendar → Settings → Import & export.",
    );
  }
  const syncLabel =
    !online
      ? `Offline — ${pending} change${pending === 1 ? "" : "s"} saved`
      : syncState?.status === "syncing"
        ? "Syncing"
        : pending
          ? `${pending} changes waiting`
          : "Synced";
  const renderRows = (
    rows: LocalTask[],
    selectable = false,
    showGoogleCalendar = false,
  ) => (
    <div className="task-list">
      {rows.map((task) => (
        <div
          className={`task-row ${task.status === "completed" ? "completed" : ""}`}
          key={task.id}
        >
          {selectable && (
            <input
              type="checkbox"
              checked={selectedLater.includes(task.id)}
              onChange={(event) =>
                setSelectedLater((current) =>
                  event.target.checked
                    ? [...current, task.id]
                    : current.filter((id) => id !== task.id),
                )
              }
              aria-label={`Select ${task.title}`}
            />
          )}
          <button
            className={`task-check ${task.status === "completed" ? "done" : ""}`}
            aria-label={`${task.status === "completed" ? "Reopen" : "Complete"} ${task.title}`}
            onClick={() =>
              completeTask(userId, task, task.status !== "completed")
            }
          >
            {task.status === "completed" && <Check size={13} />}
          </button>
          <button
            className="task-content"
            onClick={() => setSelectedTask(task)}
          >
            <span
              className={`task-title ${task.status === "completed" ? "done" : ""}`}
            >
              {task.title}
            </span>
            <span className="task-meta">
              {task.scheduledDate ?? "Later"}
              {task.remindAt ? " · reminder" : ""}
            </span>
          </button>
          <span className="effort">
            {task.effort} · {effortPoints[task.effort]}
          </span>
          {showGoogleCalendar && task.scheduledDate && (
            <button
              type="button"
              className="icon-button google-calendar-button"
              onClick={() => openGoogleCalendar(task)}
              aria-label={`Add ${task.title} to Google Calendar`}
              title="Add to Google Calendar"
            >
              <CalendarPlus size={17} />
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setSelectedTask(task)}
            aria-label={`Edit ${task.title}`}
          >
            <MoreHorizontal size={17} />
          </button>
        </div>
      ))}
      {!rows.length && (
        <div className="empty">
          A little space to breathe. Add a task when you’re ready.
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="topline">
        <span>
          {view === "today"
            ? new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
              }).format(new Date())
            : view}
        </span>
        <span>{syncLabel}</span>
      </div>
      <h1 className="greeting">{heading[view]}</h1>
      <p className="subtitle">
        {view === "today"
          ? `A good day starts with one thing, ${activeDisplayName}.`
          : "Keep your plans clear and easy to return to."}
      </p>
      {view === "routines" && (
        <RoutinesPanel
          userId={userId}
          personalSpaceId={personalIds?.id ?? null}
        />
      )}
      {view === "circles" && <CirclesPanel userId={userId} />}
      {view === "settings" && (
        <SettingsPanel
          userId={userId}
          displayName={activeDisplayName}
          personalSpaceId={personalIds?.id ?? null}
        />
      )}
      {view === "today" && (
        <>
          <section className={`capacity-card capacity-${tone}`}>
            <div className="capacity-copy">
              <strong>Your capacity</strong>
              <span>
                {used} of {capacity} points
              </span>
            </div>
            <div
              className="capacity-track"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={capacity}
              aria-valuenow={used}
            >
              <div
                className="capacity-fill"
                style={{ width: `${Math.min(100, (used / capacity) * 100)}%` }}
              />
            </div>
          </section>
          <PostponementReview userId={userId} tasks={tasks} />
        </>
      )}
      {view === "search" && (
        <div className="search-tools">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search titles and notes"
            aria-label="Search tasks"
          />
          <select
            value={statusFilter}
            onChange={(event) => setStatusFilter(event.target.value)}
            aria-label="Status filter"
          >
            <option value="all">All statuses</option>
            <option value="open">Open</option>
            <option value="completed">Completed</option>
            <option value="dropped">Dropped</option>
          </select>
          <input
            type="date"
            value={dateFilter}
            onChange={(event) => setDateFilter(event.target.value)}
            aria-label="Scheduled date filter"
          />
          <select
            value={placeFilter}
            onChange={(event) => setPlaceFilter(event.target.value)}
            aria-label="List or Circle filter"
          >
            <option value="all">All lists and Circles</option>
            <optgroup label="Circles and spaces">
              {spaces.map((space) => (
                <option key={space.id} value={`space:${space.id}`}>
                  {space.name}
                </option>
              ))}
            </optgroup>
            <optgroup label="Lists">
              {lists.map((list) => (
                <option key={list.id} value={`list:${list.id}`}>
                  {list.name}
                </option>
              ))}
            </optgroup>
          </select>
          <select
            value={assigneeFilter}
            onChange={(event) => setAssigneeFilter(event.target.value)}
            aria-label="Assignee filter"
          >
            <option value="all">All assignees</option>
            <option value="unassigned">Unassigned</option>
            {[
              ...new Map(
                members.map((member) => [member.userId, member]),
              ).values(),
            ].map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName ?? "Member"}
              </option>
            ))}
          </select>
          <select
            value={creatorFilter}
            onChange={(event) => setCreatorFilter(event.target.value)}
            aria-label="Creator filter"
          >
            <option value="all">All creators</option>
            {[...new Set(tasks.map((task) => task.creatorId))].map(
              (creatorId) => (
                <option key={creatorId} value={creatorId}>
                  {members.find((member) => member.userId === creatorId)
                    ?.displayName ?? (creatorId === userId ? "You" : "Member")}
                </option>
              ),
            )}
          </select>
          <select
            value={effortFilter}
            onChange={(event) => setEffortFilter(event.target.value)}
            aria-label="Effort filter"
          >
            <option value="all">All sizes</option>
            <option value="quick">Quick</option>
            <option value="normal">Normal</option>
            <option value="deep">Deep</option>
          </select>
        </div>
      )}
      {view === "planned" && (
        <section className="calendar-shell" aria-label="Planned task calendar">
          <div className="calendar-toolbar">
            <div className="calendar-nav">
              <button
                type="button"
                className="subtle-button calendar-today"
                onClick={() => {
                  const date = new Date();
                  date.setHours(12, 0, 0, 0);
                  setCalendarMonth(
                    new Date(date.getFullYear(), date.getMonth(), 1, 12),
                  );
                  setPlannedDate(today);
                }}
              >
                Today
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() - 1,
                      1,
                      12,
                    ),
                  )
                }
                aria-label="Previous month"
              >
                <ChevronLeft size={18} />
              </button>
              <button
                type="button"
                className="icon-button"
                onClick={() =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      calendarMonth.getMonth() + 1,
                      1,
                      12,
                    ),
                  )
                }
                aria-label="Next month"
              >
                <ChevronRight size={18} />
              </button>
            </div>
            <div
              className="calendar-period"
              aria-label="Calendar month and year"
            >
              <select
                value={calendarMonth.getMonth()}
                onChange={(event) =>
                  setCalendarMonth(
                    new Date(
                      calendarMonth.getFullYear(),
                      Number(event.target.value),
                      1,
                      12,
                    ),
                  )
                }
                aria-label="Choose month"
              >
                {monthNames.map((month, index) => (
                  <option value={index} key={month}>
                    {month}
                  </option>
                ))}
              </select>
              <select
                value={calendarMonth.getFullYear()}
                onChange={(event) =>
                  setCalendarMonth(
                    new Date(
                      Number(event.target.value),
                      calendarMonth.getMonth(),
                      1,
                      12,
                    ),
                  )
                }
                aria-label="Choose year"
              >
                {calendarYears.map((year) => (
                  <option value={year} key={year}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="calendar-toolbar-actions">
              <button
                type="button"
                className="subtle-button calendar-export"
                onClick={exportPlannedCalendar}
                disabled={!visible.length}
                title="Download all planned tasks for Google Calendar"
              >
                <CalendarPlus size={15} />
                Export to Google Calendar
              </button>
              <span className="calendar-total">{visible.length} planned</span>
            </div>
          </div>
          <div className="calendar-scroll">
            <div className="calendar-grid">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                (day) => (
                  <div className="calendar-weekday" key={day}>
                    {day}
                  </div>
                ),
              )}
              {calendarDays.map((day) => (
                <div
                  className={`calendar-day ${day.inMonth ? "" : "outside"} ${day.key === today ? "is-today" : ""} ${day.key === plannedDate ? "selected" : ""}`}
                  key={day.key}
                >
                  <div className="calendar-day-head">
                    <button
                      type="button"
                      className="calendar-date"
                      onClick={() => {
                        if (day.key >= today) setPlannedDate(day.key);
                      }}
                      disabled={day.key < today}
                      aria-label={`Show tasks for ${new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(day.date)}`}
                    >
                      {day.date.getDate()}
                    </button>
                    {day.key >= today && (
                      <button
                        type="button"
                        className="calendar-add"
                        onClick={() => {
                          setPlannedDate(day.key);
                          setEditing(true);
                        }}
                        aria-label={`Add task on ${new Intl.DateTimeFormat(undefined, { month: "long", day: "numeric" }).format(day.date)}`}
                      >
                        <Plus size={14} />
                      </button>
                    )}
                  </div>
                  <div className="calendar-events">
                    {day.tasks.slice(0, 3).map((task) => (
                      <button
                        type="button"
                        className={`calendar-event effort-${task.effort}`}
                        key={task.id}
                        onClick={() => {
                          setPlannedDate(day.key);
                          setSelectedTask(task);
                        }}
                        title={task.title}
                      >
                        <span className="calendar-event-dot" />
                        <span>{task.title}</span>
                      </button>
                    ))}
                    {day.tasks.length > 3 && (
                      <button
                        type="button"
                        className="calendar-more"
                        onClick={() => setPlannedDate(day.key)}
                      >
                        +{day.tasks.length - 3} more
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
      {["today", "planned", "later", "search"].includes(view) && (
        <>
          {view === "today" ? (
            <>
              <div className="section-head">
                <h2>Personal</h2>
                <span>{personalToday.length}</span>
              </div>
              {renderRows(personalToday)}
              <div className="section-head">
                <h2>From Circles</h2>
                <span>{circleToday.length}</span>
              </div>
              {renderRows(circleToday)}
              <RoutinesPanel
                userId={userId}
                personalSpaceId={personalIds?.id ?? null}
                allowDelete
              />
            </>
          ) : view === "planned" ? (
            <>
              <div className="section-head planned-agenda-head">
                <div>
                  <span className="section-eyebrow">Selected day</span>
                  <h2>{plannedDateLabel}</h2>
                </div>
                <span>{plannedDateTasks.length}</span>
              </div>
              {renderRows(plannedDateTasks, false, true)}
            </>
          ) : (
            <>
              <div className="section-head">
                <h2>
                  {view === "search"
                    ? "Results"
                    : view[0].toUpperCase() + view.slice(1)}
                </h2>
                <span>{visible.length}</span>
                {view === "later" && selectedLater.length > 0 && (
                  <button className="subtle-button" onClick={scheduleSelected}>
                    <CalendarPlus size={15} /> Schedule {selectedLater.length}
                  </button>
                )}
              </div>
              {renderRows(visible, view === "later")}
            </>
          )}
          {view !== "search" &&
            (!editing ? (
              <button className="quick-add" onClick={() => setEditing(true)}>
                <Plus size={17} />
                {view === "planned"
                  ? `Add a task on ${plannedDateLabel}`
                  : "Add a task or describe it naturally"}
              </button>
            ) : (
              <form className="composer" onSubmit={submit}>
                <input
                  autoFocus
                  value={draft}
                  onChange={(event) => setDraft(event.target.value)}
                  placeholder="Call mum tomorrow 9am · quick · every week"
                  maxLength={500}
                />
                <div className="composer-bottom">
                  <span>
                    Dates, reminders, recurrence, #lists, @members, and effort
                    are parsed locally.
                  </span>
                  <div className="composer-actions">
                    <button
                      type="button"
                      className="subtle-button"
                      onClick={() => setEditing(false)}
                    >
                      Cancel
                    </button>
                    <button className="button" disabled={!draft.trim() || busy}>
                      {busy ? "Saving…" : "Add task"}
                    </button>
                  </div>
                </div>
              </form>
            ))}
          {view === "today" && doneToday.length > 0 && (
            <>
              <div className="section-head">
                <h2>Done today</h2>
                <span>{doneToday.length}</span>
              </div>
              {renderRows(doneToday)}
            </>
          )}
        </>
      )}
      {selectedTask && (
        <TaskSheet
          userId={userId}
          task={selectedTask}
          members={members.filter(
            (member) => member.spaceId === selectedTask.spaceId,
          )}
          lists={lists.filter((list) => list.spaceId === selectedTask.spaceId)}
          onClose={() => setSelectedTask(null)}
          onMessage={setMessage}
        />
      )}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </>
  );
}

function TaskSheet({
  userId,
  task,
  members,
  lists,
  onClose,
  onMessage,
}: {
  userId: string;
  task: LocalTask;
  members: Array<{ userId: string; displayName: string | null }>;
  lists: Array<{ id: string; name: string }>;
  onClose: () => void;
  onMessage: (value: string) => void;
}) {
  const [title, setTitle] = useState(task.title);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [effort, setEffort] = useState<Effort>(task.effort);
  const [date, setDate] = useState(task.scheduledDate ?? "");
  const [reminder, setReminder] = useState(dateTimeLocalValue(task.remindAt));
  const [assignee, setAssignee] = useState(task.assigneeId ?? "");
  const [listId, setListId] = useState(task.listId);
  async function save(event: FormEvent) {
    event.preventDefault();
    try {
      await updateTask(userId, task, {
        listId,
        title,
        notes: notes || null,
        effort,
        bucket: date
          ? date === localDate(new Date())
            ? "today"
            : "planned"
          : "later",
        scheduledDate: date || null,
        remindAt: reminder ? new Date(reminder).toISOString() : null,
        assigneeId: assignee || null,
      });
      onMessage("Task saved locally.");
      onClose();
    } catch (error) {
      onMessage(
        error instanceof Error ? error.message : "Could not save the task.",
      );
    }
  }
  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-sheet-title"
    >
      <form className="modal-card task-sheet" onSubmit={save}>
        <button
          type="button"
          className="modal-close"
          onClick={onClose}
          aria-label="Close"
        >
          <X />
        </button>
        <h2 id="task-sheet-title">Task details</h2>
        <label>
          Title
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={500}
            required
          />
        </label>
        <label>
          Notes
          <textarea
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
            rows={4}
            maxLength={20000}
          />
        </label>
        <div className="two-column">
          <label>
            Size
            <select
              value={effort}
              onChange={(event) => setEffort(event.target.value as Effort)}
            >
              <option value="quick">Quick</option>
              <option value="normal">Normal</option>
              <option value="deep">Deep</option>
            </select>
          </label>
          <label>
            Date
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </label>
          <label>
            Reminder
            <input
              type="datetime-local"
              value={reminder}
              onChange={(event) => setReminder(event.target.value)}
            />
          </label>
          <label>
            List
            <select
              value={listId}
              onChange={(event) => setListId(event.target.value)}
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Assignee
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName ?? "Member"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="card-actions">
          <button className="button">Save</button>
          <button
            type="button"
            className="subtle-button"
            onClick={() =>
              updateTask(userId, task, {
                bucket: "later",
                scheduledDate: null,
              }).then(onClose)
            }
          >
            Move to Later
          </button>
          <button
            type="button"
            className="subtle-button"
            onClick={() => dropTask(userId, task).then(onClose)}
          >
            Drop
          </button>
          <button
            type="button"
            className="modal-option danger"
            onClick={() =>
              confirm("Delete this task?") &&
              deleteTask(userId, task).then(onClose)
            }
          >
            Delete
          </button>
        </div>
      </form>
    </div>
  );
}
