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

function safeNext(requestedNext: string | null) {
  const value = requestedNext ?? "/today";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/today";
}

async function completeConfirmation(
  request: NextRequest,
  values: {
    code: string | null;
    tokenHash: string | null;
    type: EmailOtpType | null;
    requestedNext: string | null;
  },
) {
  const { code, tokenHash, type } = values;
  const next = safeNext(values.requestedNext);

  const supabase = await createClient();
  // Prefer the token hash because it is independent of the browser-local PKCE
  // verifier. This is what makes an email opened from an installed PWA, a mail
  // app, or a different browser complete reliably.
  if (tokenHash && type) {
    const { error } = await supabase.auth.verifyOtp({
      type,
      token_hash: tokenHash,
    });
    if (!error) return redirect(request, next);
  }

  // Keep the PKCE callback for older emails and the stock Supabase template.
  // If a URL contains both values and the PKCE verifier is unavailable, the
  // token-hash path above still gets the first chance to establish a session.
  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
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

export async function GET(request: NextRequest) {
  return completeConfirmation(request, {
    code: request.nextUrl.searchParams.get("code"),
    tokenHash: request.nextUrl.searchParams.get("token_hash"),
    type: request.nextUrl.searchParams.get("type") as EmailOtpType | null,
    requestedNext: request.nextUrl.searchParams.get("next"),
  });
}

export async function POST(request: NextRequest) {
  const form = await request.formData();
  const read = (name: string) => {
    const value = form.get(name);
    return typeof value === "string" ? value : null;
  };
  return completeConfirmation(request, {
    code: null,
    tokenHash: read("token_hash"),
    type: read("type") as EmailOtpType | null,
    requestedNext: read("next"),
  });
}
