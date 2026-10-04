/**
 * Embeds a resort's own public webcam page, requested directly ("putting
 * the resort webcams embedded into each page, pull from resort pages").
 * `webcam_url` is an operator-curated field on `resorts` (migration 0006),
 * not scraped — same judgment call as the US-map-vs-Mapbox decision, for
 * the same reason: scraping ~40+ different resort sites' webcam pages
 * (different structures, JS-rendered players, no shared API, real ToS risk
 * per-site) isn't a one-time build, it's an ongoing maintenance burden
 * against sites we don't control, which is exactly the kind of automated-
 * scraping-at-scale tradeoff already declined once this session (see
 * ROADMAP.md's "On OpenSnow"). Most resorts already publish an embeddable
 * webcam page or player (their own site, or a Windy.com/RoundShot embed);
 * storing that URL and iframing it directly respects their existing
 * infrastructure instead of re-hosting or re-scraping it. Some sites set
 * X-Frame-Options/CSP that blocks iframing even so — the "Open directly"
 * link is the fallback for that case.
 */
export function WebcamEmbed({ webcamUrl, resortName }: { webcamUrl: string | null; resortName: string }) {
  if (!webcamUrl) {
    return (
      <div className="webcam-embed webcam-embed-empty">
        <p className="no-signal">No live webcam linked for {resortName} yet.</p>
      </div>
    );
  }

  return (
    <div className="webcam-embed">
      <iframe src={webcamUrl} title={`${resortName} live webcam`} loading="lazy" allow="autoplay" />
      <a href={webcamUrl} target="_blank" rel="noopener noreferrer" className="back-link webcam-embed-link">
        Open directly ↗
      </a>
    </div>
  );
}
