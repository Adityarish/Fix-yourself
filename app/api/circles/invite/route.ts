import { NextResponse } from "next/server";
import { z } from "zod";
import { hasSmtpConfiguration, sendSmtpEmail } from "@/lib/email/smtp";
import { createClient } from "@/lib/supabase/server";

const schema = z.object({
  spaceId: z.string().uuid(),
  email: z.string().email(),
});

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 },
    );
  const { data, error } = await supabase.rpc("create_space_invite", {
    p_space_id: parsed.data.spaceId,
    p_email: parsed.data.email,
  });
  if (error)
    return NextResponse.json(
      { error: error.message },
      { status: error.code === "42501" ? 403 : 400 },
    );
  const invitation = data as {
    invite_id: string;
    raw_token: string;
    circle_name?: string;
    inviter_name?: string;
  };
  const token = String(invitation.raw_token);
  const base = (
    process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin
  ).replace(/\/+$/, "");
  const inviteUrl = `${base}/invite/${encodeURIComponent(token)}`;
  const circleName = invitation.circle_name?.trim() || "a NestList Circle";
  const inviterName =
    invitation.inviter_name?.trim() ||
    user.user_metadata?.full_name ||
    user.email?.split("@")[0] ||
    "A Circle admin";
  const subject = `${inviterName} invited you to ${circleName}`;
  const text = [
    `${inviterName} invited you to join “${circleName}” on NestList.`,
    "",
    `Review the invitation: ${inviteUrl}`,
    "",
    "This invitation expires in 7 days. You can also sign in and review it from the Circles page.",
  ].join("\n");
  async function recordDelivery(status: "sent" | "failed", reason?: string) {
    try {
      const { error } = await supabase.rpc("record_space_invite_delivery", {
        p_invite_id: invitation.invite_id,
        p_status: status,
        p_error: reason ?? null,
      });
      if (error)
        console.error("[circle-invite] Could not record email delivery", {
          code: error.code,
          status,
        });
    } catch {
      console.error("[circle-invite] Could not record email delivery", {
        status,
      });
    }
  }

  if (hasSmtpConfiguration()) {
    try {
      await sendSmtpEmail({
        to: parsed.data.email,
        subject,
        text,
      });
      await recordDelivery("sent");
      return NextResponse.json({ inviteUrl, delivered: true });
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Email delivery failed.";
      await recordDelivery("failed", reason);
      return NextResponse.json({
        inviteUrl,
        delivered: false,
        deliveryError:
          "The SMTP server rejected the message. Check the Gmail address and App Password, then restart the app.",
      });
    }
  }

  const delivery = await supabase.functions.invoke("send-circle-invite", {
    body: {
      email: parsed.data.email,
      inviteUrl,
      circleName,
      inviterName,
    },
  });
  await recordDelivery(
    delivery.error ? "failed" : "sent",
    delivery.error?.message,
  );
  return NextResponse.json({
    inviteUrl,
    delivered: !delivery.error,
    deliveryError: delivery.error
      ? "SMTP_USER and SMTP_PASSWORD are not available to the app, and the Supabase email function could not deliver the invitation."
      : undefined,
  });
}
