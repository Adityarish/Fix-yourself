import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

Deno.serve(async (request) => {
  const secret = Deno.env.get("CRON_SHARED_SECRET");
  if (!secret || request.headers.get("x-cron-secret") !== secret)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const publicKey = Deno.env.get("NEXT_PUBLIC_VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  const subject = Deno.env.get("VAPID_SUBJECT");
  if (!url || !serviceKey || !publicKey || !privateKey || !subject)
    return Response.json(
      { error: "missing server configuration" },
      { status: 500 },
    );
  webpush.setVapidDetails(subject, publicKey, privateKey);
  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });
  const { error: queueError } = await admin.rpc("queue_routine_notifications", {
    p_horizon_days: 1,
  });
  if (queueError)
    return Response.json({ error: queueError.message }, { status: 500 });
  const { data: deliveries, error } = await admin.rpc(
    "claim_due_notifications",
    { p_limit: 100 },
  );
  if (error) return Response.json({ error: error.message }, { status: 500 });
  let sent = 0;
  let failed = 0;
  for (const delivery of deliveries ?? []) {
    const { data: task } = delivery.task_id
      ? await admin
          .from("tasks")
          .select("id,title")
          .eq("id", delivery.task_id)
          .maybeSingle()
      : { data: null };
    const { data: routineItem } = delivery.routine_item_id
      ? await admin
          .from("routine_items")
          .select("id,title")
          .eq("id", delivery.routine_item_id)
          .maybeSingle()
      : { data: null };
    const { data: subscriptions } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", delivery.user_id)
      .is("revoked_at", null);
    let delivered = false;
    let lastError = "no active subscription";
    for (const subscription of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: "NestList reminder",
            body:
              task?.title ??
              routineItem?.title ??
              "A task is ready when you are.",
            taskId: task?.id,
          }),
          { TTL: 3600 },
        );
        delivered = true;
      } catch (sendError) {
        const status = Number(
          (sendError as { statusCode?: number }).statusCode ?? 0,
        );
        lastError =
          sendError instanceof Error
            ? sendError.message.slice(0, 500)
            : "push failed";
        if (status === 404 || status === 410)
          await admin
            .from("push_subscriptions")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", subscription.id);
      }
    }
    await admin
      .from("notification_deliveries")
      .update(
        delivered
          ? {
              status: "sent",
              sent_at: new Date().toISOString(),
              last_error: null,
            }
          : { status: "failed", last_error: lastError },
      )
      .eq("id", delivery.id);
    if (delivered) sent += 1;
    else failed += 1;
  }
  const { data: digests, error: digestError } = await admin.rpc(
    "claim_due_daily_task_digests",
    { p_limit: 100 },
  );
  if (digestError)
    return Response.json(
      {
        claimed: deliveries?.length ?? 0,
        sent,
        failed,
        error: digestError.message,
      },
      { status: 500 },
    );

  let digestsSent = 0;
  let digestsFailed = 0;
  for (const digest of digests ?? []) {
    const titles = (digest.task_titles as string[] | null) ?? [];
    const taskCount = Number(digest.task_count ?? titles.length);
    if (!taskCount) {
      await admin
        .from("daily_task_digest_deliveries")
        .update({ status: "cancelled", last_error: null })
        .eq("user_id", digest.user_id)
        .eq("local_date", digest.local_date);
      continue;
    }
    const visibleTitles: string[] = [];
    for (const title of titles) {
      const nextLength = visibleTitles.join("\n").length + title.length;
      if (visibleTitles.length && nextLength > 700) break;
      visibleTitles.push(`• ${title}`);
    }
    const remaining = Math.max(0, taskCount - visibleTitles.length);
    const summary = `${visibleTitles.join("\n")}${remaining ? `\n+${remaining} more` : ""}`;
    const { data: subscriptions } = await admin
      .from("push_subscriptions")
      .select("id,endpoint,p256dh,auth")
      .eq("user_id", digest.user_id)
      .is("revoked_at", null);
    let delivered = false;
    let lastError = "no active subscription";
    for (const subscription of subscriptions ?? []) {
      try {
        await webpush.sendNotification(
          {
            endpoint: subscription.endpoint,
            keys: { p256dh: subscription.p256dh, auth: subscription.auth },
          },
          JSON.stringify({
            title: `Today’s plan · ${taskCount} ${taskCount === 1 ? "task" : "tasks"}`,
            body: summary,
            kind: "daily-summary",
            taskCount,
            localDate: digest.local_date,
            url: "/today",
          }),
          { TTL: 21_600 },
        );
        delivered = true;
      } catch (sendError) {
        const status = Number(
          (sendError as { statusCode?: number }).statusCode ?? 0,
        );
        lastError =
          sendError instanceof Error
            ? sendError.message.slice(0, 500)
            : "push failed";
        if (status === 404 || status === 410)
          await admin
            .from("push_subscriptions")
            .update({ revoked_at: new Date().toISOString() })
            .eq("id", subscription.id);
      }
    }
    await admin
      .from("daily_task_digest_deliveries")
      .update(
        delivered
          ? {
              status: "sent",
              sent_at: new Date().toISOString(),
              last_error: null,
            }
          : { status: "failed", last_error: lastError },
      )
      .eq("user_id", digest.user_id)
      .eq("local_date", digest.local_date);
    if (delivered) digestsSent += 1;
    else digestsFailed += 1;
  }
  return Response.json({
    claimed: deliveries?.length ?? 0,
    sent,
    failed,
    digestsClaimed: digests?.length ?? 0,
    digestsSent,
    digestsFailed,
  });
});
