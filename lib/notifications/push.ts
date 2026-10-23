import { showLocalNotice } from "./local";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { createClient } from "@/lib/supabase/browser";

export type PushStatus = "unsupported" | "blocked" | "available" | "enabled";

export type PushEnvironment = {
  installed: boolean;
  ios: boolean;
};

function decodeBase64Url(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function getPushEnvironment(): PushEnvironment {
  if (typeof window === "undefined") return { installed: false, ios: false };
  const navigatorWithStandalone = navigator as Navigator & {
    standalone?: boolean;
  };
  return {
    installed:
      window.matchMedia("(display-mode: standalone)").matches ||
      navigatorWithStandalone.standalone === true,
    ios:
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1),
  };
}

async function getNotificationRegistration() {
  let registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration && process.env.NODE_ENV === "production") {
    registration = await navigator.serviceWorker.register("/sw.js", {
      scope: "/",
    });
  }
  if (!registration)
    throw new Error(
      "Notifications are available after installing a production build of NestList.",
    );
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(
              "Notification setup timed out. Reload the app and try again.",
            ),
          ),
        10000,
      ),
    ),
  ]);
}

export async function enablePush(userId: string) {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    throw new Error("Push notifications are not supported in this browser.");
  const environment = getPushEnvironment();
  if (environment.ios && !environment.installed)
    throw new Error(
      "On iPhone or iPad, open NestList in Safari, choose Share, then Add to Home Screen before enabling notifications.",
    );
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) throw new Error("Push notifications are not configured.");
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      permission === "denied"
        ? "Notifications are blocked. Allow them in this device's browser or app settings, then try again."
        : "Notification permission was not granted.",
    );
  const registration = await getNotificationRegistration();
  const subscription =
    (await registration.pushManager.getSubscription()) ??
    (await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: decodeBase64Url(vapid),
    }));
  const json = subscription.toJSON();
  const response = await fetch("/api/push/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      deviceId: getDeviceId(userId),
      endpoint: subscription.endpoint,
      keys: json.keys,
    }),
  });
  if (!response.ok) {
    const result = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;
    throw new Error(
      result?.error ?? "Could not save this browser for reminders.",
    );
  }
  return subscription;
}

export async function showTestNotification() {
  if ("Notification" in window && Notification.permission === "default") {
    await Notification.requestPermission().catch(() => "default");
  }
  return showLocalNotice({
    title: "NestList notification test",
    body: "On-device popups are working. Reminders appear here while NestList is open.",
    tag: `nestlist-test-${Date.now()}`,
    url: "/today",
  });
}

export async function disablePush() {
  const registration = await navigator.serviceWorker?.getRegistration();
  if (!registration) return;
  const subscription = await registration.pushManager.getSubscription();
  if (!subscription) return;
  await fetch("/api/push/unsubscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  await subscription.unsubscribe();
}

export async function getPushStatus(): Promise<PushStatus> {
  if (
    typeof window === "undefined" ||
    !("Notification" in window) ||
    !("serviceWorker" in navigator) ||
    !("PushManager" in window)
  )
    return "unsupported";
  const environment = getPushEnvironment();
  if (environment.ios && !environment.installed) return "unsupported";
  if (Notification.permission === "denied") return "blocked";
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? "enabled" : "available";
}

export async function saveDailySummaryPreferences(
  enabled: boolean,
  localTime: string,
) {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime))
    throw new Error("Choose a valid daily summary time.");
  const { error } = await createClient().rpc(
    "update_notification_preferences",
    {
      p_daily_digest_enabled: enabled,
      p_daily_digest_time: `${localTime}:00`,
    },
  );
  if (error) throw error;
}
