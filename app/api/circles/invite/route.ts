import { NextResponse } from "next/server";
import { z } from "zod";
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
  const token = String((data as { raw_token: string }).raw_token);
  const base = process.env.NEXT_PUBLIC_APP_URL ?? new URL(request.url).origin;
  const inviteUrl = `${base}/invite/${encodeURIComponent(token)}`;
  const delivery = await supabase.functions.invoke("send-circle-invite", {
    body: { email: parsed.data.email, inviteUrl },
  });
  return NextResponse.json({ inviteUrl, delivered: !delivery.error });
}
