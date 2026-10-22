import type { ReactNode } from "react";
import { WorkspaceShell } from "@/components/workspace-shell";
import { requireUser } from "@/lib/supabase/require-user";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const displayName =
    user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "there";
  return (
    <WorkspaceShell userId={user.id} displayName={displayName}>
      {children}
    </WorkspaceShell>
  );
}
