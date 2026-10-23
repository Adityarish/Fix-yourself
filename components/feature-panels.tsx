"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Bell,
  Check,
  Download,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { deleteUserDatabase, getDatabase } from "@/lib/db/client-db";
import { setCapacity } from "@/lib/db/repositories/capacities";
import {
  createRoutine,
  deleteRoutine,
  setRoutineCompletion,
} from "@/lib/db/repositories/routines";
import {
  createCircle,
  createCircleInvite,
  listMyCircleInvites,
  respondToCircleInvite,
  type CircleInviteRequest,
} from "@/lib/db/repositories/spaces";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import {
  enablePush,
  getPushEnvironment,
  getPushStatus,
  saveDailySummaryPreferences,
  showTestNotification,
  type PushStatus,
} from "@/lib/notifications/push";
import { syncNow } from "@/lib/sync/engine";
import { createClient } from "@/lib/supabase/browser";
import { MemberAvatar } from "@/components/member-avatar";
import { defaultAvatarUrl, selectableAvatars } from "@/lib/profile/avatars";
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
  allowDelete = false,
}: {
  userId: string;
  personalSpaceId: string | null;
  allowDelete?: boolean;
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

  async function removeRoutine(routine: (typeof routines)[number]) {
    if (!window.confirm(`Delete “${routine.title}”?`)) return;
    try {
      await deleteRoutine(userId, routine);
      setMessage("Routine deleted.");
      if (navigator.onLine) void syncNow(userId, getDeviceId(userId));
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not delete this routine.",
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
                  <div className="routine-card-actions">
                    <span>
                      {progress.completed}/{progress.total}
                    </span>
                    {allowDelete && (
                      <button
                        type="button"
                        className="icon-button danger-icon routine-delete"
                        onClick={() => void removeRoutine(routine)}
                        aria-label={`Delete ${routine.title} routine`}
                        title="Delete routine"
                      >
                        <Trash2 size={16} />
                      </button>
                    )}
                  </div>
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
                      <label
                        className={`check-row ${done ? "done" : ""}`}
                        key={item.id}
                      >
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
  const router = useRouter();
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
  const [inviteRequests, setInviteRequests] = useState<CircleInviteRequest[]>(
    [],
  );
  const [requestsLoading, setRequestsLoading] = useState(true);
  const [respondingTo, setRespondingTo] = useState("");

  const refreshInviteRequests = useCallback(async () => {
    if (!navigator.onLine) {
      setRequestsLoading(false);
      return;
    }
    try {
      setInviteRequests(await listMyCircleInvites());
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not load Circle invitations.",
      );
    } finally {
      setRequestsLoading(false);
    }
  }, []);

  useEffect(() => {
    const refresh = () => void refreshInviteRequests();
    const initialRefresh = window.setTimeout(refresh, 0);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
    };
  }, [refreshInviteRequests]);

  async function respondToRequest(
    invitation: CircleInviteRequest,
    accept: boolean,
  ) {
    if (!navigator.onLine)
      return setMessage("Responding to an invitation requires a connection.");
    setRespondingTo(invitation.id);
    try {
      const result = await respondToCircleInvite(invitation.id, accept);
      setInviteRequests((current) =>
        current.filter((item) => item.id !== invitation.id),
      );
      if (!accept) {
        setMessage(`Invitation to ${invitation.circleName} declined.`);
        return;
      }
      await syncNow(userId, getDeviceId(userId));
      setMessage(`You joined ${invitation.circleName}.`);
      router.push(`/circles/${result.spaceId}`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not respond to this invitation.",
      );
    } finally {
      setRespondingTo("");
    }
  }

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
          : `Invite created and copied. ${result.deliveryError ?? "Email delivery failed."}`,
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
      <section
        className="circle-requests"
        aria-labelledby="circle-requests-title"
      >
        <div className="circle-requests-heading">
          <div>
            <span className="section-eyebrow">Your invitations</span>
            <h2 id="circle-requests-title">Circle requests</h2>
          </div>
          <span className="request-count">{inviteRequests.length}</span>
        </div>
        <div className="circle-request-list">
          {inviteRequests.map((invitation) => {
            const busy = respondingTo === invitation.id;
            return (
              <article className="circle-request-card" key={invitation.id}>
                <MemberAvatar
                  name={invitation.invitedByName}
                  userId={invitation.invitedBy}
                  avatarUrl={invitation.invitedByAvatarUrl}
                  size="medium"
                />
                <div className="circle-request-copy">
                  <strong>{invitation.circleName}</strong>
                  <span>
                    {invitation.invitedByName} invited you as a member
                  </span>
                  <small>
                    Expires{" "}
                    {new Date(invitation.expiresAt).toLocaleDateString()}
                  </small>
                </div>
                <div className="circle-request-actions">
                  <button
                    type="button"
                    className="subtle-button request-decline"
                    disabled={Boolean(respondingTo)}
                    onClick={() => void respondToRequest(invitation, false)}
                  >
                    <X size={15} /> Decline
                  </button>
                  <button
                    type="button"
                    className="button"
                    disabled={Boolean(respondingTo)}
                    onClick={() => void respondToRequest(invitation, true)}
                  >
                    <Check size={15} /> {busy ? "Joining…" : "Accept"}
                  </button>
                </div>
              </article>
            );
          })}
          {!requestsLoading && !inviteRequests.length && (
            <div className="empty circle-requests-empty">
              <Mail size={19} />
              <span>No pending Circle invitations.</span>
            </div>
          )}
          {requestsLoading && (
            <div className="empty circle-requests-empty">
              Loading invitations…
            </div>
          )}
        </div>
      </section>
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
        {spaces.map((space) => {
          const circleMembers = members.filter(
            (member) => member.spaceId === space.id,
          );
          const managers = circleMembers.filter(
            (member) => member.role === "owner" || member.role === "admin",
          ).length;
          return (
            <article
              className="feature-card circle-overview-card"
              key={space.id}
            >
              <div className="card-title">
                <strong>{space.name}</strong>
                <span>
                  {tasks.filter((task) => task.spaceId === space.id).length}{" "}
                  open
                </span>
              </div>
              <div className="circle-member-preview">
                <div className="avatar-stack" aria-hidden="true">
                  {circleMembers.slice(0, 4).map((member) => (
                    <MemberAvatar
                      key={member.key}
                      name={member.displayName ?? "Member"}
                      userId={member.userId}
                      avatarUrl={member.avatarUrl}
                      size="small"
                    />
                  ))}
                  {circleMembers.length > 4 && (
                    <span className="avatar-more">
                      +{circleMembers.length - 4}
                    </span>
                  )}
                </div>
                <p>
                  {circleMembers.length} members · {managers} managing
                </p>
              </div>
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
          );
        })}
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
        avatarUrl?: string;
        timezone?: string;
        defaultCapacity?: number;
        weekStartsOn?: number;
        theme?: string;
        dailyDigestEnabled?: boolean;
        dailyDigestTime?: string;
      }
    | undefined;
  const [capacityEdit, setCapacityEdit] = useState<number | null>(null);
  const [profileNameEdit, setProfileNameEdit] = useState<string | null>(null);
  const [avatarEdit, setAvatarEdit] = useState<string | null>(null);
  const [timezoneEdit, setTimezoneEdit] = useState<string | null>(null);
  const [weekStartEdit, setWeekStartEdit] = useState<number | null>(null);
  const [themeEdit, setThemeEdit] = useState<string | null>(null);
  const capacity = capacityEdit ?? profile?.defaultCapacity ?? 8;
  const profileName = profileNameEdit ?? profile?.displayName ?? displayName;
  const avatarOptions = useMemo(() => selectableAvatars(userId), [userId]);
  const selectedAvatar =
    avatarEdit ?? profile?.avatarUrl ?? defaultAvatarUrl(userId);
  const timezone =
    timezoneEdit ??
    profile?.timezone ??
    Intl.DateTimeFormat().resolvedOptions().timeZone;
  const weekStart = weekStartEdit ?? profile?.weekStartsOn ?? 1;
  const theme = themeEdit ?? profile?.theme ?? "system";
  const [storage, setStorage] = useState("");
  const [message, setMessage] = useState("");
  const [pushStatus, setPushStatus] = useState<PushStatus>("available");
  const [digestEnabled, setDigestEnabled] = useState<boolean | null>(null);
  const [digestTime, setDigestTime] = useState<string | null>(null);
  const [installed, setInstalled] = useState(false);
  const [iosDevice, setIosDevice] = useState(false);
  const [notificationBusy, setNotificationBusy] = useState(false);
  const [installPrompt, setInstallPrompt] = useState<
    | (Event & {
        prompt(): Promise<void>;
        userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
      })
    | null
  >(null);
  const dailyDigestEnabled =
    digestEnabled ?? profile?.dailyDigestEnabled ?? false;
  const dailyDigestTime = digestTime ?? profile?.dailyDigestTime ?? "08:00";

  useEffect(() => {
    void getPushStatus()
      .then((status) => {
        setPushStatus(status);
        const environment = getPushEnvironment();
        setInstalled(environment.installed);
        setIosDevice(environment.ios);
      })
      .catch(() => setPushStatus("available"));
    const captureInstallPrompt = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(
        event as Event & {
          prompt(): Promise<void>;
          userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
        },
      );
    };
    const markInstalled = () => {
      setInstalled(true);
      setInstallPrompt(null);
      void getPushStatus().then(setPushStatus);
    };
    window.addEventListener("beforeinstallprompt", captureInstallPrompt);
    window.addEventListener("appinstalled", markInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", captureInstallPrompt);
      window.removeEventListener("appinstalled", markInstalled);
    };
  }, []);

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
    const normalizedName = profileName.trim();
    if (!normalizedName || normalizedName.length > 120)
      return setMessage("Display name must be between 1 and 120 characters.");
    const supabase = createClient();
    const { error } = await supabase.rpc("update_profile_settings", {
      p_display_name: normalizedName,
      p_timezone: timezone,
      p_default_capacity: capacity,
      p_week_starts_on: weekStart,
      p_theme: theme,
    });
    if (error) return setMessage(error.message);
    const avatarResponse = await fetch("/api/profile/avatar", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatarUrl: selectedAvatar }),
    });
    if (!avatarResponse.ok) {
      const result = (await avatarResponse.json().catch(() => null)) as {
        error?: string;
      } | null;
      return setMessage(result?.error ?? "Could not save your avatar.");
    }
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
        displayName: normalizedName,
        avatarUrl: selectedAvatar,
        timezone,
        defaultCapacity: capacity,
        weekStartsOn: weekStart,
        theme,
        dailyDigestEnabled,
        dailyDigestTime,
      },
    });
    setProfileNameEdit(normalizedName);
    setAvatarEdit(selectedAvatar);
    await syncNow(userId, getDeviceId(userId));
    router.refresh();
    setMessage("Profile settings saved.");
  }

  async function cacheDailySummary(enabled: boolean, localTime: string) {
    const current = await db.meta.get("profile");
    await db.meta.put({
      key: "profile",
      value: {
        ...((current?.value as Record<string, unknown> | undefined) ?? {}),
        dailyDigestEnabled: enabled,
        dailyDigestTime: localTime,
      },
    });
  }

  async function enableDailySummary() {
    setNotificationBusy(true);
    try {
      await enablePush(userId);
      await saveDailySummaryPreferences(true, dailyDigestTime);
      await cacheDailySummary(true, dailyDigestTime);
      setDigestEnabled(true);
      setPushStatus("enabled");
      setMessage(
        `Daily app summary enabled for ${dailyDigestTime}. No email will be sent.`,
      );
    } catch (error) {
      void getPushStatus().then(setPushStatus);
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not enable notifications.",
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function saveDailySummaryTime() {
    setNotificationBusy(true);
    try {
      await saveDailySummaryPreferences(dailyDigestEnabled, dailyDigestTime);
      await cacheDailySummary(dailyDigestEnabled, dailyDigestTime);
      setMessage(`Daily summary time saved for ${dailyDigestTime}.`);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not save notification time.",
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function disableDailySummary() {
    setNotificationBusy(true);
    try {
      await saveDailySummaryPreferences(false, dailyDigestTime);
      await cacheDailySummary(false, dailyDigestTime);
      setDigestEnabled(false);
      setMessage("Daily app summary disabled.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not disable notifications.",
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function testNotification() {
    setNotificationBusy(true);
    try {
      const systemShown = await showTestNotification();
      setMessage(
        systemShown
          ? "Test popup shown and system notification requested. If no banner appears, check notification settings and Focus / Do Not Disturb."
          : "Test popup shown in NestList. System notifications are unavailable or blocked; popups still work while the app is open.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not show the test notification.",
      );
    } finally {
      setNotificationBusy(false);
    }
  }

  async function installApp() {
    if (!installPrompt) return;
    await installPrompt.prompt();
    const choice = await installPrompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setInstallPrompt(null);
      setMessage(
        "NestList installed. Enable the daily summary when you are ready.",
      );
    }
  }

  return (
    <section className="feature-stack settings-columns">
      <div className="settings-column">
        <article className="feature-card">
          <h2>Profile</h2>
          <div className="profile-editor-preview">
            <MemberAvatar
              name={profileName}
              userId={userId}
              avatarUrl={selectedAvatar}
              size="large"
            />
            <div>
              <strong>{profileName || "Your profile"}</strong>
              <small>Your avatar appears in every shared Circle.</small>
            </div>
          </div>
          <label>
            Display name
            <input
              value={profileName}
              onChange={(event) => setProfileNameEdit(event.target.value)}
            />
          </label>
          <fieldset className="avatar-picker">
            <legend>Choose an avatar</legend>
            <div className="avatar-options">
              {avatarOptions.map((avatar) => (
                <button
                  type="button"
                  key={avatar.id}
                  className={selectedAvatar === avatar.url ? "selected" : ""}
                  aria-label={`Use ${avatar.label} avatar`}
                  aria-pressed={selectedAvatar === avatar.url}
                  onClick={() => setAvatarEdit(avatar.url)}
                >
                  <MemberAvatar
                    name={avatar.label}
                    userId={`${userId}-${avatar.id}`}
                    avatarUrl={avatar.url}
                    size="large"
                  />
                  <span>{avatar.label}</span>
                </button>
              ))}
            </div>
          </fieldset>
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
        <article className="feature-card settings-compact-card settings-sync-card">
          <h2>Offline & sync</h2>
          <div className="settings-sync-details">
            <p className="settings-sync-summary">
              {outbox.length} pending · {conflicts.length} conflicts · last sync{" "}
              {sync?.lastSyncedAt
                ? new Date(sync.lastSyncedAt).toLocaleString()
                : "never"}
            </p>
            <p className="settings-sync-storage">
              {storage || "Check how much browser storage NestList uses."}
            </p>
          </div>
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
      </div>
      <div className="settings-column">
        <article className="feature-card settings-compact-card settings-planning-card">
          <h2>Planning</h2>
          <div className="settings-compact-actions">
            <label>
              Today’s capacity
              <input
                className="capacity-input"
                type="number"
                min={1}
                max={40}
                value={capacity}
                onChange={(event) =>
                  setCapacityEdit(Number(event.target.value))
                }
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
          </div>
        </article>
        <article className="feature-card">
          <h2>Notifications</h2>
          <div className="notification-status-row">
            <span className={`notification-state state-${pushStatus}`}>
              <span />
              {pushStatus === "enabled"
                ? "Enabled on this device"
                : pushStatus === "blocked"
                  ? "Blocked in browser settings"
                  : pushStatus === "unsupported"
                    ? "Not supported on this device"
                    : "Ready to enable"}
            </span>
            <span className="install-state">
              {installed ? "Installed app" : "Browser mode"}
            </span>
          </div>
          <p>
            Receive one app notification with all open tasks planned for that
            day. On-device popups work while NestList is open. Background
            notifications require enabling this device and a configured push
            server.
          </p>
          <label>
            Daily summary time
            <input
              type="time"
              value={dailyDigestTime}
              onChange={(event) => setDigestTime(event.target.value)}
            />
          </label>
          {!installed && (
            <p className="notification-hint">
              {iosDevice
                ? "On iPhone or iPad, open this site in Safari, tap Share, then Add to Home Screen. Open the installed NestList icon and enable notifications here."
                : "Install NestList for the most app-like experience and reliable notification access."}
            </p>
          )}
          <p className="notification-hint">
            Task reminder popups are automatic while the app is open. You can
            also enable a daily popup summary without push permission.
          </p>
          <button
            className="subtle-button"
            disabled={notificationBusy}
            onClick={async () => {
              setNotificationBusy(true);
              try {
                await saveDailySummaryPreferences(true, dailyDigestTime);
                await cacheDailySummary(true, dailyDigestTime);
                setDigestEnabled(true);
                setMessage(
                  "Daily popup summary enabled while NestList is open.",
                );
              } catch (error) {
                setMessage(
                  error instanceof Error
                    ? error.message
                    : "Could not enable summary.",
                );
              } finally {
                setNotificationBusy(false);
              }
            }}
          >
            Enable daily popup summary
          </button>
          <div className="card-actions">
            {!installed && installPrompt && (
              <button className="subtle-button" onClick={installApp}>
                <Download size={15} /> Install app
              </button>
            )}
            <button
              className="button"
              onClick={
                pushStatus === "enabled" && dailyDigestEnabled
                  ? saveDailySummaryTime
                  : enableDailySummary
              }
              disabled={
                notificationBusy ||
                pushStatus === "unsupported" ||
                pushStatus === "blocked"
              }
            >
              <Bell size={15} />{" "}
              {notificationBusy
                ? "Please wait…"
                : pushStatus !== "enabled"
                  ? "Enable on this device"
                  : dailyDigestEnabled
                    ? "Save time"
                    : "Enable daily summary"}
            </button>
            {
              <button
                className="subtle-button"
                onClick={testNotification}
                disabled={notificationBusy}
              >
                <Bell size={15} /> Test notification
              </button>
            }
            {dailyDigestEnabled && (
              <button
                className="subtle-button"
                onClick={disableDailySummary}
                disabled={notificationBusy}
              >
                Disable daily summary
              </button>
            )}
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
            Deletion permanently removes the cloud account and this device’s
            local copy.
          </p>
          <button className="modal-option danger" onClick={deleteAccount}>
            Delete account
          </button>
        </article>
      </div>
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
