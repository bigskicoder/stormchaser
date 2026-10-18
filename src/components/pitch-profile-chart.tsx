import { steepestStretch } from "@/lib/trail-difficulty/data";
import { PITCH_WINDOWS } from "@/lib/trail-difficulty/score";
import { PROFILE_STEP_M } from "@/lib/trail-difficulty/types";

const W = 640;
const H = 260;
const PAD = { l: 40, r: 16, t: 16, b: 34 };
const WINDOW_COLORS = ["#e0457b", "#e8742a", "#c99a00", "#3b7be8"];

/**
 * Pitch from the top of the trail to the bottom, with the steepest 10, 30,
 * 100 and 300 m stretches marked at their average pitch: the four numbers
 * that blend into the effective pitch.
 */
export function PitchProfileChart({ profileDeg, windowsDeg, name }: { profileDeg: number[]; windowsDeg: number[]; name: string }) {
  if (profileDeg.length < 2) return null;
  const lengthM = profileDeg.length * PROFILE_STEP_M;
  const top = Math.max(45, Math.ceil(Math.max(...profileDeg, ...windowsDeg) / 5) * 5);
  const x = (m: number) => PAD.l + (m / lengthM) * (W - PAD.l - PAD.r);
  const y = (deg: number) => PAD.t + (1 - deg / top) * (H - PAD.t - PAD.b);
  const pts = profileDeg.map((d, i) => `${x((i + 0.5) * PROFILE_STEP_M).toFixed(1)},${y(d).toFixed(1)}`).join(" ");
  const grid = [];
  for (let d = 0; d <= top; d += 10) grid.push(d);

  const marks = PITCH_WINDOWS.map((w, i) => {
    const n = Math.max(1, Math.round(w.lengthM / PROFILE_STEP_M));
    const start = steepestStretch(profileDeg, n);
    const end = Math.min(profileDeg.length, start + n);
    return { len: w.lengthM, deg: windowsDeg[i]!, x0: x(start * PROFILE_STEP_M), x1: x(end * PROFILE_STEP_M), color: WINDOW_COLORS[i]! };
  });

  const summary = `Pitch along ${name}, top to bottom over ${lengthM} m, peaking near ${Math.round(Math.max(...profileDeg))} degrees. Steepest 10, 30, 100 and 300 m average ${windowsDeg.map((d) => Math.round(d)).join(", ")} degrees.`;

  return (
    <figure className="ps-td-chart">
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={summary}>
        {grid.map((d) => (
          <g key={d}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(d)} y2={y(d)} stroke="var(--border)" />
            <text x={PAD.l - 6} y={y(d) + 4} textAnchor="end" fontSize="11" fill="var(--text-muted)">
              {d}°
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H - 10} fontSize="11" fill="var(--text-muted)">
          Top
        </text>
        <text x={W - PAD.r} y={H - 10} fontSize="11" fill="var(--text-muted)" textAnchor="end">
          Bottom, {lengthM} m
        </text>
        <polyline points={pts} fill="none" stroke="var(--ink)" strokeWidth="2" strokeLinejoin="round" />
        {marks.map((m) => (
          <g key={m.len}>
            <line x1={m.x0} x2={Math.max(m.x1, m.x0 + 4)} y1={y(m.deg)} y2={y(m.deg)} stroke={m.color} strokeWidth="5" strokeLinecap="round" />
          </g>
        ))}
      </svg>
      <figcaption className="ps-td-chart-key">
        {marks.map((m) => (
          <span key={m.len}>
            <i style={{ background: m.color }} aria-hidden="true" />
            Steepest {m.len} m: {m.deg.toFixed(1)}°
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
