import { getDeviceId } from "@/lib/db/repositories/outbox";
import { createClient } from "@/lib/supabase/browser";

export type PushStatus = "unsupported" | "blocked" | "available" | "enabled";

function decodeBase64Url(value: string) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4);
  const binary = atob((value + padding).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export async function enablePush(userId: string) {
  if (
    !("serviceWorker" in navigator) ||
    !("PushManager" in window) ||
    !("Notification" in window)
  )
    throw new Error("Push notifications are not supported in this browser.");
  const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!vapid) throw new Error("Push notifications are not configured.");
  const existingRegistration = await navigator.serviceWorker.getRegistration();
  if (!existingRegistration && process.env.NODE_ENV === "development")
    throw new Error(
      "PWA notifications are disabled by the development server. Run a production build to enable them.",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("Notification permission was not granted.");
  const registration =
    existingRegistration ?? (await navigator.serviceWorker.ready);
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: decodeBase64Url(vapid),
  });
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
  if (!response.ok)
    throw new Error("Could not save this browser for reminders.");
  return subscription;
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
