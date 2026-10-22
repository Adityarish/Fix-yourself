import { TaskBoardLoader } from "@/components/task-board-loader";
import { createClient } from "@/lib/supabase/server";

export default async function TodayPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return (
    <TaskBoardLoader
      userId={user!.id}
      displayName={
        user!.user_metadata?.full_name ?? user!.email?.split("@")[0] ?? "there"
      }
      view="today"
    />
  );
}
