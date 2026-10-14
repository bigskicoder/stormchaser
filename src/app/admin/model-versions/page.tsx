import Link from "next/link";
import { StatusBadge } from "@/components/status-badge";
import { ModelVersionActivateButton } from "@/components/model-version-activate-button";
import { ModelVersionCreateForm } from "@/components/model-version-create-form";
import { ModelVersionShadowToggle } from "@/components/model-version-shadow-toggle";
import { createBaselineVersionIfNoneExists } from "@/lib/model-versions/create";
import { listModelVersions } from "@/lib/model-versions/resolve";
import { compareModelVersions } from "@/lib/model-versions/compare";
import { toScoringConfig } from "@/lib/scoring/config";

export const dynamic = "force-dynamic";

function toCompareIds(raw: string | string[] | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return Array.from(new Set(list.filter(Boolean)));
}

export default async function AdminModelVersionsPage({
  searchParams,
}: {
  searchParams: Promise<{ compare?: string | string[]; duplicateFrom?: string }>;
}) {
  const params = await searchParams;
  const compareIds = toCompareIds(params.compare);

  // Sequential, not Promise.all — listModelVersions() must run AFTER the
  // baseline is guaranteed to exist, or a brand-new deploy's very first
  // page load could race: list resolves with zero rows while the baseline
  // insert is still in flight.
  await createBaselineVersionIfNoneExists();
  const versions = await listModelVersions();
  const versionsById = new Map(versions.map((v) => [v.id, v]));

  const activeVersion = versions.find((v) => v.status === "active");
  const duplicateFromVersion = (params.duplicateFrom && versionsById.get(params.duplicateFrom)) ?? activeVersion;

  const comparisonSummaries = compareIds.length > 0 ? await compareModelVersions(compareIds) : [];

  return (
    <>
      <h2 style={{ fontSize: 18 }}>Model versions</h2>
      <p style={{ color: "var(--text-muted)" }}>
        ROADMAP Phase C &mdash; named, timestamped snapshots of the scoring engine&rsquo;s tunable configuration
        (reconciliation weights, SLR strategy, powder-score weights, confidence thresholds). Exactly one version is
        active at a time; live scoring and the backtest scripts (<code>--version=&lt;id&gt;</code>) read whichever
        one that is. Activating an older version is how you roll back &mdash; there&rsquo;s no separate
        &ldquo;undo.&rdquo;
      </p>
      <p style={{ color: "var(--text-muted)" }}>
        <strong>Parallel scoring (Phase B.2)</strong>: start shadowing a draft to score it on every live run
        alongside the active version, on the exact same forecast data, writing its own comparison data &mdash;
        never shown on the public site, never alert-triggering. Compare it against the active version below once
        samples accumulate, the same way as any other comparison.
      </p>

      {duplicateFromVersion && (
        <ModelVersionCreateForm
          defaultConfigJson={JSON.stringify(toScoringConfig(duplicateFromVersion), null, 2)}
          sourceVersionId={duplicateFromVersion.id}
          sourceVersionName={duplicateFromVersion.name}
        />
      )}

      <form method="get">
        <table>
          <thead>
            <tr>
              <th>Compare</th>
              <th>Name</th>
              <th>Status</th>
              <th>SLR strategy</th>
              <th>Parent</th>
              <th>Created</th>
              <th>Parallel scoring</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {versions.map((v) => (
              <tr key={v.id}>
                <td data-label="Compare">
                  <input type="checkbox" name="compare" value={v.id} defaultChecked={compareIds.includes(v.id)} />
                </td>
                <td data-label="Name">
                  {v.name}
                  {v.description && (
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{v.description}</div>
                  )}
                </td>
                <td data-label="Status">
                  <StatusBadge status={v.status} />
                </td>
                <td data-label="SLR strategy">{v.slr_strategy_name}</td>
                <td data-label="Parent">{v.parent_version_id ? versionsById.get(v.parent_version_id)?.name ?? "—" : "—"}</td>
                <td data-label="Created">
                  {new Date(v.created_at).toLocaleDateString()}
                  <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{v.created_by}</div>
                </td>
                <td data-label="Parallel scoring">
                  <ModelVersionShadowToggle id={v.id} isShadow={v.is_shadow} isActive={v.status === "active"} />
                </td>
                <td data-label="Action">
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    {v.status === "active" ? (
                      <span className="badge high" style={{ whiteSpace: "nowrap" }}>
                        running now
                      </span>
                    ) : (
                      <ModelVersionActivateButton id={v.id} label={v.status === "archived" ? "Roll back" : "Activate"} />
                    )}
                    <Link href={`/admin/model-versions?duplicateFrom=${v.id}`} style={{ fontSize: 12 }}>
                      Duplicate
                    </Link>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <button
          type="submit"
          style={{ marginTop: 12, padding: "6px 14px", borderRadius: 6, border: "1px solid var(--border)", background: "transparent", color: "var(--text)", cursor: "pointer" }}
        >
          Compare selected
        </button>
      </form>

      {compareIds.length > 0 && (
        <>
          <h3 style={{ fontSize: 16, marginTop: 32 }}>Comparison</h3>
          <p style={{ color: "var(--text-muted)" }}>
            Read-only aggregation over accuracy_log rows already tagged with each version&rsquo;s id (live scoring
            plus the backtest scripts) &mdash; not a live re-run. Zero samples means this version has never been
            active or backtested under; run <code>npm run backtest:slr-reanalysis -- --version=&lt;id&gt;</code> or{" "}
            <code>npm run backtest:reconciliation -- --version=&lt;id&gt;</code> to generate comparison data for a
            draft before activating it.
          </p>
          <table>
            <thead>
              <tr>
                <th>Version</th>
                <th>Samples</th>
                <th>MAE</th>
                <th>Hit rate</th>
              </tr>
            </thead>
            <tbody>
              {comparisonSummaries.map((s) => (
                <tr key={s.modelVersionId}>
                  <td data-label="Version">{versionsById.get(s.modelVersionId)?.name ?? s.modelVersionId}</td>
                  <td data-label="Samples">{s.sampleCount}</td>
                  <td data-label="MAE">{s.sampleCount > 0 ? `${s.meanAbsoluteErrorIn.toFixed(2)}"` : "—"}</td>
                  <td data-label="Hit rate">{s.sampleCount > 0 ? `${s.hitRatePct.toFixed(0)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </>
  );
}
