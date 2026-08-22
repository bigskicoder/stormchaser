import type { Metadata } from "next";
import type { ReactNode } from "react";
import { ConditionalClerkProvider } from "@/components/conditional-clerk-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "powder-alert",
  description: "Storm-signal detection and confidence-scored powder alerts for storm-chasing skiers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ConditionalClerkProvider>{children}</ConditionalClerkProvider>
      </body>
    </html>
  );
}
