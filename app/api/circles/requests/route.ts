import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const responseSchema = z.object({
  inviteId: z.string().uuid(),
  response: z.enum(["accept", "decline"]),
});

type InviteRow = {
  id: string;
  space_id: string;
  email: string;
  role: "admin" | "member";
  invited_by: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  created_at: string;
  declined_at?: string | null;
  email_delivery_status?: "pending" | "sent" | "failed";
  email_delivery_error?: string | null;
};

async function authenticatedUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

async function selectInvites(
  admin: ReturnType<typeof createAdminClient>,
  filter: { email?: string; spaceId?: string },
) {
  const extendedColumns =
    "id,space_id,email,role,invited_by,expires_at,accepted_at,revoked_at,created_at,declined_at,email_delivery_status,email_delivery_error";
  const legacyColumns =
    "id,space_id,email,role,invited_by,expires_at,accepted_at,revoked_at,created_at";

  const run = (columns: string) => {
    let query = admin
      .from("space_invites")
      .select(columns)
      .order("created_at", { ascending: false })
      .limit(100);
    if (filter.email) query = query.eq("email", filter.email);
    if (filter.spaceId) query = query.eq("space_id", filter.spaceId);
    return query;
  };

  const extended = await run(extendedColumns);
  if (!extended.error) return { data: extended.data as unknown as InviteRow[] };
  const legacy = await run(legacyColumns);
  if (legacy.error) throw legacy.error;
  return { data: legacy.data as unknown as InviteRow[] };
}

function isMissingResponseRpc(error: { code?: string; message?: string }) {
  return (
    error.code === "PGRST202" ||
    error.code === "42883" ||
    /respond_to_space_invite.*(not found|schema cache|does not exist)/i.test(
      error.message ?? "",
    )
  );
}

function publicError(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === "object" &&
          error !== null &&
          "message" in error &&
          typeof error.message === "string"
        ? error.message
        : "An unexpected server error occurred.";
  if (message.startsWith("Supabase server credentials are not configured."))
    return "Set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY on the server.";
  return message;
}

export async function GET(request: Request) {
  const user = await authenticatedUser();
  if (!user?.email)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );

  try {
    const admin = createAdminClient();
    const spaceId = new URL(request.url).searchParams.get("spaceId");

    if (spaceId) {
      const validSpaceId = z.string().uuid().safeParse(spaceId);
      if (!validSpaceId.success)
        return NextResponse.json({ error: "Invalid Circle." }, { status: 400 });
      const { data: membership, error: membershipError } = await admin
        .from("space_members")
        .select("role,status")
        .eq("space_id", validSpaceId.data)
        .eq("user_id", user.id)
        .maybeSingle();
      if (membershipError) throw membershipError;
      if (
        membership?.status !== "active" ||
        !["owner", "admin"].includes(membership.role)
      )
        return NextResponse.json(
          { error: "Only Circle owners and admins can view invitations." },
          { status: 403 },
        );

      const { data } = await selectInvites(admin, {
        spaceId: validSpaceId.data,
      });
      const now = Date.now();
      return NextResponse.json({
        invitations: data.map((invite) => ({
          id: invite.id,
          email: invite.email,
          role: invite.role,
          status: invite.accepted_at
            ? "accepted"
            : invite.declined_at
              ? "declined"
              : invite.revoked_at
                ? "revoked"
                : Date.parse(invite.expires_at) <= now
                  ? "expired"
                  : "pending",
          emailDeliveryStatus: invite.email_delivery_status ?? "pending",
          emailDeliveryError: invite.email_delivery_error ?? null,
          createdAt: invite.created_at,
          expiresAt: invite.expires_at,
        })),
      });
    }

    const { data } = await selectInvites(admin, {
      email: user.email.toLowerCase(),
    });
    const pending = data.filter(
      (invite) =>
        !invite.accepted_at &&
        !invite.revoked_at &&
        !invite.declined_at &&
        Date.parse(invite.expires_at) > Date.now(),
    );
    const spaceIds = [...new Set(pending.map((invite) => invite.space_id))];
    const inviterIds = [...new Set(pending.map((invite) => invite.invited_by))];
    const [spacesResult, profilesResult] = await Promise.all([
      spaceIds.length
        ? admin
            .from("spaces")
            .select("id,name")
            .in("id", spaceIds)
            .is("deleted_at", null)
        : Promise.resolve({
            data: [] as Array<{ id: string; name: string }>,
            error: null,
          }),
      inviterIds.length
        ? admin
            .from("profiles")
            .select("id,display_name,avatar_url")
            .in("id", inviterIds)
        : Promise.resolve({
            data: [] as Array<{
              id: string;
              display_name: string | null;
              avatar_url: string | null;
            }>,
            error: null,
          }),
    ]);
    if (spacesResult.error) throw spacesResult.error;
    if (profilesResult.error) throw profilesResult.error;
    const spaces = spacesResult.data;
    const profiles = profilesResult.data;
    const spaceById = new Map((spaces ?? []).map((space) => [space.id, space]));
    const profileById = new Map(
      (profiles ?? []).map((profile) => [profile.id, profile]),
    );

    return NextResponse.json({
      invitations: pending.flatMap((invite) => {
        const space = spaceById.get(invite.space_id);
        if (!space) return [];
        const inviter = profileById.get(invite.invited_by);
        return [
          {
            id: invite.id,
            spaceId: invite.space_id,
            circleName: space.name,
            role: invite.role,
            invitedBy: invite.invited_by,
            invitedByName: inviter?.display_name?.trim() || "A Circle admin",
            invitedByAvatarUrl: inviter?.avatar_url ?? null,
            createdAt: invite.created_at,
            expiresAt: invite.expires_at,
          },
        ];
      }),
    });
  } catch (error) {
    console.error("[circle-requests] Could not list invitations", {
      name: error instanceof Error ? error.name : "DatabaseError",
      message: publicError(error),
    });
    return NextResponse.json(
      { error: `Could not load Circle invitations: ${publicError(error)}` },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const user = await authenticatedUser();
  if (!user?.email)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const parsed = responseSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid invitation response." },
      { status: 400 },
    );

  try {
    const supabase = await createClient();
    const rpcResult = await supabase.rpc("respond_to_space_invite", {
      p_invite_id: parsed.data.inviteId,
      p_accept: parsed.data.response === "accept",
    });
    if (!rpcResult.error) return NextResponse.json(rpcResult.data);
    if (!isMissingResponseRpc(rpcResult.error)) throw rpcResult.error;

    const admin = createAdminClient();
    const { data: invite, error } = await admin
      .from("space_invites")
      .select(
        "id,space_id,email,role,expires_at,accepted_at,revoked_at,created_at,declined_at",
      )
      .eq("id", parsed.data.inviteId)
      .maybeSingle();
    let inviteRow = invite;
    if (error && /declined_at|column/i.test(error.message)) {
      const legacy = await admin
        .from("space_invites")
        .select(
          "id,space_id,email,role,expires_at,accepted_at,revoked_at,created_at",
        )
        .eq("id", parsed.data.inviteId)
        .maybeSingle();
      if (legacy.error) throw legacy.error;
      inviteRow = legacy.data;
    } else if (error) {
      throw error;
    }
    if (
      !inviteRow ||
      inviteRow.email.toLowerCase() !== user.email.toLowerCase() ||
      inviteRow.accepted_at ||
      inviteRow.revoked_at ||
      ("declined_at" in inviteRow && inviteRow.declined_at) ||
      Date.parse(inviteRow.expires_at) <= Date.now()
    )
      return NextResponse.json(
        { error: "This invitation is invalid or expired." },
        { status: 400 },
      );

    if (parsed.data.response === "decline") {
      let { error: declineError } = await admin
        .from("space_invites")
        .update({ declined_at: new Date().toISOString() })
        .eq("id", inviteRow.id)
        .is("accepted_at", null)
        .is("revoked_at", null);
      if (declineError && /declined_at|column/i.test(declineError.message)) {
        const legacy = await admin
          .from("space_invites")
          .update({ revoked_at: new Date().toISOString() })
          .eq("id", inviteRow.id)
          .is("accepted_at", null)
          .is("revoked_at", null);
        declineError = legacy.error;
      }
      if (declineError) throw declineError;
      return NextResponse.json({
        spaceId: inviteRow.space_id,
        status: "declined",
      });
    }

    const joinedAt = new Date().toISOString();
    const { error: memberError } = await admin.from("space_members").upsert(
      {
        space_id: inviteRow.space_id,
        user_id: user.id,
        role: inviteRow.role,
        status: "active",
        joined_at: joinedAt,
        removed_at: null,
      },
      { onConflict: "space_id,user_id" },
    );
    if (memberError) throw memberError;
    const { error: acceptError } = await admin
      .from("space_invites")
      .update({ accepted_at: joinedAt })
      .eq("id", inviteRow.id)
      .is("accepted_at", null)
      .is("revoked_at", null);
    if (acceptError) throw acceptError;
    const { error: activityError } = await admin.from("change_log").insert({
      space_id: inviteRow.space_id,
      entity_type: "spaceMember",
      entity_id: user.id,
      operation: "upsert",
      payload: {
        space_id: inviteRow.space_id,
        user_id: user.id,
        role: inviteRow.role,
        status: "active",
      },
      actor_id: user.id,
    });
    if (activityError) {
      console.error(
        "[circle-requests] Membership accepted without activity log",
        {
          code: activityError.code,
        },
      );
    }
    return NextResponse.json({
      spaceId: inviteRow.space_id,
      status: "accepted",
    });
  } catch (error) {
    console.error("[circle-requests] Could not respond to invitation", {
      name: error instanceof Error ? error.name : "DatabaseError",
      message: publicError(error),
    });
    return NextResponse.json(
      {
        error: `Could not update this Circle invitation: ${publicError(error)}`,
      },
      { status: 500 },
    );
  }
}
