import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

const bodySchema = z.object({
  deviceId: z.string().uuid(),
  endpoint: z
    .string()
    .url()
    .max(4096)
    .refine((value) => {
      const url = new URL(value);
      const host = url.hostname.toLowerCase();
      return (
        url.protocol === "https:" &&
        (host === "fcm.googleapis.com" ||
          host.endsWith(".push.services.mozilla.com") ||
          host === "web.push.apple.com" ||
          host.endsWith(".notify.windows.com"))
      );
    }, "Unsupported push provider endpoint."),
  keys: z.object({
    p256dh: z.string().min(1).max(512),
    auth: z.string().min(1).max(512),
  }),
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
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return NextResponse.json(
      { error: "Invalid push subscription." },
      { status: 400 },
    );
  const admin = createAdminClient();
  const { error } = await admin.from("push_subscriptions").upsert(
    {
      user_id: user.id,
      device_id: parsed.data.deviceId,
      endpoint: parsed.data.endpoint,
      p256dh: parsed.data.keys.p256dh,
      auth: parsed.data.keys.auth,
      user_agent: request.headers.get("user-agent"),
      last_used_at: new Date().toISOString(),
      revoked_at: null,
    },
    { onConflict: "endpoint" },
  );
  if (error)
    return NextResponse.json(
      { error: "Could not save this device subscription." },
      { status: 500 },
    );
  return NextResponse.json({ ok: true });
}
