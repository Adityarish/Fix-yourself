import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { selectableAvatars } from "@/lib/profile/avatars";

const avatarSchema = z.object({ avatarUrl: z.string().url().max(300) });

export async function PUT(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return NextResponse.json(
      { error: "Authentication required." },
      { status: 401 },
    );

  const parsed = avatarSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return NextResponse.json({ error: "Invalid avatar." }, { status: 400 });
  if (
    !selectableAvatars(user.id).some(
      (avatar) => avatar.url === parsed.data.avatarUrl,
    )
  )
    return NextResponse.json({ error: "Invalid avatar." }, { status: 400 });

  const { data, error } = await createAdminClient()
    .from("profiles")
    .update({ avatar_url: parsed.data.avatarUrl })
    .eq("id", user.id)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("[profile-avatar] Could not save avatar", error);
    return NextResponse.json(
      { error: "Could not save your avatar." },
      { status: 500 },
    );
  }
  if (!data)
    return NextResponse.json(
      { error: "Your profile could not be found." },
      { status: 404 },
    );

  return NextResponse.json({ ok: true });
}
