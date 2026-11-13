import { auth } from "@clerk/nextjs/server";
import { cookies } from "next/headers";
import { ADMIN_PIN_COOKIE, clerkConfigured, getPinSecret, verifySessionToken } from "@/lib/admin/pin";

/** Recorded as the reviewer/activator on admin actions taken through PIN sign-in. */
export const PIN_ADMIN_USER_ID = "admin-pin";

/**
 * Restricts /admin to the specific owner account(s), beyond Clerk
 * middleware's "just signed in" check — section 8 says "Clerk-gated to
 * owner account" (singular), not any authenticated user. Until Clerk is
 * set up, a valid PIN session cookie stands in (lib/admin/pin.ts).
 */
export async function requireAdmin(): Promise<{ userId: string }> {
  if (!clerkConfigured()) {
    const secret = await getPinSecret();
    if (!secret) throw new Error("unauthenticated");
    const jar = await cookies();
    if (!verifySessionToken(secret, jar.get(ADMIN_PIN_COOKIE)?.value)) throw new Error("unauthenticated");
    return { userId: PIN_ADMIN_USER_ID };
  }

  const { userId } = await auth();
  if (!userId) throw new Error("unauthenticated");

  const allowed = (process.env.ADMIN_USER_IDS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (allowed.length > 0 && !allowed.includes(userId)) {
    throw new Error("forbidden");
  }

  return { userId };
}
