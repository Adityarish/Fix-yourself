import { TaskBoardLoader } from "@/components/task-board-loader";
import { createClient } from "@/lib/supabase/server";

export default async function SettingsPage() {
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  return (
    <TaskBoardLoader
      userId={user!.id}
      displayName={
        user!.user_metadata?.full_name ?? user!.email?.split("@")[0] ?? "there"
      }
      view="settings"
    />
  );
}
