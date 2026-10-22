import { z } from "zod";
import { createClient } from "@/lib/supabase/browser";

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
    error?: string;
  };
  if (!response.ok)
    throw new Error(payload.error ?? "Could not create invitation.");
  return payload;
}

export async function removeCircleMember(spaceId: string, memberId: string) {
  const { error } = await createClient().rpc("remove_space_member", {
    p_space_id: spaceId,
    p_user_id: memberId,
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
