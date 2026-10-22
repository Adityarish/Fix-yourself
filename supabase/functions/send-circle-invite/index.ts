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
  const { email, inviteUrl } = (await request.json()) as {
    email?: string;
    inviteUrl?: string;
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
      subject: "Join a NestList Circle",
      text: `You have been invited to a NestList Circle. This link expires in 7 days: ${inviteUrl}`,
    }),
  });
  return Response.json(
    { delivered: response.ok },
    { status: response.ok ? 200 : 502 },
  );
});
