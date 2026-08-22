import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { requireAdmin } from "@/lib/admin/authz";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  // Clerk middleware (src/middleware.ts) already enforces "signed in" for
  // everything under /admin. This enforces "signed in AS THE OWNER" —
  // section 8 says Clerk-gated to owner account, singular.
  try {
    await requireAdmin();
  } catch {
    return (
      <div className="container">
        <h1>403</h1>
        <p>This account isn&rsquo;t authorized for the admin panel.</p>
      </div>
    );
  }

  return (
    <div className="container">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 24 }}>
        <h1 style={{ fontSize: 18 }}>powder-alert admin</h1>
        <UserButton />
      </header>
      {children}
    </div>
  );
}
