import { createClient } from "@/lib/supabase/server";
import { ActivityPanel } from "@/components/activity-panel";

export default async function ActivityPage() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return <ActivityPanel userId={user!.id} />;
}
