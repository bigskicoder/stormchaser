import { auth } from "@clerk/nextjs/server";

/**
 * Restricts /admin to the specific owner account(s), beyond Clerk
 * middleware's "just signed in" check — section 8 says "Clerk-gated to
 * owner account" (singular), not any authenticated user.
 */
export async function requireAdmin(): Promise<{ userId: string }> {
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
