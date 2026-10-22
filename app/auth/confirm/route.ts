import type { EmailOtpType } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function redirect(request: NextRequest, pathname: string | URL) {
  const response = NextResponse.redirect(
    typeof pathname === "string" ? new URL(pathname, request.url) : pathname,
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const type = request.nextUrl.searchParams.get("type") as EmailOtpType | null;
  const requestedNext = request.nextUrl.searchParams.get("next") ?? "/today";
  const next =
    requestedNext.startsWith("/") && !requestedNext.startsWith("//")
      ? requestedNext
      : "/today";

  const supabase = await createClient();
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return redirect(request, next);
  } else if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return redirect(request, next);
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (user) return redirect(request, next);

  const login = new URL("/login", request.url);
  login.searchParams.set("error", "auth");
  login.searchParams.set("reason", "expired_code");
  login.searchParams.set("next", next);
  return redirect(request, login);
}
