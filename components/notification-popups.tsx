"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { NOTICE_EVENT, type LocalNotice } from "@/lib/notifications/local";

export function NotificationPopups() {
  const [notices, setNotices] = useState<LocalNotice[]>([]);
  useEffect(() => {
    const receive = (event: Event) => {
      const notice = (event as CustomEvent<LocalNotice>).detail;
      setNotices((previous) => [
        ...previous.filter((item) => item.tag !== notice.tag),
        notice,
      ]);
    };
    window.addEventListener(NOTICE_EVENT, receive);
    return () => window.removeEventListener(NOTICE_EVENT, receive);
  }, []);
  return (
    <section
      className="notification-popups"
      aria-label="Notifications"
      aria-live="polite"
      aria-relevant="additions"
    >
      {notices.map((notice) => (
        <article key={notice.tag} className="notification-popup">
          <strong>{notice.title}</strong>
          <p>{notice.body}</p>
          <Link
            href={notice.url}
            onClick={() =>
              setNotices((items) =>
                items.filter((item) => item.tag !== notice.tag),
              )
            }
          >
            View
          </Link>
          <button
            type="button"
            onClick={() =>
              setNotices((items) =>
                items.filter((item) => item.tag !== notice.tag),
              )
            }
            aria-label={`Dismiss ${notice.title}`}
          >
            Dismiss
          </button>
        </article>
      ))}
    </section>
  );
}
