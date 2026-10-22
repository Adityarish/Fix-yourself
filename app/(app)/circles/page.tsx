import { TaskBoardLoader } from "@/components/task-board-loader";
import { requireUser } from "@/lib/supabase/require-user";

export default async function CirclesPage() {
  const user = await requireUser("/circles");
  return (
    <TaskBoardLoader
      userId={user.id}
      displayName={
        user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "there"
      }
      view="circles"
    />
  );
}
