import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

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
  const parsed = z
    .object({ endpoint: z.string().url().max(4096) })
    .safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid endpoint." }, { status: 400 });
  const { error } = await createAdminClient()
    .from("push_subscriptions")
    .update({ revoked_at: new Date().toISOString() })
    .eq("user_id", user.id)
    .eq("endpoint", parsed.data.endpoint);
  if (error)
    return NextResponse.json(
      { error: "Could not remove this device subscription." },
      { status: 500 },
    );
  return NextResponse.json({ ok: true });
}
