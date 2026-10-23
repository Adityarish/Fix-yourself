"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDatabase } from "@/lib/db/client-db";
import { History } from "lucide-react";

export function ActivityPanel({ userId }: { userId: string }) {
  const db = useMemo(() => getDatabase(userId), [userId]);
  const activity =
    useLiveQuery(() => db.activity.reverse().sortBy("sequence"), [db]) ?? [];
  return (
    <>
      <div className="topline">
        <span>History</span>
        <span>{activity.length} events on this device</span>
      </div>
      <h1 className="greeting">Recent activity.</h1>
      <p className="subtitle">
        A clear trail of the progress you make together.
      </p>
      <div className="feature-stack activity-timeline">
        {activity.map((item) => (
          <article className="feature-card activity-event" key={item.sequence}>
            <span className="activity-marker" aria-hidden="true">
              <History size={16} />
            </span>
            <strong>{item.summary}</strong>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </article>
        ))}
        {!activity.length && (
          <div className="empty activity-empty">
            <History size={26} aria-hidden="true" />
            <strong>Your story starts here</strong>
            <span>
              Synced changes will appear here as you plan and complete tasks.
            </span>
          </div>
        )}
      </div>
    </>
  );
}
