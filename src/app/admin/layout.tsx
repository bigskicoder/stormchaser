import type { ReactNode } from "react";
import Link from "next/link";
import { UserButton } from "@clerk/nextjs";
import { BrandRow } from "@/components/brand-row";
import { requireAdmin } from "@/lib/admin/authz";
import { clerkConfigured } from "@/lib/admin/pin";
import { AdminPinForm, AdminPinSignOut } from "@/components/admin-pin-form";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  try {
    await requireAdmin();
  } catch {
    if (!clerkConfigured()) {
      return (
        <div className="container" style={{ paddingTop: 56 }}>
          <BrandRow />
          <h1 style={{ marginTop: 24 }}>Admin</h1>
          <AdminPinForm />
        </div>
      );
    }
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
        {clerkConfigured() ? <UserButton /> : <AdminPinSignOut />}
      </header>
      <nav className="admin-nav">
        <Link href="/admin">Dashboard</Link>
        <Link href="/admin/backtest">Forecast accuracy</Link>
        <Link href="/admin/calibration">SLR calibration</Link>
        <Link href="/admin/model-versions">Model versions</Link>
      </nav>
      <div style={{ paddingTop: 24 }}>{children}</div>
    </div>
  );
}
