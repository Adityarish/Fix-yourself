import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (request) => {
  if (
    request.headers.get("x-cron-secret") !== Deno.env.get("CRON_SHARED_SECRET")
  )
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json()) as {
    userId?: string;
    taskId?: string;
    title?: string;
  };
  if (!body.userId)
    return Response.json({ error: "userId required" }, { status: 400 });
  webpush.setVapidDetails(
    Deno.env.get("VAPID_SUBJECT")!,
    Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY")!,
    Deno.env.get("VAPID_PRIVATE_KEY")!,
  );
  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const { data } = await admin
    .from("push_subscriptions")
    .select("id,endpoint,p256dh,auth")
    .eq("user_id", body.userId)
    .is("revoked_at", null);
  const results = await Promise.allSettled(
    (data ?? []).map((subscription) =>
      webpush.sendNotification(
        {
          endpoint: subscription.endpoint,
          keys: { p256dh: subscription.p256dh, auth: subscription.auth },
        },
        JSON.stringify({
          title: "NestList",
          body: body.title ?? "A shared plan changed.",
          taskId: body.taskId,
        }),
      ),
    ),
  );
  return Response.json({
    attempted: results.length,
    sent: results.filter((result) => result.status === "fulfilled").length,
  });
});
