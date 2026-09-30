"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronDown, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, getAllRisks, getEvidenceByIds } from "@/lib/api";
import type { EvidenceDetail, Materiality, RecentRisk } from "@/lib/types";
import { cn } from "@/lib/utils";
import { MATERIALITY_ORDER, materialityClasses } from "@/lib/session-status";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

type OverallSeverity = "Low" | "Moderate" | "High" | "Critical";

// Contradiction.materiality only ever has 3 real values (HIGH/MEDIUM/LOW —
// confirmed on the model) — there's no "CRITICAL" row-level value. This
// derives a 4th, coarser tier for the workspace-wide summary banner only,
// from the real HIGH ratio across all tracked risks. This threshold (>=50%
// of risks rated HIGH => "Critical") is my own choice, not a backend value —
// flagged here and in the report since the task didn't specify one.
function computeOverallSeverity(risks: RecentRisk[]): OverallSeverity {
  if (risks.length === 0) return "Low";
  const highCount = risks.filter((r) => r.materiality === "HIGH").length;
  const mediumCount = risks.filter((r) => r.materiality === "MEDIUM").length;
  const highRatio = highCount / risks.length;
  if (highRatio >= 0.5) return "Critical";
  if (highCount > 0) return "High";
  if (mediumCount > 0) return "Moderate";
  return "Low";
}

function overallSeverityClasses(severity: OverallSeverity): string {
  if (severity === "Critical") return "text-red-400";
  if (severity === "High") return "text-red-400";
  if (severity === "Moderate") return "text-amber-400";
  return "text-emerald-400";
}

// Every class name below must appear as a complete, literal string somewhere
// in this file — Tailwind's build-time scanner greps raw source text for
// whole utility-class substrings, it doesn't evaluate JS. The previous
// version built these with `` `bg-amber-500${intensity}` ``: the literal
// text "bg-amber-500/40" never actually appears in the file (only assembled
// at runtime), so Tailwind never generated that rule and the cell rendered
// with NO background at all — white text on a transparent cell over the
// light-mode card, i.e. invisible. (The count>=3 case happened to still work
// by accident: `` `bg-red-500${""}` `` leaves "bg-red-500" itself intact and
// literal.) Every one of these 9 strings is spelled out in full so the
// scanner can find it.
const HEAT_CELL_CLASSES: Record<Materiality, [low: string, mid: string, high: string]> = {
  HIGH: ["bg-red-500/40 text-white", "bg-red-500/70 text-white", "bg-red-500 text-white"],
  MEDIUM: ["bg-amber-500/40 text-white", "bg-amber-500/70 text-white", "bg-amber-500 text-white"],
  LOW: ["bg-emerald-500/40 text-white", "bg-emerald-500/70 text-white", "bg-emerald-500 text-white"],
};

function heatCellClasses(materiality: Materiality, count: number): string {
  if (count === 0) return "bg-border/30 text-text-muted";
  const tier = count >= 3 ? 2 : count === 2 ? 1 : 0;
  return HEAT_CELL_CLASSES[materiality][tier];
}

function ExplainRiskButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled
      title="Coming soon — narrative interpretation per risk isn't wired up yet."
      className="disabled:cursor-not-allowed"
    >
      Explain Risk
    </Button>
  );
}

function RiskCard({ risk, onViewEvidence }: { risk: RecentRisk; onViewEvidence: (risk: RecentRisk) => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="rounded-lg border border-border bg-surface">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-start justify-between gap-3 p-4 text-left"
      >
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" />
          <div className="min-w-0">
            <p className={cn("text-sm text-text-primary", !expanded && "line-clamp-2")}>
              {risk.description}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
              <span className={cn("rounded-full px-2 py-0.5 font-medium", materialityClasses(risk.materiality))}>
                {risk.materiality}
              </span>
              <span>{risk.status}</span>
              <span>&middot;</span>
              <span>{risk.company_name ?? "No company"}</span>
            </div>
          </div>
        </div>
        <ChevronDown
          className={cn("mt-0.5 h-4 w-4 shrink-0 text-text-muted transition-transform", expanded && "rotate-180")}
        />
      </button>

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          <p className="font-mono-label mb-1">WHY IT MATTERS</p>
          <p className="text-sm text-text-primary">{risk.description}</p>
          {/* "Affected metric" is dropped here on purpose: it would need
              Contradiction.finding_id -> Finding.area, but finding_id is
              hardcoded to None on every insert in the current
              risk_contradiction agent (confirmed via grep) — there is no
              real signal to show, so nothing is shown rather than a fake
              metric name. */}
          <div className="mt-3 flex items-center gap-2">
            <ExplainRiskButton />
            <Button type="button" size="sm" onClick={() => onViewEvidence(risk)}>
              View Evidence
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function RiskPage() {
  const [risksState, setRisksState] = useState<Load<RecentRisk[]>>({ status: "loading" });
  const [evidenceDialogRisk, setEvidenceDialogRisk] = useState<RecentRisk | null>(null);
  const [evidenceState, setEvidenceState] = useState<Load<EvidenceDetail[]>>({ status: "loading" });

  useEffect(() => {
    getAllRisks()
      .then((res) => setRisksState({ status: "ok", data: res.risks }))
      .catch((err) => setRisksState({ status: "error", message: errorMessage(err) }));
  }, []);

  useEffect(() => {
    if (!evidenceDialogRisk) return;
    const ids = [evidenceDialogRisk.evidence_a_id, evidenceDialogRisk.evidence_b_id].filter(
      (id): id is string => id !== null
    );
    if (ids.length === 0) {
      setEvidenceState({ status: "ok", data: [] });
      return;
    }
    setEvidenceState({ status: "loading" });
    getEvidenceByIds(ids)
      .then((res) => setEvidenceState({ status: "ok", data: res.evidence }))
      .catch((err) => setEvidenceState({ status: "error", message: errorMessage(err) }));
  }, [evidenceDialogRisk]);

  const risks = risksState.status === "ok" ? risksState.data : [];

  const overallSeverity = useMemo(() => computeOverallSeverity(risks), [risks]);
  const highOrCriticalCount = risks.filter((r) => r.materiality === "HIGH").length;
  const companies = useMemo(
    () =>
      Array.from(new Set(risks.map((r) => r.company_name ?? "No company"))).sort(),
    [risks]
  );

  const heatmap = useMemo(() => {
    const grid = new Map<string, Map<Materiality, number>>();
    for (const company of companies) {
      grid.set(company, new Map(MATERIALITY_ORDER.map((m) => [m, 0])));
    }
    for (const risk of risks) {
      const company = risk.company_name ?? "No company";
      const row = grid.get(company);
      if (!row) continue;
      row.set(risk.materiality, (row.get(risk.materiality) ?? 0) + 1);
    }
    return grid;
  }, [risks, companies]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Risk Intelligence</h1>
          <p className="mt-2 text-sm text-text-muted">
            Detected risks with severity, direction of travel and the evidence each conclusion
            rests on.
          </p>
        </div>

        <Button variant="outline" render={<Link href="/app/monitoring" />} nativeButton={false}>
          Monitoring
        </Button>
      </div>

      {risksState.status === "loading" && (
        <p className="mt-6 text-sm text-text-muted">Loading risks…</p>
      )}
      {risksState.status === "error" && (
        <p className="mt-6 text-sm text-red-400">Couldn&apos;t load risks: {risksState.message}</p>
      )}

      {risksState.status === "ok" && (
        <>
          {/* Overall Risk Profile */}
          <div className="mt-6 rounded-lg border border-border bg-surface p-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className={cn("h-5 w-5", overallSeverityClasses(overallSeverity))} />
              <div>
                <p className="font-mono-label">OVERALL RISK PROFILE</p>
                <p className={cn("text-xl font-semibold", overallSeverityClasses(overallSeverity))}>
                  {overallSeverity}
                </p>
              </div>
            </div>
            <p className="mt-3 text-sm text-text-muted">
              {risks.length} tracked risk{risks.length === 1 ? "" : "s"} across {companies.length}{" "}
              compan{companies.length === 1 ? "y" : "ies"}, {highOrCriticalCount} rated High.
            </p>
            <div className="mt-3 flex items-center gap-4 text-xs text-text-muted">
              {MATERIALITY_ORDER.map((m) => (
                <span key={m} className="inline-flex items-center gap-1.5">
                  <span className={cn("h-2.5 w-2.5 rounded-sm", heatCellClasses(m, 3))} />
                  {m.charAt(0) + m.slice(1).toLowerCase()}
                </span>
              ))}
            </div>
          </div>

          {/* Heatmap */}
          <div className="mt-4 rounded-lg border border-border bg-surface p-4">
            <p className="font-mono-label mb-3">RISK HEATMAP</p>
            {/* No real "category" axis exists: Contradiction has no category
                field, and the only plausible link (finding_id -> Finding.area)
                is always null in practice — the risk_contradiction agent
                hardcodes finding_id=None on every insert. Using Company
                (always real, always populated) as the second axis instead of
                inventing Financial/Operational/etc. categories. */}
            {companies.length === 0 ? (
              <p className="text-sm text-text-muted">No tracked risks yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr>
                      <th className="px-2 py-1 text-left text-xs font-medium text-text-muted">
                        Company
                      </th>
                      {MATERIALITY_ORDER.map((m) => (
                        <th key={m} className="px-2 py-1 text-center text-xs font-medium text-text-muted">
                          {m.charAt(0) + m.slice(1).toLowerCase()}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {companies.map((company) => (
                      <tr key={company}>
                        <td className="px-2 py-1 text-text-primary">{company}</td>
                        {MATERIALITY_ORDER.map((m) => {
                          const count = heatmap.get(company)?.get(m) ?? 0;
                          return (
                            <td key={m} className="px-2 py-1">
                              <div
                                className={cn(
                                  "flex h-10 w-full items-center justify-center rounded-md text-sm font-medium",
                                  heatCellClasses(m, count)
                                )}
                              >
                                {count}
                              </div>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Tracked Risks */}
          <div className="mt-4">
            <p className="font-mono-label mb-3">TRACKED RISKS</p>
            {risks.length === 0 ? (
              <p className="text-sm text-text-muted">No risks tracked yet.</p>
            ) : (
              <div className="flex flex-col gap-2">
                {risks.map((risk) => (
                  <RiskCard key={risk.id} risk={risk} onViewEvidence={setEvidenceDialogRisk} />
                ))}
              </div>
            )}
          </div>
        </>
      )}

      {/* Evidence Inspector — plain and functional, not final polish (same
          spirit as the /app/chat placeholder results view before it was
          replaced by the real tabbed detail page). */}
      <Dialog
        open={evidenceDialogRisk !== null}
        onOpenChange={(open) => {
          if (!open) setEvidenceDialogRisk(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Linked Evidence</DialogTitle>
          </DialogHeader>

          {evidenceState.status === "loading" && (
            <p className="text-sm text-text-muted">Loading evidence…</p>
          )}
          {evidenceState.status === "error" && (
            <p className="text-sm text-red-400">
              Couldn&apos;t load evidence: {evidenceState.message}
            </p>
          )}
          {evidenceState.status === "ok" && evidenceState.data.length === 0 && (
            <p className="text-sm text-text-muted">
              No linked evidence — this risk was identified from conflicting financial data
              (FinancialObservation rows), not from a source quote.
            </p>
          )}
          {evidenceState.status === "ok" && evidenceState.data.length > 0 && (
            <div className="flex flex-col gap-3">
              {evidenceState.data.map((ev, i) => (
                <div key={ev.id} className="rounded-md border border-border bg-background p-3 text-sm">
                  <p className="font-mono-label mb-1">EVIDENCE {String.fromCharCode(65 + i)}</p>
                  <p className="text-text-primary">&quot;{ev.observation}&quot;</p>
                  <p className="mt-2 text-xs text-text-muted">
                    {ev.source_title}
                    {ev.source_publisher ? ` · ${ev.source_publisher}` : ""} · {ev.location}
                    {ev.confidence !== null && ` · confidence: ${ev.confidence}`}
                  </p>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
