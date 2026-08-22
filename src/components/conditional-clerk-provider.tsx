/**
 * Wraps children in ClerkProvider only when Clerk keys are configured.
 * Keeps the public site (which must never be auth-gated, section 10.5)
 * from breaking in environments that haven't set up Clerk yet — Clerk is
 * only actually required for the /admin route group.
 */
import { ClerkProvider } from "@clerk/nextjs";
import type { ReactNode } from "react";

export function ConditionalClerkProvider({ children }: { children: ReactNode }) {
  const hasClerkKeys = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);
  if (!hasClerkKeys) return <>{children}</>;
  return <ClerkProvider>{children}</ClerkProvider>;
}
