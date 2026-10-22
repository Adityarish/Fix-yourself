import { CircleDetail } from "@/components/circle-detail";
import { requireUser } from "@/lib/supabase/require-user";

export default async function CirclePage({
  params,
}: {
  params: Promise<{ circleId: string }>;
}) {
  const { circleId } = await params;
  const user = await requireUser(`/circles/${circleId}`);
  return <CircleDetail userId={user.id} circleId={circleId} />;
}
