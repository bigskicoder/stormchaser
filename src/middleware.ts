import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

/**
 * Clerk gate for /admin only (BUILD_PRIMER section 8: "internal-only route,
 * Clerk-gated to owner account"). The public site must never be behind
 * this — section 10.5 is explicit that forecast display has no paywall —
 * so the matcher below deliberately excludes everything else.
 *
 * If Clerk isn't configured yet (no publishable key), this middleware
 * no-ops rather than crashing local/dev builds — /admin will 404-ish via
 * ClerkProvider not being mounted (see conditional-clerk-provider.tsx)
 * rather than serving real admin functionality until Clerk is wired up.
 */
export default clerkMiddleware(async (auth, req) => {
  if (!process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY) {
    return NextResponse.next();
  }
  if (isAdminRoute(req)) {
    await auth.protect();
  }
});

export const config = {
  matcher: ["/admin/:path*"],
};
