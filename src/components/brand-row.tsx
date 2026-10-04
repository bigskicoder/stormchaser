/**
 * A plain snowflake-emoji-in-a-rounded-square was the original mark —
 * replaced with a drawn geometric peak (an angular mountain silhouette
 * with a storm-line accent through it) since an emoji-in-a-box is one of
 * the most recognizable "placeholder logo" tells. No icon library
 * dependency — six lines of inline SVG.
 */
export function BrandRow() {
  return (
    <div className="brand-row">
      <svg className="brand-mark" width="30" height="30" viewBox="0 0 30 30" aria-hidden>
        <path d="M4 22 L12 8 L16 14 L20 6 L26 22 Z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        <path d="M2 17 L28 17" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
      </svg>
      <span className="brand-name">powder-alert</span>
    </div>
  );
}
