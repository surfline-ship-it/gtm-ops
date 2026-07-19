import { NextRequest, NextResponse } from "next/server";

// Simple HTTP Basic Auth gate for a single-user internal tool.
// Credentials come from APP_USER / APP_PASS env vars set in Vercel.
export function middleware(req: NextRequest) {
  const user = process.env.APP_USER;
  const pass = process.env.APP_PASS;
  if (!user || !pass) return NextResponse.next(); // no creds set = open (local dev)

  const header = req.headers.get("authorization");
  if (header?.startsWith("Basic ")) {
    const [u, p] = atob(header.slice(6)).split(":");
    if (u === user && p === pass) return NextResponse.next();
  }
  return new NextResponse("Auth required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="gtm-ops"' },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
