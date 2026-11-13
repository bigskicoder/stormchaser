import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

/**
 * Clerk gate for /admin only (BUILD_PRIMER section 8: "internal-only route,
 * Clerk-gated to owner account"). The public site must never be behind
 * this — section 10.5 is explicit that forecast display has no paywall —
 * so the matcher below deliberately excludes everything else.
 */
const clerk = clerkMiddleware(async (auth, req) => {
  if (isAdminRoute(req)) {
    await auth.protect();
  }
});

/**
 * Until both Clerk keys are set in Vercel, /admin answers with a plain
 * "not set up" page and never serves admin content. This used to call
 * clerkMiddleware and return early inside it, but clerkMiddleware checks
 * its keys before running the callback, so a missing key crashed every
 * admin request with Vercel's 500 MIDDLEWARE_INVOCATION_FAILED (Nick hit
 * it on 2026-11-08).
 */
export default function middleware(req: NextRequest, event: NextFetchEvent) {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY || !process.env.CLERK_SECRET_KEY) {
    // Temporary PIN sign-in (lib/admin/pin.ts): the admin layout shows a
    // PIN prompt and requireAdmin checks the PIN cookie on every page and
    // API call, so the request goes through to them.
    if (process.env.ADMIN_PIN_ENABLED !== "false") return NextResponse.next();
    return new NextResponse(
      "<!doctype html><meta name=viewport content='width=device-width'><title>Admin not set up</title>" +
        "<body style='font-family:system-ui;padding:24px;max-width:520px'><h1>Admin sign-in isn't set up yet</h1>" +
        "<p>The admin panel needs its Clerk keys (NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY and CLERK_SECRET_KEY) added in Vercel. " +
        "Until then it stays locked.</p></body>",
      { status: 503, headers: { "content-type": "text/html; charset=utf-8" } }
    );
  }
  return clerk(req, event);
}

export const config = {
  matcher: ["/admin/:path*"],
};
