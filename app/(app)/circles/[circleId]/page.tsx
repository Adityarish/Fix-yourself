import { CircleDetail } from "@/components/circle-detail";
import { createClient } from "@/lib/supabase/server";

export default async function CirclePage({
  params,
}: {
  params: Promise<{ circleId: string }>;
}) {
  const [
    { circleId },
    {
      data: { user },
    },
  ] = await Promise.all([params, (await createClient()).auth.getUser()]);
  return <CircleDetail userId={user!.id} circleId={circleId} />;
}
