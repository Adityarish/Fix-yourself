import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import {
  CacheFirst,
  ExpirationPlugin,
  Serwist,
  StaleWhileRevalidate,
} from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: false,
  clientsClaim: true,
  navigationPreload: true,
  // Authenticated navigations are never cached; the precached offline route
  // reads only the currently selected account's IndexedDB database.
  runtimeCaching: [
    {
      matcher: ({ request, url }) =>
        url.origin === self.location.origin &&
        ["script", "style", "font", "worker"].includes(request.destination),
      handler: new CacheFirst({
        cacheName: "nestlist-static",
        plugins: [
          new ExpirationPlugin({ maxEntries: 80, maxAgeSeconds: 2_592_000 }),
        ],
      }),
    },
    {
      matcher: ({ request, url }) =>
        url.origin === self.location.origin &&
        request.destination === "image" &&
        url.pathname.startsWith("/icons/"),
      handler: new StaleWhileRevalidate({
        cacheName: "nestlist-public",
        plugins: [
          new ExpirationPlugin({ maxEntries: 30, maxAgeSeconds: 604_800 }),
        ],
      }),
    },
  ],
  fallbacks: {
    entries: [
      {
        url: "/~offline",
        matcher: ({ request }) => request.destination === "document",
      },
    ],
  },
});

serwist.addEventListeners();

self.addEventListener("push", (event) => {
  const payload = event.data?.json() as
    | {
        title?: string;
        body?: string;
        taskId?: string;
        kind?: "task-reminder" | "routine-reminder" | "daily-summary";
        taskCount?: number;
        localDate?: string;
        url?: string;
      }
    | undefined;
  const dailySummary = payload?.kind === "daily-summary";
  event.waitUntil(
    Promise.all([
      self.registration.showNotification(
        payload?.title ?? "NestList reminder",
        {
          body: payload?.body ?? "A task is ready when you are.",
          icon: "/icons/icon-192.svg",
          badge: "/icons/icon-192.svg",
          tag: dailySummary
            ? `daily-summary-${payload?.localDate ?? new Date().toISOString().slice(0, 10)}`
            : payload?.taskId
              ? `task-${payload.taskId}`
              : undefined,
          data: {
            url:
              payload?.url ??
              (payload?.taskId
                ? `/today?task=${encodeURIComponent(payload.taskId)}`
                : "/today"),
            kind: payload?.kind,
          },
          actions: dailySummary
            ? [{ action: "open", title: "Open today" }]
            : [
                { action: "done", title: "Done" },
                { action: "snooze", title: "Snooze 10 min" },
              ],
        } as NotificationOptions & {
          actions: Array<{ action: string; title: string }>;
        },
      ),
      payload?.taskCount && "setAppBadge" in self.navigator
        ? (
            self.navigator as WorkerNavigator & {
              setAppBadge(count: number): Promise<void>;
            }
          ).setAppBadge(payload.taskCount)
        : Promise.resolve(),
    ]),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const base = (event.notification.data?.url as string | undefined) ?? "/today";
  const url = new URL(base, self.location.origin);
  if (event.action === "done" || event.action === "snooze")
    url.searchParams.set("action", event.action);
  const target = url.toString();
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then(async (windowClients) => {
        if ("clearAppBadge" in self.navigator)
          await (
            self.navigator as WorkerNavigator & {
              clearAppBadge(): Promise<void>;
            }
          ).clearAppBadge();
        const existing = windowClients.find(
          (client) => new URL(client.url).origin === self.location.origin,
        ) as WindowClient | undefined;
        if (existing) {
          await existing.navigate(target);
          return existing.focus();
        }
        return self.clients.openWindow(target);
      }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") void self.skipWaiting();
});

self.addEventListener("sync", (event) => {
  if (event.tag !== "nestlist-sync") return;
  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        clients.forEach((client) =>
          client.postMessage({ type: "NESTLIST_SYNC" }),
        );
      }),
  );
});
