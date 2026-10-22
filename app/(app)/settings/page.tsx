import { TaskBoardLoader } from "@/components/task-board-loader";
import { requireUser } from "@/lib/supabase/require-user";

export default async function SettingsPage() {
  const user = await requireUser("/settings");
  return (
    <TaskBoardLoader
      userId={user.id}
      displayName={
        user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "there"
      }
      view="settings"
    />
  );
}
