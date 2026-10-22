"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { useLiveQuery } from "dexie-react-hooks";
import { Check, Plus } from "lucide-react";
import { getDatabase } from "@/lib/db/client-db";
import type { LocalTask } from "@/lib/db/types";
import { completeTask, createTask } from "@/lib/db/repositories/tasks";
import { parseTask } from "@/lib/tasks/parser";

export default function OfflinePage() {
  const [userId] = useState<string | null>(() =>
    typeof localStorage === "undefined"
      ? null
      : localStorage.getItem("nestlist-last-user-id"),
  );
  const db = useMemo(() => (userId ? getDatabase(userId) : null), [userId]);
  const tasks =
    useLiveQuery(
      async () =>
        db ? db.tasks.filter((task) => !task._deleted).toArray() : [],
      [db],
      [],
    ) ?? [];
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState("");
  const open = tasks
    .filter((task) => task.status === "open")
    .sort((a, b) => a.rank.localeCompare(b.rank));

  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!userId || !draft.trim()) return;
    const space = localStorage.getItem(`nestlist-space:${userId}`);
    if (!space) {
      setMessage(
        "Reconnect once to create your personal Inbox. Existing saved tasks are still available here.",
      );
      return;
    }
    try {
      const ids = JSON.parse(space) as { id: string; inboxId: string };
      const parsed = parseTask(draft);
      const today = new Date().toLocaleDateString("en-CA");
      const bucket = parsed.scheduledDate
        ? parsed.scheduledDate === today
          ? "today"
          : "planned"
        : "later";
      await createTask(userId, ids.id, ids.inboxId, {
        title: parsed.title,
        effort: parsed.effort,
        bucket,
        scheduledDate: parsed.scheduledDate,
        remindAt: parsed.remindAt,
      });
      setDraft("");
      setMessage("Saved offline. It will sync after you reconnect.");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not save that task.",
      );
    }
  }

  async function complete(task: LocalTask) {
    if (!userId) return;
    const done = task.status !== "completed";
    await completeTask(userId, task, done);
  }

  return (
    <main className="main" style={{ maxWidth: 760 }}>
      <div className="brand">
        <span className="brand-mark">≋</span>
        <span>NestList</span>
      </div>
      <h1 className="greeting">Your saved plans.</h1>
      <p className="subtitle">
        Offline · changes are stored on this device and will sync when you
        reconnect.
      </p>
      {!userId ? (
        <div className="empty">
          Sign in online once to make your tasks available offline on this
          device.
        </div>
      ) : (
        <>
          <div className="section-head">
            <h2>Open tasks</h2>
            <span className="task-count">{open.length}</span>
          </div>
          <div className="task-list">
            {open.map((task) => (
              <div className="task-row" key={task.id}>
                <button
                  className="task-check"
                  aria-label={`Complete ${task.title}`}
                  onClick={() => complete(task)}
                />
                <span className="task-title">{task.title}</span>
                <span className="effort">{task.effort}</span>
              </div>
            ))}
            {open.length === 0 && (
              <div className="empty">Nothing open right now.</div>
            )}
          </div>
          <form
            className="composer"
            onSubmit={addTask}
            style={{ marginTop: 20 }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add something to remember"
              aria-label="New offline task"
              maxLength={500}
            />
            <div className="composer-bottom">
              <span>
                <Check size={13} style={{ verticalAlign: "middle" }} /> Stored
                locally
              </span>
              <button className="button" disabled={!draft.trim()}>
                <Plus size={14} style={{ verticalAlign: "middle" }} /> Add
              </button>
            </div>
          </form>
        </>
      )}
      {message && (
        <div role="status" className="toast">
          {message}
        </div>
      )}
      <p style={{ marginTop: 30, color: "#89928b", fontSize: 12 }}>
        <Link href="/today">Reconnect and open NestList</Link>
      </p>
    </main>
  );
}
