import { NextResponse, type NextRequest } from "next/server";

export async function GET(request: NextRequest) {
  const destination = new URL("/login", request.url);
  destination.searchParams.set("session", "cleared");
  const response = NextResponse.redirect(destination);
  const localHost =
    request.nextUrl.hostname === "localhost" ||
    request.nextUrl.hostname === "127.0.0.1";

  for (const { name } of request.cookies.getAll()) {
    if (
      !name.startsWith("nestlist-auth") &&
      !(localHost && name.startsWith("sb-"))
    )
      continue;
    response.cookies.set(name, "", {
      path: "/",
      maxAge: 0,
      sameSite: "lax",
    });
  }

  return response;
}
