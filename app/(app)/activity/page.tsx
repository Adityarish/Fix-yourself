import { ActivityPanel } from "@/components/activity-panel";
import { requireUser } from "@/lib/supabase/require-user";

export default async function ActivityPage() {
  const user = await requireUser("/activity");
  return <ActivityPanel userId={user.id} />;
}
