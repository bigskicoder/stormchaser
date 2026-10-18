import Link from "next/link";

/** Public-site top bar (UI option A). The admin pages keep their own header. */
export function SiteTopbar({ current }: { current?: "leaderboard" }) {
  return (
    <header className="ps-topbar">
      <div className="ps-wrap">
        <Link href="/" className="ps-logo">
          <svg aria-hidden="true" width="28" height="28" viewBox="0 0 30 30">
            <path d="M4 22 L12 8 L16 14 L20 6 L26 22 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
            <path d="M2 17 L28 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
          </svg>
          Powder Seeker
        </Link>
        <nav className="ps-nav" aria-label="Main">
          <Link href="/" aria-current={current === "leaderboard" ? "page" : undefined}>
            Leaderboard
          </Link>
        </nav>
        <Link href="/#alerts" className="ps-cta">
          Get powder alerts
        </Link>
      </div>
    </header>
  );
}
