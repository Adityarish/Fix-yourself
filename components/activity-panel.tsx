"use client";

import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDatabase } from "@/lib/db/client-db";

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
      <div className="feature-stack">
        {activity.map((item) => (
          <article className="feature-card" key={item.sequence}>
            <strong>{item.summary}</strong>
            <small>{new Date(item.createdAt).toLocaleString()}</small>
          </article>
        ))}
        {!activity.length && (
          <div className="empty">Synced changes will appear here.</div>
        )}
      </div>
    </>
  );
}
