import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (request) => {
  const authorization = request.headers.get("authorization");
  if (!authorization)
    return Response.json({ error: "unauthorized" }, { status: 401 });
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_ANON_KEY")!,
    { global: { headers: { Authorization: authorization } } },
  );
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  const { email, inviteUrl, circleName, inviterName } =
    (await request.json()) as {
      email?: string;
      inviteUrl?: string;
      circleName?: string;
      inviterName?: string;
    };
  if (
    !email ||
    !inviteUrl ||
    !new URL(inviteUrl).pathname.startsWith("/invite/")
  )
    return Response.json({ error: "invalid invitation" }, { status: 400 });
  const webhook = Deno.env.get("EMAIL_WEBHOOK_URL");
  if (!webhook)
    return Response.json(
      { error: "email delivery is not configured" },
      { status: 503 },
    );
  const response = await fetch(webhook, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${Deno.env.get("EMAIL_WEBHOOK_SECRET") ?? ""}`,
    },
    body: JSON.stringify({
      to: email,
      subject: `${inviterName || "A Circle admin"} invited you to ${circleName || "a NestList Circle"}`,
      text: [
        `${inviterName || "A Circle admin"} invited you to join “${circleName || "a NestList Circle"}” on NestList.`,
        "",
        `Review the invitation: ${inviteUrl}`,
        "",
        "This invitation expires in 7 days. You can also sign in and review it from the Circles page.",
      ].join("\n"),
    }),
  });
  return Response.json(
    { delivered: response.ok },
    { status: response.ok ? 200 : 502 },
  );
});
