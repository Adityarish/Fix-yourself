import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );
  const { error } = await createAdminClient().auth.admin.deleteUser(user.id);
  if (error)
    return NextResponse.json(
      { error: "Account deletion could not be completed." },
      { status: 500 },
    );
  return NextResponse.json({ ok: true });
}
