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
  createdAt: string;
  expiresAt: string;
}

export type CircleInviteStatus =
  | "pending"
  | "accepted"
  | "declined"
  | "revoked"
  | "expired";

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
  const { data, error } = await createClient().rpc("list_my_circle_invites");
  if (error) throw error;
  return (data ?? []) as CircleInviteRequest[];
}

export async function respondToCircleInvite(
  inviteId: string,
  accept: boolean,
) {
  const { data, error } = await createClient().rpc(
    "respond_to_space_invite",
    {
      p_invite_id: z.string().uuid().parse(inviteId),
      p_accept: accept,
    },
  );
  if (error) throw error;
  return data as { spaceId: string; status: "accepted" | "declined" };
}

export async function listCircleInvites(spaceId: string) {
  const { data, error } = await createClient().rpc("list_circle_invites", {
    p_space_id: z.string().uuid().parse(spaceId),
  });
  if (error) throw error;
  return (data ?? []) as SentCircleInvite[];
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
