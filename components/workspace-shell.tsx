"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import {
  Cloud,
  Home,
  CalendarDays,
  Archive,
  Repeat2,
  Users,
  Search,
  Settings,
  LogOut,
  History,
  Menu,
  X,
} from "lucide-react";
import { deleteUserDatabase, getDatabase } from "@/lib/db/client-db";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { createClient } from "@/lib/supabase/browser";
import { syncNow } from "@/lib/sync/engine";
import { MemberAvatar } from "@/components/member-avatar";

const links = [
  { href: "/today", label: "Today", icon: Home, group: "PLAN" },
  { href: "/planned", label: "Planned", icon: CalendarDays, group: "PLAN" },
  { href: "/later", label: "Later", icon: Archive, group: "PLAN" },
  { href: "/routines", label: "Routines", icon: Repeat2, group: "YOUR SPACE" },
  { href: "/circles", label: "Circles", icon: Users, group: "YOUR SPACE" },
  { href: "/search", label: "Search", icon: Search, group: "YOUR SPACE" },
  { href: "/activity", label: "Activity", icon: History, group: "YOUR SPACE" },
];

const mobilePrimaryHrefs = ["/today", "/planned", "/circles", "/activity"];
const mobileMenuLinks = [
  ...links,
  { href: "/settings", label: "Settings", icon: Settings, group: "ACCOUNT" },
];

export function WorkspaceShell({
  userId,
  displayName,
  children,
}: {
  userId: string;
  displayName: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [online, setOnline] = useState(true);
  const [syncMessage, setSyncMessage] = useState("Synced");
  const [pendingCount, setPendingCount] = useState(0);
  const [signOutBusy, setSignOutBusy] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [updateReady, setUpdateReady] =
    useState<ServiceWorkerRegistration | null>(null);
  const db = useMemo(() => getDatabase(userId), [userId]);
  const outboxCount = useLiveQuery(() => db.outbox.count(), [db]) ?? 0;
  const syncState = useLiveQuery(() => db.syncState.get("main"), [db]);
  const profileRecord = useLiveQuery(() => db.meta.get("profile"), [db]);
  const reminderRows = useLiveQuery(
    () =>
      db.tasks
        .filter(
          (task) =>
            task.status === "open" && Boolean(task.remindAt) && !task._deleted,
        )
        .toArray(),
    [db],
  );
  const reminderTasks = useMemo(() => reminderRows ?? [], [reminderRows]);
  const scheduledRows = useLiveQuery(
    () =>
      db.tasks
        .filter(
          (task) =>
            task.status === "open" &&
            Boolean(task.scheduledDate) &&
            !task._deleted,
        )
        .toArray(),
    [db],
  );
  const scheduledTasks = useMemo(() => scheduledRows ?? [], [scheduledRows]);
  const locallyNotified = useRef(new Set<string>());
  const groups = useMemo(
    () => [...new Set(links.map((item) => item.group))],
    [],
  );

  useEffect(() => {
    localStorage.setItem("nestlist-last-user-id", userId);
    const savedTheme = localStorage.getItem("nestlist-theme") ?? "system";
    document.documentElement.dataset.theme =
      (profileRecord?.value as { theme?: string } | undefined)?.theme ===
      "light"
        ? "light"
        : (profileRecord?.value as { theme?: string } | undefined)?.theme ===
            "dark"
          ? "dark"
          : savedTheme === "system"
            ? matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : savedTheme;
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    const onlineFrame = window.requestAnimationFrame(() =>
      setOnline(navigator.onLine),
    );
    const workerMessage = (event: MessageEvent) => {
      if (event.data?.type === "NESTLIST_SYNC")
        void syncNow(userId, getDeviceId(userId));
    };
    window.addEventListener("online", up);
    window.addEventListener("offline", down);
    navigator.serviceWorker?.addEventListener("message", workerMessage);
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      void navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((registration) => {
          if (registration.waiting) setUpdateReady(registration);
          registration.addEventListener("updatefound", () =>
            registration.installing?.addEventListener("statechange", () => {
              if (registration.waiting) setUpdateReady(registration);
            }),
          );
        })
        .catch(() => undefined);
    }
    if ("storage" in navigator && "persist" in navigator.storage)
      void navigator.storage.persist();
    const supabase = createClient();
    const channel = supabase
      .channel(`workspace:${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => void syncNow(userId, getDeviceId(userId)),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "space_members" },
        () => void syncNow(userId, getDeviceId(userId)),
      )
      .subscribe();
    return () => {
      window.cancelAnimationFrame(onlineFrame);
      window.removeEventListener("online", up);
      window.removeEventListener("offline", down);
      navigator.serviceWorker?.removeEventListener("message", workerMessage);
      void supabase.removeChannel(channel);
    };
  }, [userId, profileRecord]);

  useEffect(() => {
    const registration = navigator.serviceWorker?.ready;
    if (!outboxCount || !registration) return;
    void registration
      .then((value) => {
        const syncManager = (
          value as ServiceWorkerRegistration & {
            sync?: { register(tag: string): Promise<void> };
          }
        ).sync;
        return syncManager?.register("nestlist-sync");
      })
      .catch(() => undefined);
  }, [outboxCount]);

  useEffect(() => {
    const next = reminderTasks
      .filter(
        (task) =>
          task.remindAt &&
          !locallyNotified.current.has(`${task.id}:${task.remindAt}`),
      )
      .sort((a, b) => Date.parse(a.remindAt!) - Date.parse(b.remindAt!))[0];
    if (!next?.remindAt) return;
    const key = `${next.id}:${next.remindAt}`;
    const timer = window.setTimeout(
      async () => {
        locallyNotified.current.add(key);
        if (
          !("Notification" in window) ||
          Notification.permission !== "granted"
        )
          return;
        const registration = await navigator.serviceWorker?.getRegistration();
        await registration?.showNotification("NestList reminder", {
          body: next.title,
          tag: `local-${next.id}`,
          data: { url: `/today?task=${encodeURIComponent(next.id)}` },
        });
      },
      Math.max(
        0,
        Math.min(2_147_000_000, Date.parse(next.remindAt) - Date.now()),
      ),
    );
    return () => window.clearTimeout(timer);
  }, [reminderTasks]);

  useEffect(() => {
    const profile = profileRecord?.value as
      { dailyDigestEnabled?: boolean; dailyDigestTime?: string } | undefined;
    if (
      !profile?.dailyDigestEnabled ||
      !("Notification" in window) ||
      Notification.permission !== "granted"
    )
      return;
    const time = profile.dailyDigestTime ?? "08:00";
    const [hours, minutes] = time.split(":").map(Number);
    if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return;
    const now = new Date();
    const localDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    const todaysTasks = scheduledTasks.filter(
      (task) => task.scheduledDate === localDate,
    );
    if (!todaysTasks.length) return;
    const storageKey = `nestlist-daily-summary:${userId}:${localDate}`;
    if (localStorage.getItem(storageKey)) return;
    const scheduledAt = new Date(now);
    scheduledAt.setHours(hours, minutes, 0, 0);
    const timer = window.setTimeout(
      async () => {
        const registration = await navigator.serviceWorker?.getRegistration();
        if (!registration) return;
        const visibleTitles: string[] = [];
        for (const task of todaysTasks) {
          const nextLength =
            visibleTitles.join("\n").length + task.title.length;
          if (visibleTitles.length && nextLength > 700) break;
          visibleTitles.push(`• ${task.title}`);
        }
        const remaining = todaysTasks.length - visibleTitles.length;
        const body = `${visibleTitles.join("\n")}${remaining > 0 ? `\n+${remaining} more` : ""}`;
        await registration.showNotification(
          `Today’s plan · ${todaysTasks.length} ${todaysTasks.length === 1 ? "task" : "tasks"}`,
          {
            body,
            icon: "/icons/icon-192.svg",
            badge: "/icons/icon-192.svg",
            tag: `daily-summary-${localDate}`,
            data: { url: "/today", kind: "daily-summary" },
          },
        );
        if ("setAppBadge" in navigator)
          await (
            navigator as Navigator & {
              setAppBadge(count: number): Promise<void>;
            }
          ).setAppBadge(todaysTasks.length);
        localStorage.setItem(storageKey, new Date().toISOString());
      },
      Math.max(0, scheduledAt.getTime() - now.getTime()),
    );
    return () => window.clearTimeout(timer);
  }, [profileRecord, scheduledTasks, userId]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobileMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [mobileMenuOpen]);

  const currentSyncMessage =
    syncState?.status === "syncing"
      ? "Syncing"
      : syncState?.status === "auth-paused"
        ? "Sign in to sync"
        : outboxCount
          ? `${outboxCount} saved change${outboxCount === 1 ? "" : "s"}`
          : syncMessage;
  const currentProfile = profileRecord?.value as
    | { displayName?: string; avatarUrl?: string }
    | undefined;
  const currentDisplayName =
    currentProfile?.displayName?.trim() || displayName;

  async function signOut() {
    try {
      const pending = await getDatabase(userId).outbox.count();
      if (pending) {
        setPendingCount(pending);
        return;
      }
      await finishSignOut("discard");
    } catch (error) {
      setSyncMessage(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    }
  }

  async function finishSignOut(choice: "sync" | "export" | "discard") {
    setSignOutBusy(true);
    try {
      const db = getDatabase(userId);
      if (choice === "sync") {
        if (!navigator.onLine)
          throw new Error("Reconnect before syncing changes.");
        await syncNow(userId, getDeviceId(userId));
        const remaining = await db.outbox.count();
        if (remaining)
          throw new Error(
            `${remaining} change${remaining === 1 ? "" : "s"} still need review. Export them or stay signed in.`,
          );
      }
      if (choice === "export") {
        const mutations = await db.outbox.toArray();
        const blob = new Blob(
          [
            JSON.stringify(
              { exportedAt: new Date().toISOString(), mutations },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        );
        const downloadUrl = URL.createObjectURL(blob);
        const anchor = document.createElement("a");
        anchor.href = downloadUrl;
        anchor.download = "nestlist-unsynced-changes.json";
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      }
      const supabase = createClient();
      const subscription = await navigator.serviceWorker
        ?.getRegistration()
        .then((registration) => registration?.pushManager?.getSubscription())
        .catch(() => null);
      if (subscription)
        await fetch("/api/push/unsubscribe", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        }).catch(() => undefined);
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      await deleteUserDatabase(userId);
      localStorage.removeItem(`nestlist-space:${userId}`);
      localStorage.removeItem(`nestlist-device-id:${userId}`);
      localStorage.removeItem("nestlist-last-user-id");
      setPendingCount(0);
      window.location.replace("/login");
    } catch (error) {
      setSyncMessage(
        error instanceof Error ? error.message : "Could not sign out.",
      );
    } finally {
      setSignOutBusy(false);
    }
  }

  return (
    <div className="app-frame">
      <aside className="sidebar">
        <Link className="brand" href="/today">
          <span className="brand-mark">≋</span>
          <span>NestList</span>
        </Link>
        {groups.map((group) => (
          <nav className="nav-group" key={group} aria-label={group}>
            <div className="nav-label">{group}</div>
            {links
              .filter((item) => item.group === group)
              .map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={`nav-link ${pathname === href ? "active" : ""}`}
                >
                  <Icon className="nav-icon" size={17} strokeWidth={1.8} />
                  {label}
                </Link>
              ))}
          </nav>
        ))}
        <div className="side-bottom">
          <Link
            href="/settings"
            className={`nav-link ${pathname === "/settings" ? "active" : ""}`}
          >
            <Settings className="nav-icon" size={17} strokeWidth={1.8} />
            Settings
          </Link>
          <div className="offline-pill">
            <span
              className="online-dot"
              style={{ background: online ? "#73a181" : "#d59767" }}
            />
            {online ? currentSyncMessage : "Offline · changes stay here"}
          </div>
          <div className="user-chip">
            <MemberAvatar
              name={currentDisplayName}
              userId={userId}
              avatarUrl={currentProfile?.avatarUrl}
              size="small"
            />
            <span style={{ flex: 1 }}>{currentDisplayName}</span>
            <button
              type="button"
              className="logout-button"
              onClick={signOut}
              disabled={signOutBusy}
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
      <header className="mobile-header">
        <Link className="brand" href="/today">
          <span className="brand-mark">≋</span>
          <span>NestList</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span className="mobile-sync">
            <Cloud
              size={15}
              style={{ verticalAlign: "middle", marginRight: 5 }}
            />
            {online ? "Up to date" : "Offline"}
          </span>
          <button
            className="logout-button mobile-logout"
            onClick={signOut}
            disabled={signOutBusy}
            aria-label="Sign out"
            title="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="main" key={pathname}>
        {children}
      </main>
      <nav className="mobile-nav" aria-label="Main navigation">
        {links
          .filter(({ href }) => mobilePrimaryHrefs.includes(href))
          .map(({ href, label, icon: Icon }) => (
            <Link
              key={href}
              href={href}
              className={pathname === href ? "active" : ""}
            >
              <span>
                <Icon size={19} strokeWidth={1.8} />
              </span>
              {label}
            </Link>
          ))}
        <button
          type="button"
          className={
            mobileMenuOpen ||
            (!mobilePrimaryHrefs.includes(pathname) && pathname !== "/")
              ? "active"
              : ""
          }
          onClick={() => setMobileMenuOpen(true)}
          aria-expanded={mobileMenuOpen}
          aria-controls="mobile-navigation-sheet"
        >
          <span>
            <Menu size={19} strokeWidth={1.8} />
          </span>
          More
        </button>
      </nav>
      {mobileMenuOpen && (
        <div
          className="mobile-menu-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setMobileMenuOpen(false);
          }}
        >
          <section
            className="mobile-menu-sheet"
            id="mobile-navigation-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="mobile-menu-title"
          >
            <div className="mobile-menu-head">
              <div>
                <span className="section-eyebrow">Navigate</span>
                <h2 id="mobile-menu-title">Everything in one place</h2>
              </div>
              <button
                type="button"
                className="icon-button mobile-menu-close"
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close navigation menu"
                autoFocus
              >
                <X size={20} />
              </button>
            </div>
            <div className="mobile-menu-grid">
              {mobileMenuLinks.map(({ href, label, icon: Icon }) => (
                <Link
                  key={href}
                  href={href}
                  className={pathname === href ? "active" : ""}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <span className="mobile-menu-icon">
                    <Icon size={20} strokeWidth={1.8} />
                  </span>
                  <span>{label}</span>
                </Link>
              ))}
            </div>
            <div className="mobile-menu-account">
              <MemberAvatar
                name={currentDisplayName}
                userId={userId}
                avatarUrl={currentProfile?.avatarUrl}
                size="small"
              />
              <div>
                <strong>{currentDisplayName}</strong>
                <span>
                  {online ? currentSyncMessage : "Offline · changes stay here"}
                </span>
              </div>
              <button
                type="button"
                className="logout-button"
                onClick={signOut}
                disabled={signOutBusy}
                aria-label="Sign out"
                title="Sign out"
              >
                <LogOut size={17} />
              </button>
            </div>
          </section>
        </div>
      )}
      {pendingCount > 0 && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="signout-title"
          className="modal-backdrop"
        >
          <section className="modal-card">
            <h2 id="signout-title">Keep your unsynced changes safe</h2>
            <p>
              {pendingCount} change{pendingCount === 1 ? " is" : "s are"}{" "}
              waiting to sync. Choose what to do before removing this account’s
              local copy.
            </p>
            <button
              className="button"
              disabled={signOutBusy || !online}
              onClick={() => finishSignOut("sync")}
            >
              Sync, then sign out
            </button>
            <button
              className="modal-option"
              disabled={signOutBusy}
              onClick={() => finishSignOut("export")}
            >
              Download changes, then sign out
            </button>
            <button
              className="modal-option danger"
              disabled={signOutBusy}
              onClick={() => finishSignOut("discard")}
            >
              Discard changes and sign out
            </button>
            <button
              className="subtle-button"
              disabled={signOutBusy}
              onClick={() => setPendingCount(0)}
            >
              Stay signed in
            </button>
          </section>
        </div>
      )}
      {updateReady && (
        <div className="update-banner" role="status">
          <span>A new NestList version is ready.</span>
          <button
            className="button"
            onClick={() => {
              updateReady.waiting?.postMessage({ type: "SKIP_WAITING" });
              location.reload();
            }}
          >
            Update now
          </button>
          <button
            className="subtle-button"
            onClick={() => setUpdateReady(null)}
          >
            Later
          </button>
        </div>
      )}
    </div>
  );
}
