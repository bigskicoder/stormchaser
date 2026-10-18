import Link from "next/link";
import { notFound } from "next/navigation";
import { PitchProfileChart } from "@/components/pitch-profile-chart";
import { SiteTopbar } from "@/components/site-topbar";
import { TrailMap } from "@/components/trail-map";
import { compassWord, difficultyResorts, difficultyTrail, similarTrails } from "@/lib/trail-difficulty/data";
import { BAND_COLORS, MAX_POINTS, scoreBand, type Grooming } from "@/lib/trail-difficulty/score";
import "../../../public.css";

export function generateStaticParams() {
  return difficultyResorts().flatMap((r) => r.trails.map((t) => ({ resort: r.slug, trail: t.slug })));
}

export async function generateMetadata({ params }: { params: Promise<{ resort: string; trail: string }> }) {
  const { resort, trail } = await params;
  const found = difficultyTrail(resort, trail);
  return { title: found ? `${found.trail.name}, ${found.resort.name} · True difficulty` : "Powder Seeker" };
}

const GROOMING_LABEL: Record<Grooming, string> = {
  groomed: "Groomed",
  sometimes: "Sometimes groomed",
  ungroomed: "Never groomed",
  unknown: "Grooming not mapped",
};

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function feet(m: number): string {
  return `${Math.round(m * 3.28084).toLocaleString("en-US")} ft`;
}

/** One trail's page: score, pitch from top to bottom, and where the points come from. */
export default async function DifficultyTrailPage({ params }: { params: Promise<{ resort: string; trail: string }> }) {
  const { resort: resortSlug, trail: trailSlug } = await params;
  const found = difficultyTrail(resortSlug, trailSlug);
  if (!found) notFound();
  const { resort, trail } = found;
  const color = BAND_COLORS[scoreBand(trail.score)];
  const rank = resort.trails.findIndex((t) => t.slug === trail.slug) + 1;
  const similar = similarTrails(resort, trail);

  const rows = [
    { label: `Pitch · effective ${trail.effectivePitchDeg.toFixed(1)}°`, pts: trail.points.pitch, max: MAX_POINTS.pitch },
    { label: `Grooming · ${GROOMING_LABEL[trail.grooming].toLowerCase()}`, pts: trail.points.grooming, max: MAX_POINTS.grooming },
    { label: `Width · ${trail.widthM != null ? `about ${trail.widthM} m` : "not mapped"}`, pts: trail.points.width, max: MAX_POINTS.width },
    {
      label: `Features · ${trail.featureLabels.length ? trail.featureLabels.join(", ").toLowerCase() : "none found"}`,
      pts: trail.points.features,
      max: MAX_POINTS.features,
    },
  ];

  return (
    <div className="ps">
      <SiteTopbar current="difficulty" />
      <main className="ps-wrap ps-main">
        <Link href={`/difficulty/${resort.slug}`} className="ps-td-back">
          Back to the {resort.name} map
        </Link>

        <div className="ps-td-trail-head">
          <div className="ps-td-ring" style={{ borderColor: color }}>
            <b>{trail.score}</b>
            <span>of 100</span>
          </div>
          <div>
            <h1>{trail.name}</h1>
            <p className="ps-sub">
              {trail.resortRating
                ? `${resort.name} rates it ${/^[aeiou]/i.test(trail.resortRating) ? "an" : "a"} ${trail.resortRating.toLowerCase()}`
                : resort.name}
            </p>
            <p className="ps-td-rank">
              Number {rank} of {resort.trails.length} at {resort.name}, hardest first
            </p>
          </div>
        </div>

        <div className="ps-td-trail-grid">
          <div className="ps-td-col">
            <section className="ps-panel" aria-labelledby="td-pitch">
              <h2 id="td-pitch">Pitch from top to bottom</h2>
              <PitchProfileChart profileDeg={trail.profileDeg} windowsDeg={trail.windowsDeg} name={trail.name} />
              <p className="ps-note">
                The colored bars are the steepest stretch of each length. They blend 10% / 20% / 30% / 40% into one effective
                pitch, so a short steep roll counts less than a long steep pitch.
              </p>
            </section>

            <section className="ps-panel" aria-labelledby="td-facts">
              <h2 id="td-facts">The trail</h2>
              <dl className="ps-td-facts">
                <div>
                  <dt>Length</dt>
                  <dd>{feet(trail.lengthM)}</dd>
                </div>
                <div>
                  <dt>Vertical</dt>
                  <dd>{feet(trail.verticalM)}</dd>
                </div>
                <div>
                  <dt>Steepest 30 m</dt>
                  <dd>{trail.windowsDeg[1]!.toFixed(0)}°</dd>
                </div>
                <div>
                  <dt>Faces</dt>
                  <dd>{trail.aspectDeg != null ? capitalize(compassWord(trail.aspectDeg)) : "—"}</dd>
                </div>
              </dl>
            </section>
          </div>

          <div className="ps-td-col">
            <TrailMap
              resortSlug={resort.slug}
              trails={resort.trails.map((t) => ({ slug: t.slug, name: t.name, score: t.score, lines: t.lines }))}
              lifts={resort.lifts.map((l) => l.line)}
              bounds={resort.bounds}
              highlight={trail.slug}
              fitTo={trail.lines}
              height={300}
            />

            <section className="ps-panel" aria-labelledby="td-points">
              <h2 id="td-points">Where the {trail.score} comes from</h2>
              <div className="ps-td-points">
                {rows.map((r) => (
                  <div key={r.label}>
                    <div className="row">
                      <span>{r.label}</span>
                      <b>
                        {Math.round(r.pts)} / {r.max}
                      </b>
                    </div>
                    <div className="track">
                      <i style={{ width: `${(r.pts / r.max) * 100}%`, background: color }} />
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {similar.length > 0 && (
              <section className="ps-panel" aria-labelledby="td-similar">
                <h2 id="td-similar">Skis about the same at {resort.name}</h2>
                <ul className="ps-td-similar">
                  {similar.map((t) => (
                    <li key={t.slug}>
                      <Link href={`/difficulty/${resort.slug}/${t.slug}`}>{t.name}</Link>
                      <span>
                        {t.score}
                        {t.resortRating ? ` · ${t.resortRating}` : ""}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="ps-note">Matches at other resorts appear once more mountains are measured.</p>
              </section>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
