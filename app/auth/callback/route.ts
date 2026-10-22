import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

function loginUrl(request: NextRequest, reason: string) {
  const target = new URL("/login", request.url);
  target.searchParams.set("error", "auth");
  target.searchParams.set("reason", reason);
  const next = request.nextUrl.searchParams.get("next");
  if (next?.startsWith("/") && !next.startsWith("//"))
    target.searchParams.set("next", next);
  return target;
}

function redirect(request: NextRequest, pathname: string | URL) {
  const response = NextResponse.redirect(
    typeof pathname === "string" ? new URL(pathname, request.url) : pathname,
    303,
  );
  response.headers.set("Cache-Control", "no-store");
  return response;
}

function errorReason(
  message: string,
  hasVerifier: boolean,
  provider: string | null,
) {
  if (!hasVerifier) return "missing_verifier";
  const normalized = message.toLocaleLowerCase();
  if (
    provider === "google" &&
    (normalized.includes("provider is not enabled") ||
      normalized.includes("unsupported provider"))
  )
    return "google_not_enabled";
  if (
    normalized.includes("expired") ||
    normalized.includes("already") ||
    normalized.includes("invalid flow state")
  )
    return "expired_code";
  if (normalized.includes("not configured")) return "configuration";
  return provider === "google" ? "oauth_failed" : "exchange_failed";
}

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const provider = request.nextUrl.searchParams.get("provider");
  const oauthError = request.nextUrl.searchParams.get("error");
  const oauthErrorCode = request.nextUrl.searchParams.get("error_code");
  const oauthErrorDescription =
    request.nextUrl.searchParams.get("error_description") ?? "";
  const next = request.nextUrl.searchParams.get("next") ?? "/today";
  const safeNext =
    next.startsWith("/") && !next.startsWith("//") ? next : "/today";
  const hasVerifier = request.cookies
    .getAll()
    .some(({ name }) => name.endsWith("-code-verifier"));
  try {
    const supabase = await createClient();

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return redirect(request, safeNext);

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) return redirect(request, safeNext);

      const reason = errorReason(error.message, hasVerifier, provider);
      console.error("[auth/callback] Code exchange failed", {
        reason,
        code: error.code,
        status: error.status,
        hasVerifier,
        provider,
      });
      return redirect(request, loginUrl(request, reason));
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) return redirect(request, safeNext);

    const normalizedOAuthError =
      `${oauthErrorCode ?? ""} ${oauthErrorDescription}`.toLowerCase();
    const reason =
      provider === "google" &&
      (oauthError === "access_denied" ||
        normalizedOAuthError.includes("access denied"))
        ? "google_cancelled"
        : provider === "google" &&
            (normalizedOAuthError.includes("provider is not enabled") ||
              normalizedOAuthError.includes("unsupported provider"))
          ? "google_not_enabled"
          : provider === "google" || oauthError
            ? "oauth_failed"
            : "missing_code";
    console.error("[auth/callback] Code exchange failed", {
      reason,
      hasVerifier,
      provider,
      oauthError,
      oauthErrorCode,
    });
    return redirect(request, loginUrl(request, reason));
  } catch (error) {
    console.error("[auth/callback] Unexpected callback failure", {
      name: error instanceof Error ? error.name : "UnknownError",
      hasVerifier,
    });
    return redirect(request, loginUrl(request, "configuration"));
  }
}
