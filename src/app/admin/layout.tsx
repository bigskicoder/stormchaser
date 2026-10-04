import type { ReactNode } from "react";
import { UserButton } from "@clerk/nextjs";
import { BrandRow } from "@/components/brand-row";
import { requireAdmin } from "@/lib/admin/authz";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    return (
      <div className="container" style={{ paddingTop: 56 }}>
        <h1>403</h1>
        <p>This account isn&rsquo;t authorized for the admin panel.</p>
      </div>
    );
  }

  return (
    <div className="container" style={{ paddingTop: 40 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 32 }}>
        <div>
          <BrandRow />
          <span style={{ color: "var(--text-faint)", fontSize: 12, textTransform: "uppercase", letterSpacing: "0.04em" }}>Admin</span>
        </div>
        <UserButton />
      </header>
      {children}
    </div>
  );
}
