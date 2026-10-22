"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Bell, Download, Plus, RefreshCw, Users } from "lucide-react";
import { deleteUserDatabase, getDatabase } from "@/lib/db/client-db";
import { setCapacity } from "@/lib/db/repositories/capacities";
import {
  createRoutine,
  setRoutineCompletion,
} from "@/lib/db/repositories/routines";
import { createCircle, createCircleInvite } from "@/lib/db/repositories/spaces";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { enablePush, disablePush } from "@/lib/notifications/push";
import { syncNow } from "@/lib/sync/engine";
import { createClient } from "@/lib/supabase/browser";
import {
  isRoutineEligible,
  routineLocalDate,
  routineProgress,
} from "@/lib/tasks/routines";

function todayKey() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function RoutinesPanel({
  userId,
  personalSpaceId,
}: {
  userId: string;
  personalSpaceId: string | null;
}) {
  const db = useMemo(() => getDatabase(userId), [userId]);
  const routines =
    useLiveQuery(
      () => db.routines.filter((item) => !item._deleted).sortBy("rank"),
      [db],
    ) ?? [];
  const items =
    useLiveQuery(
      () => db.routineItems.filter((item) => !item._deleted).sortBy("rank"),
      [db],
    ) ?? [];
  const completions =
    useLiveQuery(() => db.routineCompletions.toArray(), [db]) ?? [];
  const [building, setBuilding] = useState(false);
  const [title, setTitle] = useState("");
  const [itemText, setItemText] = useState("");
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [message, setMessage] = useState("");
  const now = new Date();

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!personalSpaceId)
      return setMessage("Connect once before creating a routine.");
    try {
      const taskItems = itemText
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean)
        .map((value) => ({ title: value }));
      await createRoutine(userId, personalSpaceId, {
        title,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        daysOfWeek: days,
        items: taskItems,
      });
      setTitle("");
      setItemText("");
      setBuilding(false);
      setMessage("Routine saved on this device.");
      if (navigator.onLine) void syncNow(userId, getDeviceId(userId));
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save this routine.",
      );
    }
  }

  return (
    <section className="feature-stack">
      <div className="section-head">
        <h2>Today’s routines</h2>
        <button
          className="subtle-button"
          onClick={() => setBuilding((value) => !value)}
        >
          <Plus size={15} /> New routine
        </button>
      </div>
      {building && (
        <form className="feature-card form-grid" onSubmit={submit}>
          <label>
            Routine name
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
            />
          </label>
          <fieldset>
            <legend>Days</legend>
            <div className="chip-row">
              {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(
                (label, index) => (
                  <button
                    type="button"
                    key={label}
                    className={`filter-chip ${days.includes(index) ? "active" : ""}`}
                    onClick={() =>
                      setDays((current) =>
                        current.includes(index)
                          ? current.filter((day) => day !== index)
                          : [...current, index],
                      )
                    }
                  >
                    {label}
                  </button>
                ),
              )}
            </div>
          </fieldset>
          <label>
            Checklist items, one per line
            <textarea
              value={itemText}
              onChange={(event) => setItemText(event.target.value)}
              rows={4}
              required
            />
          </label>
          <div>
            <button
              className="button"
              disabled={!title.trim() || !itemText.trim() || !days.length}
            >
              Save routine
            </button>
          </div>
        </form>
      )}
      <div className="card-grid">
        {routines
          .filter((routine) => isRoutineEligible(routine, now))
          .map((routine) => {
            const routineToday = routineLocalDate(routine, now);
            const progress = routineProgress(
              items,
              completions,
              routine.id,
              routineToday,
            );
            return (
              <article className="feature-card" key={routine.id}>
                <div className="card-title">
                  <strong>{routine.title}</strong>
                  <span>
                    {progress.completed}/{progress.total}
                  </span>
                </div>
                <div className="routine-progress">
                  <span
                    style={{
                      width: `${progress.total ? (progress.completed / progress.total) * 100 : 0}%`,
                    }}
                  />
                </div>
                {items
                  .filter((item) => item.routineId === routine.id)
                  .map((item) => {
                    const done = completions.some(
                      (completion) =>
                        completion.routineItemId === item.id &&
                        completion.localDate === routineToday &&
                        !completion._deleted,
                    );
                    return (
                      <label className="check-row" key={item.id}>
                        <input
                          type="checkbox"
                          checked={done}
                          onChange={() =>
                            setRoutineCompletion(
                              userId,
                              routine.spaceId,
                              item.id,
                              routineToday,
                              !done,
                            )
                          }
                        />
                        <span>{item.title}</span>
                        {item.reminderLocalTime && (
                          <small>{item.reminderLocalTime.slice(0, 5)}</small>
                        )}
                      </label>
                    );
                  })}
              </article>
            );
          })}
      </div>
      {!routines.some((routine) => isRoutineEligible(routine, now)) && (
        <div className="empty">
          No routine is scheduled today. Create one for the small things you
          repeat.
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </section>
  );
}

export function CirclesPanel({ userId }: { userId: string }) {
  const db = useMemo(() => getDatabase(userId), [userId]);
  const spaces =
    useLiveQuery(
      () =>
        db.spaces
          .where("kind")
          .equals("circle")
          .filter((space) => !space._deleted)
          .toArray(),
      [db],
    ) ?? [];
  const members =
    useLiveQuery(
      () => db.spaceMembers.where("status").equals("active").toArray(),
      [db],
    ) ?? [];
  const tasks =
    useLiveQuery(
      () =>
        db.tasks
          .filter((task) => task.status === "open" && !task._deleted)
          .toArray(),
      [db],
    ) ?? [];
  const [name, setName] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");

  async function addCircle(event: FormEvent) {
    event.preventDefault();
    if (!navigator.onLine)
      return setMessage("Creating a Circle requires a connection.");
    try {
      const result = await createCircle(name);
      setName("");
      setSelected(result.space_id);
      await syncNow(userId, getDeviceId(userId));
      setMessage("Circle created.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not create the Circle.",
      );
    }
  }
  async function invite(event: FormEvent) {
    event.preventDefault();
    try {
      const result = await createCircleInvite(selected, inviteEmail);
      await navigator.clipboard?.writeText(result.inviteUrl ?? "");
      setInviteEmail("");
      setMessage(
        result.delivered
          ? "Invitation sent."
          : "Invite created and copied. Email delivery is not configured.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not invite that person.",
      );
    }
  }

  return (
    <section className="feature-stack">
      <form className="inline-form" onSubmit={addCircle}>
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Circle name"
          aria-label="Circle name"
          maxLength={120}
        />
        <button className="button" disabled={!name.trim()}>
          <Users size={15} /> Create Circle
        </button>
      </form>
      <div className="card-grid">
        {spaces.map((space) => (
          <article className="feature-card" key={space.id}>
            <div className="card-title">
              <strong>{space.name}</strong>
              <span>
                {tasks.filter((task) => task.spaceId === space.id).length} open
              </span>
            </div>
            <p>
              {members
                .filter((member) => member.spaceId === space.id)
                .map((member) => member.displayName ?? "Member")
                .join(", ")}
            </p>
            <div className="card-actions">
              <Link className="subtle-button" href={`/circles/${space.id}`}>
                Open
              </Link>
              <button
                className="subtle-button"
                onClick={() => setSelected(space.id)}
              >
                Invite
              </button>
            </div>
          </article>
        ))}
      </div>
      {!spaces.length && (
        <div className="empty">
          Create a Circle to plan with family, friends, or a team.
        </div>
      )}
      {selected && (
        <form className="feature-card inline-form" onSubmit={invite}>
          <input
            type="email"
            value={inviteEmail}
            onChange={(event) => setInviteEmail(event.target.value)}
            placeholder="person@example.com"
            aria-label="Invite email"
            required
          />
          <button className="button">Send invite</button>
          <button
            type="button"
            className="subtle-button"
            onClick={() => setSelected("")}
          >
            Cancel
          </button>
        </form>
      )}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </section>
  );
}

export function SettingsPanel({
  userId,
  displayName,
  personalSpaceId,
}: {
  userId: string;
  displayName: string;
  personalSpaceId: string | null;
}) {
  const router = useRouter();
  const db = useMemo(() => getDatabase(userId), [userId]);
  const tasks = useLiveQuery(() => db.tasks.toArray(), [db]) ?? [];
  const outbox = useLiveQuery(() => db.outbox.toArray(), [db]) ?? [];
  const sync = useLiveQuery(() => db.syncState.get("main"), [db]);
  const conflicts =
    useLiveQuery(
      () => db.conflicts.filter((item) => !item.reviewedAt).toArray(),
      [db],
    ) ?? [];
  const recovery = useLiveQuery(() => db.recovery.toArray(), [db]) ?? [];
  const savedProfile = useLiveQuery(() => db.meta.get("profile"), [db]);
  const profile = savedProfile?.value as
    | {
        displayName?: string;
        timezone?: string;
        defaultCapacity?: number;
        weekStartsOn?: number;
        theme?: string;
      }
    | undefined;
  const [capacityEdit, setCapacityEdit] = useState<number | null>(null);
  const [profileNameEdit, setProfileNameEdit] = useState<string | null>(null);
  const [timezoneEdit, setTimezoneEdit] = useState<string | null>(null);
  const [weekStartEdit, setWeekStartEdit] = useState<number | null>(null);
  const [themeEdit, setThemeEdit] = useState<string | null>(null);
  const capacity = capacityEdit ?? profile?.defaultCapacity ?? 8;
  const profileName = profileNameEdit ?? profile?.displayName ?? displayName;
  const timezone =
    timezoneEdit ??
    profile?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekStart = weekStartEdit ?? profile?.weekStartsOn ?? 1;
  const theme =
    themeEdit ??
    profile?.theme ??
    (typeof localStorage === "undefined"
      ? "system"
      : (localStorage.getItem("nestlist-theme") ?? "system"));
  const [storage, setStorage] = useState("");
  const [message, setMessage] = useState("");

  async function estimateStorage() {
    const value = await navigator.storage?.estimate();
    setStorage(
      value
        ? `${((value.usage ?? 0) / 1024 / 1024).toFixed(1)} MB used of ${((value.quota ?? 0) / 1024 / 1024).toFixed(0)} MB`
        : "Storage estimate unavailable",
    );
  }
  function download(filename: string, content: string, type: string) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function exportJson() {
    const [
      spaces,
      members,
      lists,
      taskSeries,
      routines,
      routineItems,
      routineCompletions,
      capacities,
      activity,
      allConflicts,
    ] = await Promise.all([
      db.spaces.toArray(),
      db.spaceMembers.toArray(),
      db.lists.toArray(),
      db.taskSeries.toArray(),
      db.routines.toArray(),
      db.routineItems.toArray(),
      db.routineCompletions.toArray(),
      db.capacities.toArray(),
      db.activity.toArray(),
      db.conflicts.toArray(),
    ]);
    download(
      "nestlist-export.json",
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          spaces,
          members,
          lists,
          tasks,
          taskSeries,
          routines,
          routineItems,
          routineCompletions,
          capacities,
          activity,
          conflicts: allConflicts,
          outbox,
          recovery,
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  function exportCsv() {
    const quote = (value: unknown) =>
      `"${String(value ?? "").replaceAll('"', '""')}"`;
    download(
      "nestlist-tasks.csv",
      [
        ["title", "status", "effort", "date", "notes"],
        ...tasks.map((task) => [
          task.title,
          task.status,
          task.effort,
          task.scheduledDate,
          task.notes,
        ]),
      ]
        .map((row) => row.map(quote).join(","))
        .join("\n"),
      "text/csv",
    );
  }
  function exportDiagnostics() {
    download(
      "nestlist-diagnostics.json",
      JSON.stringify(
        {
          appVersion: "0.1.0",
          exportedAt: new Date().toISOString(),
          userHashHint: userId.slice(0, 8),
          taskCount: tasks.length,
          pendingCount: outbox.length,
          blockedCount: outbox.filter((item) => item.state === "blocked")
            .length,
          conflictCount: conflicts.length,
          recoveryCount: recovery.length,
          syncStatus: sync?.status ?? "unknown",
          lastSyncedAt: sync?.lastSyncedAt ?? null,
          errorCodes: [
            ...new Set(outbox.map((item) => item.lastError).filter(Boolean)),
          ],
        },
        null,
        2,
      ),
      "application/json",
    );
  }
  async function deleteAccount() {
    if (
      !confirm(
        "Permanently delete your NestList account and cloud data? Export anything you need first.",
      )
    )
      return;
    const response = await fetch("/api/account", { method: "DELETE" });
    if (!response.ok)
      return setMessage("Account deletion could not be completed.");
    await createClient().auth.signOut();
    await deleteUserDatabase(userId);
    localStorage.removeItem("nestlist-last-user-id");
    localStorage.removeItem(`nestlist-device-id:${userId}`);
    localStorage.removeItem(`nestlist-space:${userId}`);
    router.replace("/login");
    router.refresh();
  }
  async function saveProfile() {
    const { error } = await createClient().rpc("update_profile_settings", {
      p_display_name: profileName,
      p_timezone: timezone,
      p_default_capacity: capacity,
      p_week_starts_on: weekStart,
      p_theme: theme,
    });
    if (error) return setMessage(error.message);
    localStorage.setItem("nestlist-theme", theme);
    document.documentElement.dataset.theme =
      theme === "system"
        ? matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light"
        : theme;
    await db.meta.put({
      key: "profile",
      value: {
        displayName: profileName,
        timezone,
        defaultCapacity: capacity,
        weekStartsOn: weekStart,
        theme,
      },
    });
    setMessage("Profile settings saved.");
  }

  return (
    <section className="feature-stack settings-grid">
      <article className="feature-card">
        <h2>Profile</h2>
        <label>
          Display name
          <input
            value={profileName}
            onChange={(event) => setProfileNameEdit(event.target.value)}
          />
        </label>
        <label>
          Timezone
          <input
            value={timezone}
            onChange={(event) => setTimezoneEdit(event.target.value)}
          />
        </label>
        <label>
          Week starts
          <select
            value={weekStart}
            onChange={(event) => setWeekStartEdit(Number(event.target.value))}
          >
            <option value={0}>Sunday</option>
            <option value={1}>Monday</option>
            <option value={6}>Saturday</option>
          </select>
        </label>
        <label>
          Theme
          <select
            value={theme}
            onChange={(event) => {
              const value = event.target.value;
              setThemeEdit(value);
              localStorage.setItem("nestlist-theme", value);
              document.documentElement.dataset.theme =
                value === "system"
                  ? matchMedia("(prefers-color-scheme: dark)").matches
                    ? "dark"
                    : "light"
                  : value;
            }}
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </label>
        <button className="button" onClick={saveProfile}>
          Save profile
        </button>
      </article>
      <article className="feature-card">
        <h2>Planning</h2>
        <label>
          Today’s capacity
          <input
            type="number"
            min={1}
            max={40}
            value={capacity}
            onChange={(event) => setCapacityEdit(Number(event.target.value))}
          />
        </label>
        <button
          className="button"
          disabled={!personalSpaceId}
          onClick={() =>
            personalSpaceId &&
            setCapacity(userId, personalSpaceId, todayKey(), capacity).then(
              () => setMessage("Capacity saved."),
            )
          }
        >
          Save capacity
        </button>
      </article>
      <article className="feature-card">
        <h2>Notifications</h2>
        <p>Enable reminders only on devices where you want them.</p>
        <div className="card-actions">
          <button
            className="button"
            onClick={() =>
              enablePush(userId)
                .then(() => setMessage("Reminders enabled."))
                .catch((error) => setMessage(error.message))
            }
          >
            <Bell size={15} /> Enable
          </button>
          <button
            className="subtle-button"
            onClick={() =>
              disablePush().then(() => setMessage("Reminders disabled."))
            }
          >
            Disable
          </button>
        </div>
      </article>
      <article className="feature-card">
        <h2>Offline & sync</h2>
        <p>
          {outbox.length} pending · {conflicts.length} conflicts · last sync{" "}
          {sync?.lastSyncedAt
            ? new Date(sync.lastSyncedAt).toLocaleString()
            : "never"}
        </p>
        <p>{storage || "Check how much browser storage NestList uses."}</p>
        <div className="card-actions">
          <button className="subtle-button" onClick={estimateStorage}>
            Check storage
          </button>
          <button
            className="subtle-button"
            onClick={() =>
              syncNow(userId, getDeviceId(userId))
                .then(() => setMessage("Sync finished."))
                .catch((error) => setMessage(error.message))
            }
          >
            <RefreshCw size={15} /> Retry sync
          </button>
        </div>
      </article>
      <article className="feature-card">
        <h2>Export</h2>
        <p>
          Download a portable copy before clearing browser data. Diagnostics
          contain counts and codes without task text.
        </p>
        <div className="card-actions">
          <button className="subtle-button" onClick={exportJson}>
            <Download size={15} /> JSON
          </button>
          <button className="subtle-button" onClick={exportCsv}>
            <Download size={15} /> CSV
          </button>
          <button className="subtle-button" onClick={exportDiagnostics}>
            <Download size={15} /> Diagnostics
          </button>
        </div>
      </article>
      <article className="feature-card warning-card">
        <h2>Account</h2>
        <p>
          Deletion permanently removes the cloud account and this device’s local
          copy.
        </p>
        <button className="modal-option danger" onClick={deleteAccount}>
          Delete account
        </button>
      </article>
      {recovery.length > 0 && (
        <article className="feature-card warning-card">
          <h2>Recovered drafts</h2>
          {recovery.map((item) => (
            <details key={item.id}>
              <summary>{item.title}</summary>
              <p>{item.reason}</p>
              <pre>{item.body}</pre>
            </details>
          ))}
        </article>
      )}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </section>
  );
}

export function PostponementReview({
  userId,
  tasks,
}: {
  userId: string;
  tasks: Array<{ id: string; title: string; postponeCount: number }>;
}) {
  const [dismissed, setDismissed] = useState(false);
  const due = tasks.filter((task) => task.postponeCount >= 3);
  if (!due.length || dismissed) return null;
  return (
    <section className="feature-card review-card">
      <div>
        <strong>Plans worth a second look</strong>
        <p>
          These have moved a few times. Pick a realistic next step when you are
          ready.
        </p>
      </div>
      {due.map((task) => (
        <Link
          key={task.id}
          href={`/today?task=${task.id}`}
          className="review-task"
        >
          {task.title}
          <span>{task.postponeCount} moves</span>
        </Link>
      ))}
      <button
        className="subtle-button"
        onClick={() => {
          localStorage.setItem(
            `nestlist-review-dismissed:${userId}:${todayKey()}`,
            "1",
          );
          setDismissed(true);
        }}
      >
        Remind me tomorrow
      </button>
    </section>
  );
}
