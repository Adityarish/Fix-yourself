"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
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
} from "lucide-react";
import { deleteUserDatabase, getDatabase } from "@/lib/db/client-db";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { createClient } from "@/lib/supabase/browser";
import { syncNow } from "@/lib/sync/engine";

const links = [
  { href: "/today", label: "Today", icon: Home, group: "PLAN" },
  { href: "/planned", label: "Planned", icon: CalendarDays, group: "PLAN" },
  { href: "/later", label: "Later", icon: Archive, group: "PLAN" },
  { href: "/routines", label: "Routines", icon: Repeat2, group: "YOUR SPACE" },
  { href: "/circles", label: "Circles", icon: Users, group: "YOUR SPACE" },
  { href: "/search", label: "Search", icon: Search, group: "YOUR SPACE" },
  { href: "/activity", label: "Activity", icon: History, group: "YOUR SPACE" },
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
  const router = useRouter();
  const [online, setOnline] = useState(() =>
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [syncMessage, setSyncMessage] = useState("Synced");
  const [pendingCount, setPendingCount] = useState(0);
  const [signOutBusy, setSignOutBusy] = useState(false);
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
        if (Notification.permission !== "granted") return;
        const registration = await navigator.serviceWorker?.ready;
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

  const currentSyncMessage =
    syncState?.status === "syncing"
      ? "Syncing"
      : syncState?.status === "auth-paused"
        ? "Sign in to sync"
        : outboxCount
          ? `${outboxCount} saved change${outboxCount === 1 ? "" : "s"}`
          : syncMessage;

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
      const subscription = await navigator.serviceWorker?.ready
        .then((registration) => registration.pushManager?.getSubscription())
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
      router.replace("/login");
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
          <button
            className="user-chip"
            onClick={signOut}
            style={{
              border: 0,
              background: "transparent",
              textAlign: "left",
              color: "inherit",
            }}
          >
            <span className="avatar">
              {displayName.slice(0, 1).toUpperCase()}
            </span>
            <span style={{ flex: 1 }}>{displayName}</span>
            <LogOut size={15} />
          </button>
        </div>
      </aside>
      <header className="mobile-header">
        <Link className="brand" href="/today">
          <span className="brand-mark">≋</span>
          <span>NestList</span>
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <span style={{ color: "#77817c", fontSize: 11 }}>
            <Cloud
              size={15}
              style={{ verticalAlign: "middle", marginRight: 5 }}
            />
            {online ? "Up to date" : "Offline"}
          </span>
          <button
            className="subtle-button"
            onClick={signOut}
            aria-label="Sign out"
          >
            <LogOut size={16} />
          </button>
        </div>
      </header>
      <main className="main">{children}</main>
      <nav className="mobile-nav" aria-label="Main navigation">
        {links.slice(0, 5).map(({ href, label, icon: Icon }) => (
          <Link
            key={href}
            href={href}
            className={pathname === href ? "active" : ""}
          >
            <span>
              <Icon size={18} strokeWidth={1.8} />
            </span>
            {label}
          </Link>
        ))}
      </nav>
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
