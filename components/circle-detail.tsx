"use client";

import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { getDatabase } from "@/lib/db/client-db";
import {
  createCircleInvite,
  createSpaceList,
  removeCircleMember,
} from "@/lib/db/repositories/spaces";
import { createTask } from "@/lib/db/repositories/tasks";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { syncNow } from "@/lib/sync/engine";

export function CircleDetail({
  userId,
  circleId,
}: {
  userId: string;
  circleId: string;
}) {
  const db = useMemo(() => getDatabase(userId), [userId]);
  const space = useLiveQuery(() => db.spaces.get(circleId), [db, circleId]);
  const members =
    useLiveQuery(
      () =>
        db.spaceMembers
          .where("spaceId")
          .equals(circleId)
          .filter((member) => member.status === "active")
          .toArray(),
      [db, circleId],
    ) ?? [];
  const tasks =
    useLiveQuery(
      () =>
        db.tasks
          .where("spaceId")
          .equals(circleId)
          .filter((task) => !task._deleted)
          .toArray(),
      [db, circleId],
    ) ?? [];
  const lists =
    useLiveQuery(
      () =>
        db.lists
          .where("spaceId")
          .equals(circleId)
          .filter((list) => !list._deleted)
          .sortBy("rank"),
      [db, circleId],
    ) ?? [];
  const activity =
    useLiveQuery(
      () =>
        db.activity
          .where("spaceId")
          .equals(circleId)
          .reverse()
          .sortBy("sequence"),
      [db, circleId],
    ) ?? [];
  const [tab, setTab] = useState<"tasks" | "members" | "activity">("tasks");
  const [email, setEmail] = useState("");
  const [draft, setDraft] = useState("");
  const [assignee, setAssignee] = useState("");
  const [selectedList, setSelectedList] = useState("");
  const [newList, setNewList] = useState("");
  const [message, setMessage] = useState("");
  if (!space)
    return (
      <div className="empty">
        This Circle is unavailable offline or you no longer have access.
      </div>
    );
  const owner = space.ownerId === userId;
  return (
    <>
      <div className="topline">
        <span>Circle</span>
        <span>{members.length} members</span>
      </div>
      <h1 className="greeting">{space.name}</h1>
      <div className="tabs">
        {(["tasks", "members", "activity"] as const).map((value) => (
          <button
            key={value}
            className={tab === value ? "active" : ""}
            onClick={() => setTab(value)}
          >
            {value}
          </button>
        ))}
      </div>
      {tab === "tasks" && (
        <>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createSpaceList(circleId, newList)
                .then(() => syncNow(userId, getDeviceId(userId)))
                .then(() => {
                  setNewList("");
                  setMessage("Shared list created.");
                })
                .catch((error) => setMessage(error.message));
            }}
          >
            <input
              value={newList}
              onChange={(event) => setNewList(event.target.value)}
              placeholder="New shared list"
              maxLength={120}
              required
            />
            <button className="subtle-button">Create list</button>
          </form>
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              const listId = selectedList || lists[0]?.id;
              if (!listId) return;
              void createTask(userId, circleId, listId, {
                title: draft,
                bucket: "later",
                effort: "normal",
                scheduledDate: null,
                assigneeId: assignee || null,
              }).then(() => {
                setDraft("");
                if (navigator.onLine) void syncNow(userId, getDeviceId(userId));
              });
            }}
          >
            <input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a shared task"
              required
            />
            <select
              value={selectedList}
              onChange={(event) => setSelectedList(event.target.value)}
              aria-label="List"
            >
              {lists.map((list) => (
                <option key={list.id} value={list.id}>
                  {list.name}
                </option>
              ))}
            </select>
            <select
              value={assignee}
              onChange={(event) => setAssignee(event.target.value)}
              aria-label="Assignee"
            >
              <option value="">Unassigned</option>
              {members.map((member) => (
                <option key={member.userId} value={member.userId}>
                  {member.displayName ?? "Member"}
                </option>
              ))}
            </select>
            <button className="button">Add</button>
          </form>
          <div className="task-list">
            {tasks.map((task) => (
              <div className="task-row" key={task.id}>
                <span className="task-title">{task.title}</span>
                <span className="task-meta">
                  {task.status} ·{" "}
                  {task.assigneeId
                    ? (members.find(
                        (member) => member.userId === task.assigneeId,
                      )?.displayName ?? "Assigned")
                    : "Unassigned"}
                </span>
              </div>
            ))}
            {!tasks.length && <div className="empty">No shared tasks yet.</div>}
          </div>
        </>
      )}
      {tab === "members" && (
        <section className="feature-stack">
          <form
            className="inline-form"
            onSubmit={(event) => {
              event.preventDefault();
              void createCircleInvite(circleId, email)
                .then((value) => {
                  setEmail("");
                  setMessage(
                    value.delivered
                      ? "Invitation sent."
                      : `Invite ready: ${value.inviteUrl}`,
                  );
                })
                .catch((error) => setMessage(error.message));
            }}
          >
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Invite by email"
              required
            />
            <button className="button">Invite</button>
          </form>
          {members.map((member) => (
            <div className="feature-card member-row" key={member.key}>
              <span className="avatar">{(member.displayName ?? "M")[0]}</span>
              <div>
                <strong>{member.displayName ?? "Member"}</strong>
                <small>{member.role}</small>
              </div>
              {owner && member.userId !== userId && (
                <button
                  className="subtle-button"
                  onClick={() =>
                    removeCircleMember(circleId, member.userId).then(() =>
                      setMessage("Member removed. Access ends immediately."),
                    )
                  }
                >
                  Remove
                </button>
              )}
            </div>
          ))}
        </section>
      )}
      {tab === "activity" && (
        <div className="feature-stack">
          {activity.map((item) => (
            <div className="feature-card" key={item.sequence}>
              <strong>{item.summary}</strong>
              <small>{new Date(item.createdAt).toLocaleString()}</small>
            </div>
          ))}
          {!activity.length && (
            <div className="empty">Activity appears after the next sync.</div>
          )}
        </div>
      )}
      {message && (
        <div className="toast" role="status">
          {message}
        </div>
      )}
    </>
  );
}
