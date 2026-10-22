"use client";

import { useEffect, useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Crown, MailPlus, ShieldCheck, Trash2, UserRound } from "lucide-react";
import { getDatabase } from "@/lib/db/client-db";
import {
  createCircleInvite,
  createSpaceList,
  listCircleInvites,
  removeCircleMember,
  updateCircleMemberRole,
  type SentCircleInvite,
} from "@/lib/db/repositories/spaces";
import { createTask } from "@/lib/db/repositories/tasks";
import { getDeviceId } from "@/lib/db/repositories/outbox";
import { syncNow } from "@/lib/sync/engine";
import { MemberAvatar } from "@/components/member-avatar";

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
  const [sentInvites, setSentInvites] = useState<SentCircleInvite[]>([]);
  const owner = space?.ownerId === userId;
  const currentMember = members.find((member) => member.userId === userId);
  const canManageMembers = owner || currentMember?.role === "admin";

  useEffect(() => {
    let active = true;
    if (!canManageMembers || !navigator.onLine) {
      setSentInvites([]);
      return;
    }
    void listCircleInvites(circleId)
      .then((invitations) => {
        if (active) setSentInvites(invitations);
      })
      .catch(() => {
        if (active) setSentInvites([]);
      });
    return () => {
      active = false;
    };
  }, [canManageMembers, circleId]);

  if (!space)
    return (
      <div className="empty">
        This Circle is unavailable offline or you no longer have access.
      </div>
    );
  const leaders = members
    .filter((member) => member.role === "owner" || member.role === "admin")
    .sort((a, b) =>
      a.role === "owner"
        ? -1
        : b.role === "owner"
          ? 1
          : (a.displayName ?? "").localeCompare(b.displayName ?? ""),
    );
  const regularMembers = members
    .filter((member) => member.role === "member")
    .sort((a, b) => (a.displayName ?? "").localeCompare(b.displayName ?? ""));

  async function changeRole(memberId: string, role: "admin" | "member") {
    try {
      await updateCircleMemberRole(circleId, memberId, role);
      await syncNow(userId, getDeviceId(userId));
      setMessage(
        role === "admin"
          ? "Member is now an admin."
          : "Admin changed to member.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not change this role.",
      );
    }
  }

  async function removeMember(memberId: string, displayName: string) {
    if (!window.confirm(`Remove ${displayName} from this Circle?`)) return;
    try {
      await removeCircleMember(circleId, memberId);
      await syncNow(userId, getDeviceId(userId));
      setMessage("Member removed. Access ends immediately.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Could not remove this member.",
      );
    }
  }

  function memberRow(member: (typeof members)[number]) {
    const displayName = member.displayName?.trim() || "Circle member";
    const isCurrentUser = member.userId === userId;
    return (
      <article className="circle-member-card" key={member.key}>
        <MemberAvatar
          name={displayName}
          userId={member.userId}
          avatarUrl={member.avatarUrl}
          size="large"
        />
        <div className="circle-member-copy">
          <div className="circle-member-name">
            <strong>{displayName}</strong>
            {isCurrentUser && <span className="you-badge">You</span>}
          </div>
          <span className={`role-badge role-${member.role}`}>
            {member.role === "owner" ? (
              <Crown size={13} />
            ) : member.role === "admin" ? (
              <ShieldCheck size={13} />
            ) : (
              <UserRound size={13} />
            )}
            {member.role}
          </span>
          <small>
            {member.role === "owner"
              ? "Owns the Circle and manages roles"
              : member.role === "admin"
                ? "Can invite people and manage shared plans"
                : "Can view and contribute to shared plans"}
          </small>
        </div>
        {owner && member.role !== "owner" && (
          <div className="member-controls">
            <label>
              <span className="sr-only">Role for {displayName}</span>
              <select
                value={member.role}
                onChange={(event) =>
                  void changeRole(
                    member.userId,
                    event.target.value as "admin" | "member",
                  )
                }
                aria-label={`Role for ${displayName}`}
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            </label>
            <button
              type="button"
              className="icon-button danger-icon member-remove"
              onClick={() => void removeMember(member.userId, displayName)}
              aria-label={`Remove ${displayName}`}
              title={`Remove ${displayName}`}
            >
              <Trash2 size={16} />
            </button>
          </div>
        )}
      </article>
    );
  }

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
        <section className="members-panel">
          <div className="member-summary">
            <div>
              <span className="section-eyebrow">Circle access</span>
              <h2>
                {members.length} active{" "}
                {members.length === 1 ? "member" : "members"}
              </h2>
              <p>
                Owners and admins manage the Circle. Members can collaborate on
                its plans.
              </p>
            </div>
            <div className="member-summary-counts" aria-label="Role summary">
              <span>
                <ShieldCheck size={15} /> {leaders.length} managing
              </span>
              <span>
                <UserRound size={15} /> {regularMembers.length} members
              </span>
            </div>
          </div>
          {canManageMembers && (
            <form
              className="member-invite-card"
              onSubmit={(event) => {
                event.preventDefault();
                void createCircleInvite(circleId, email)
                  .then(async (value) => {
                    setEmail("");
                    setMessage(
                      value.delivered
                        ? "Invitation sent."
                        : `Invite created, but email delivery failed. ${value.deliveryError ?? "Copy and share the invitation link."}`,
                    );
                    setSentInvites(await listCircleInvites(circleId));
                  })
                  .catch((error) => setMessage(error.message));
              }}
            >
              <div className="member-invite-copy">
                <span className="invite-icon">
                  <MailPlus size={18} />
                </span>
                <div>
                  <strong>Invite someone</strong>
                  <small>New people join as members.</small>
                </div>
              </div>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="person@example.com"
                aria-label="Invite by email"
                required
              />
              <button className="button">Send invite</button>
            </form>
          )}
          {canManageMembers && (
            <div className="member-group">
              <div className="member-group-title">
                <span>Invitation requests</span>
                <span>
                  {
                    sentInvites.filter((invite) => invite.status === "pending")
                      .length
                  }{" "}
                  pending
                </span>
              </div>
              <div className="sent-invite-list">
                {sentInvites.map((invite) => (
                  <article className="sent-invite-row" key={invite.id}>
                    <span className="invite-icon">
                      <MailPlus size={16} />
                    </span>
                    <div>
                      <strong>{invite.email}</strong>
                      <small>
                        Sent {new Date(invite.createdAt).toLocaleDateString()} ·
                        expires {new Date(invite.expiresAt).toLocaleDateString()}
                      </small>
                    </div>
                    <div className="sent-invite-statuses">
                      <span className={`invite-status status-${invite.status}`}>
                        {invite.status}
                      </span>
                      <span
                        className={`delivery-status delivery-${invite.emailDeliveryStatus}`}
                        title={invite.emailDeliveryError ?? undefined}
                      >
                        {invite.emailDeliveryStatus === "sent"
                          ? "Email sent"
                          : invite.emailDeliveryStatus === "failed"
                            ? "Email failed"
                            : "Email pending"}
                      </span>
                    </div>
                  </article>
                ))}
                {!sentInvites.length && (
                  <div className="empty member-empty">
                    No invitations have been sent yet.
                  </div>
                )}
              </div>
            </div>
          )}
          <div className="member-group">
            <div className="member-group-title">
              <span>Owners &amp; admins</span>
              <span>{leaders.length}</span>
            </div>
            <div className="member-list">{leaders.map(memberRow)}</div>
          </div>
          <div className="member-group">
            <div className="member-group-title">
              <span>Members</span>
              <span>{regularMembers.length}</span>
            </div>
            <div className="member-list">
              {regularMembers.map(memberRow)}
              {!regularMembers.length && (
                <div className="empty member-empty">
                  No regular members yet.
                </div>
              )}
            </div>
          </div>
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
