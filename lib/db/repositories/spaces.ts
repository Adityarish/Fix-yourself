import { z } from "zod";
import { createClient } from "@/lib/supabase/browser";
import type { MemberRole } from "@/lib/db/types";

export interface CircleInviteRequest {
  id: string;
  spaceId: string;
  circleName: string;
  role: Exclude<MemberRole, "owner">;
  invitedBy: string;
  invitedByName: string;
  invitedByAvatarUrl: string | null;
  createdAt: string;
  expiresAt: string;
}

export type CircleInviteStatus =
  "pending" | "accepted" | "declined" | "revoked" | "expired";

export interface SentCircleInvite {
  id: string;
  email: string;
  role: Exclude<MemberRole, "owner">;
  status: CircleInviteStatus;
  emailDeliveryStatus: "pending" | "sent" | "failed";
  emailDeliveryError: string | null;
  createdAt: string;
  expiresAt: string;
}

export async function createCircle(name: string) {
  const validName = z.string().trim().min(1).max(120).parse(name);
  const { data, error } = await createClient().rpc("create_circle", {
    p_name: validName,
  });
  if (error) throw error;
  return data as { space_id: string; inbox_list_id: string };
}

export async function createCircleInvite(spaceId: string, email: string) {
  z.string().uuid().parse(spaceId);
  const validEmail = z.string().email().parse(email);
  const response = await fetch("/api/circles/invite", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ spaceId, email: validEmail }),
  });
  const payload = (await response.json()) as {
    inviteUrl?: string;
    delivered?: boolean;
    deliveryError?: string;
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error ?? "Could not create invitation.");
  return payload;
}

export async function listMyCircleInvites() {
  const response = await fetch("/api/circles/requests", { cache: "no-store" });
  const payload = (await response.json()) as {
    invitations?: CircleInviteRequest[];
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error ?? "Could not load Circle invitations.");
  return payload.invitations ?? [];
}

export async function respondToCircleInvite(inviteId: string, accept: boolean) {
  const response = await fetch("/api/circles/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      inviteId: z.string().uuid().parse(inviteId),
      response: accept ? "accept" : "decline",
    }),
  });
  const payload = (await response.json()) as {
    spaceId?: string;
    status?: "accepted" | "declined";
    error?: string;
  };
  if (!response.ok || !payload.spaceId || !payload.status)
    throw new Error(payload.error ?? "Could not respond to this invitation.");
  return { spaceId: payload.spaceId, status: payload.status };
}

export async function listCircleInvites(spaceId: string) {
  const validSpaceId = z.string().uuid().parse(spaceId);
  const response = await fetch(
    `/api/circles/requests?spaceId=${encodeURIComponent(validSpaceId)}`,
    { cache: "no-store" },
  );
  const payload = (await response.json()) as {
    invitations?: SentCircleInvite[];
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error ?? "Could not load sent invitations.");
  return payload.invitations ?? [];
}

export async function removeCircleMember(spaceId: string, memberId: string) {
  const { error } = await createClient().rpc("remove_space_member", {
    p_space_id: spaceId,
    p_user_id: memberId,
  });
  if (error) throw error;
}

export async function updateCircleMemberRole(
  spaceId: string,
  memberId: string,
  role: Exclude<MemberRole, "owner">,
) {
  const { error } = await createClient().rpc("update_space_member_role", {
    p_space_id: z.string().uuid().parse(spaceId),
    p_user_id: z.string().uuid().parse(memberId),
    p_role: z.enum(["admin", "member"]).parse(role),
  });
  if (error) throw error;
}

export async function createSpaceList(spaceId: string, name: string) {
  z.string().uuid().parse(spaceId);
  const validName = z.string().trim().min(1).max(120).parse(name);
  const { data, error } = await createClient().rpc("create_space_list", {
    p_space_id: spaceId,
    p_name: validName,
  });
  if (error) throw error;
  return data as { id: string; name: string; space_id: string };
}
