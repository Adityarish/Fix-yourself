import { redirect } from "next/navigation";
import { InviteAccept } from "@/components/invite-accept";
import { createClient } from "@/lib/supabase/server";

export default async function InvitePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/invite/${token}`)}`);
  return <InviteAccept token={token} />;
}
