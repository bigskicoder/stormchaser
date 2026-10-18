import type { Metadata } from "next";
import { Archivo, Space_Grotesk, JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { ConditionalClerkProvider } from "@/components/conditional-clerk-provider";
import "./globals.css";

// Body text uses the OS's own UI font (see --font-sans in globals.css) —
// one less webfont to ship, and it sidesteps the "every AI-generated site
// imports Inter for everything" tell. Headings get a distinct display face
// (Space Grotesk) and numeric readouts (scores, snowfall, wind) get a
// monospace (JetBrains Mono) so they read like instrument-panel figures
// rather than default dashboard-template numerals — deliberate, not
// decorative: this is a forecast-data product, so the numbers should look
// measured, not merely formatted.
const heading = Space_Grotesk({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-heading", display: "swap" });
// The public pages (leaderboard design, src/app/public.css) use Archivo
// throughout: a sturdy grotesque with good tabular figures for the score
// and snowfall columns. The admin pages keep Space Grotesk + JetBrains Mono.
const archivo = Archivo({ subsets: ["latin"], weight: ["400", "500", "600", "700", "800"], variable: "--font-archivo", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], weight: ["500", "700"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Powder Seeker",
  description: "Storm-signal detection and confidence-scored powder alerts for storm-chasing skiers.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${heading.variable} ${mono.variable} ${archivo.variable}`}>
      <body>
        <ConditionalClerkProvider>{children}</ConditionalClerkProvider>
      </body>
    </html>
  );
}
