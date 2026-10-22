import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { WorkspaceShell } from "@/components/workspace-shell";

export default async function AppLayout({ children }: { children: ReactNode }) {
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  )
    redirect("/login");
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const displayName =
    user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "there";
  return (
    <WorkspaceShell userId={user.id} displayName={displayName}>
      {children}
    </WorkspaceShell>
  );
}
