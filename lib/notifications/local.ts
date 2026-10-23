export type LocalNotice = {
  title: string;
  body: string;
  tag: string;
  url: string;
};
export const NOTICE_EVENT = "nestlist-notice";

// Always provide visible feedback in the app, even if OS banners are blocked.
export async function showLocalNotice(notice: LocalNotice) {
  window.dispatchEvent(
    new CustomEvent<LocalNotice>(NOTICE_EVENT, { detail: notice }),
  );
  if (!("Notification" in window) || Notification.permission !== "granted")
    return false;
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    const options = {
      body: notice.body,
      tag: notice.tag,
      icon: "/icons/icon-192.svg",
      data: { url: notice.url },
    };
    if (registration?.active)
      await registration.showNotification(notice.title, options);
    else {
      const notification = new Notification(notice.title, options);
      notification.onclick = () => {
        window.focus();
        window.location.assign(notice.url);
        notification.close();
      };
    }
    return true;
  } catch {
    return false;
  }
}

type Reminder = {
  id: string;
  remindAt?: string | null;
  title: string;
  assigneeId?: string | null;
  creatorId: string;
};
export function startReminderScheduler(
  tasks: Reminder[],
  userId: string,
  delivered: Set<string>,
  notify: (notice: LocalNotice) => Promise<unknown> = showLocalNotice,
) {
  let running = false;
  let stopped = false;
  const check = async () => {
    if (running || stopped) return;
    running = true;
    try {
      for (const task of tasks) {
        if (stopped) break;
        if ((task.assigneeId || task.creatorId) !== userId || !task.remindAt)
          continue;
        const due = Date.parse(task.remindAt);
        const key = `${userId}:${task.id}:${task.remindAt}`;
        if (!Number.isFinite(due) || due > Date.now() || delivered.has(key))
          continue;
        try {
          await notify({
            title: "NestList reminder",
            body: task.title,
            tag: `task-${task.id}`,
            url: `/today?task=${encodeURIComponent(task.id)}`,
          });
          delivered.add(key);
        } catch {
          /* Retry on the next check if delivery itself failed. */
        }
      }
    } finally {
      running = false;
    }
  };
  void check();
  const timer = window.setInterval(() => void check(), 1000);
  window.addEventListener("focus", check);
  return () => {
    stopped = true;
    window.clearInterval(timer);
    window.removeEventListener("focus", check);
  };
}
