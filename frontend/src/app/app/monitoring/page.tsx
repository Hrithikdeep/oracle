"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Plus, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, getAllRisks, getRecheck, listAllResearchSessions } from "@/lib/api";
import type { Materiality, RecentRisk, RecheckResult } from "@/lib/types";
import { cn, formatCompanyName, formatRelativeTime, newResearchChatUrl } from "@/lib/utils";
import { MATERIALITY_ORDER } from "@/lib/session-status";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

interface MonitorRow {
  company: string;
  // The most recent session for this company — GET /research/{id}/recheck
  // is inherently per-session (it diffs against that session's own
  // DecisionRecord snapshot), not per-company, so "monitoring a company"
  // here means rechecking its latest session.
  sessionId: string;
  riskLabel: Materiality | "NONE";
}

type CheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "error"; message: string }
  | { status: "ok"; result: RecheckResult; checkedAt: string };

function riskPillClasses(risk: Materiality | "NONE"): string {
  if (risk === "HIGH") return "bg-red-500/10 text-red-400";
  if (risk === "MEDIUM") return "bg-amber-500/10 text-amber-400";
  if (risk === "LOW") return "bg-emerald-500/10 text-emerald-400";
  return "bg-border text-text-muted";
}

function changesCount(result: RecheckResult): number {
  return (
    result.new_findings.length +
    result.changed_findings.length +
    result.new_financial_observations.length +
    result.changed_financial_observations.length +
    (result.recommendation_changed ? 1 : 0)
  );
}

export default function MonitoringPage() {
  const router = useRouter();
  const [rowsState, setRowsState] = useState<Load<MonitorRow[]>>({ status: "loading" });
  const [checks, setChecks] = useState<Record<string, CheckState>>({});
  const [dialogSessionId, setDialogSessionId] = useState<string | null>(null);

  const [addMonitorOpen, setAddMonitorOpen] = useState(false);
  const [entityInput, setEntityInput] = useState("");
  const [highlightedCompany, setHighlightedCompany] = useState<string | null>(null);
  const rowRefs = useRef<Map<string, HTMLTableRowElement>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [sessions, risksRes] = await Promise.all([listAllResearchSessions(), getAllRisks()]);
        if (cancelled) return;

        const latestSessionByCompany = new Map<string, MonitorRow>();
        for (const session of [...sessions].sort((a, b) => a.created_at.localeCompare(b.created_at))) {
          const company = formatCompanyName(session.company_name);
          if (company === "No company") continue;
          // sessions are sorted ascending, so the last write per company wins == most recent
          latestSessionByCompany.set(company, { company, sessionId: session.session_id, riskLabel: "NONE" });
        }

        const worstMaterialityByCompany = new Map<string, Materiality>();
        for (const risk of risksRes.risks) {
          const company = formatCompanyName(risk.company_name);
          const current = worstMaterialityByCompany.get(company);
          if (!current || MATERIALITY_ORDER.indexOf(risk.materiality) < MATERIALITY_ORDER.indexOf(current)) {
            worstMaterialityByCompany.set(company, risk.materiality);
          }
        }

        const rows = Array.from(latestSessionByCompany.values())
          .map((row) => ({
            ...row,
            riskLabel: worstMaterialityByCompany.get(row.company) ?? ("NONE" as const),
          }))
          .sort((a, b) => a.company.localeCompare(b.company));

        setRowsState({ status: "ok", data: rows });
      } catch (err) {
        if (!cancelled) setRowsState({ status: "error", message: errorMessage(err) });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function runCheck(sessionId: string) {
    setChecks((prev) => ({ ...prev, [sessionId]: { status: "checking" } }));
    try {
      const result = await getRecheck(sessionId);
      setChecks((prev) => ({
        ...prev,
        [sessionId]: { status: "ok", result, checkedAt: new Date().toISOString() },
      }));
    } catch (err) {
      setChecks((prev) => ({
        ...prev,
        [sessionId]: { status: "error", message: errorMessage(err) },
      }));
    }
  }

  const rows = rowsState.status === "ok" ? rowsState.data : [];
  const dialogCheck = dialogSessionId ? checks[dialogSessionId] : null;

  const trimmedEntity = entityInput.trim();
  // Case-insensitive match against the same real company list this page
  // already builds from listAllResearchSessions() — no Sector/Portfolio
  // model exists, so every entry is treated as a company name regardless
  // of what the placeholder text suggests.
  const matchedRow = trimmedEntity
    ? rows.find((r) => r.company.toLowerCase() === trimmedEntity.toLowerCase())
    : undefined;

  useEffect(() => {
    if (!highlightedCompany) return;
    const el = rowRefs.current.get(highlightedCompany);
    el?.scrollIntoView({ behavior: "smooth", block: "center" });
    const timeout = setTimeout(() => setHighlightedCompany(null), 2000);
    return () => clearTimeout(timeout);
  }, [highlightedCompany]);

  function openAddMonitorDialog() {
    setEntityInput("");
    setAddMonitorOpen(true);
  }

  function handleAddMonitor() {
    if (!trimmedEntity) return;

    if (matchedRow) {
      // Already "monitored" per this page's real logic (it lists every
      // company with real data automatically) — surface the existing row
      // instead of creating a duplicate or fabricating a new one.
      setAddMonitorOpen(false);
      setHighlightedCompany(matchedRow.company);
      return;
    }

    // No existing data for this company — the only real action available
    // (per the Monitoring page's actual capability) is starting new
    // research on it, same as any other "start research" entry point.
    setAddMonitorOpen(false);
    router.push(newResearchChatUrl(trimmedEntity));
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Monitoring</h1>
          <p className="mt-2 text-sm text-text-muted">
            Track companies, documents and intelligence for material changes.
          </p>
        </div>

        <Button variant="outline" onClick={openAddMonitorDialog}>
          <Plus className="h-4 w-4" />
          Add Monitor
        </Button>
      </div>

      <p className="mt-4 text-xs text-text-muted">
        &quot;Last Checked&quot; and &quot;Changes&quot; reflect checks you trigger below, in this
        browser session only — there&apos;s no background monitoring job in the backend yet,
        so nothing updates on its own and this resets on reload.
      </p>

      {rowsState.status === "loading" && (
        <p className="mt-6 text-sm text-text-muted">Loading monitors…</p>
      )}
      {rowsState.status === "error" && (
        <p className="mt-6 text-sm text-red-400">Couldn&apos;t load monitors: {rowsState.message}</p>
      )}

      {rowsState.status === "ok" && rows.length === 0 && (
        <p className="mt-6 text-sm text-text-muted">
          No companies with research data yet — run a research session from Chat first.
        </p>
      )}

      {rowsState.status === "ok" && rows.length > 0 && (
        <div className="mt-6 rounded-lg border border-border bg-surface">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Entity</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Last Checked</TableHead>
                <TableHead>Changes</TableHead>
                <TableHead>Risk</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => {
                const check = checks[row.sessionId] ?? { status: "idle" };
                return (
                  <TableRow
                    key={row.sessionId}
                    ref={(el) => {
                      if (el) rowRefs.current.set(row.company, el);
                      else rowRefs.current.delete(row.company);
                    }}
                    className={cn(
                      "transition-colors duration-500",
                      highlightedCompany === row.company && "bg-border/60"
                    )}
                  >
                    <TableCell className="text-text-primary">{row.company}</TableCell>
                    <TableCell className="text-text-muted">Company</TableCell>
                    <TableCell className="text-text-muted">
                      {check.status === "ok" ? formatRelativeTime(check.checkedAt) : "Not checked yet"}
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {check.status === "ok" && !check.result.has_decision_record ? (
                        <button
                          type="button"
                          onClick={() => setDialogSessionId(row.sessionId)}
                          className="underline decoration-dotted hover:text-text-primary"
                        >
                          No snapshot
                        </button>
                      ) : check.status === "ok" ? (
                        <button
                          type="button"
                          onClick={() => setDialogSessionId(row.sessionId)}
                          className="underline decoration-dotted hover:text-text-primary"
                        >
                          {changesCount(check.result)}
                        </button>
                      ) : check.status === "error" ? (
                        <span className="text-red-400">Error</span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-xs font-medium",
                          riskPillClasses(row.riskLabel)
                        )}
                      >
                        {row.riskLabel === "NONE" ? "None" : row.riskLabel}
                      </span>
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">Active</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={check.status === "checking"}
                        onClick={() => runCheck(row.sessionId)}
                      >
                        {check.status === "checking" ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="h-3.5 w-3.5" />
                        )}
                        Check Now
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Recheck result — plain and functional, same spirit as other
          just-built inspector dialogs (Risk page's Evidence Inspector). */}
      <Dialog
        open={dialogSessionId !== null}
        onOpenChange={(open) => {
          if (!open) setDialogSessionId(null);
        }}
      >
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Recheck Result</DialogTitle>
          </DialogHeader>

          {dialogCheck && dialogCheck.status === "ok" && (
            <div className="flex flex-col gap-3 text-sm">
              {!dialogCheck.result.has_decision_record ? (
                <p className="text-text-muted">
                  No decision record snapshot exists for this session yet — nothing to compare
                  against.
                </p>
              ) : (
                <>
                  <p className="text-text-muted">
                    Compared against the snapshot taken{" "}
                    {dialogCheck.result.snapshot_taken_at
                      ? formatRelativeTime(dialogCheck.result.snapshot_taken_at)
                      : "previously"}
                    .
                  </p>
                  <p className="text-text-primary">{dialogCheck.result.summary}</p>
                  <ul className="list-disc space-y-1 pl-5 text-text-muted">
                    <li>{dialogCheck.result.new_findings.length} new finding(s)</li>
                    <li>{dialogCheck.result.changed_findings.length} changed finding(s)</li>
                    <li>
                      {dialogCheck.result.new_financial_observations.length} new financial
                      observation(s)
                    </li>
                    <li>
                      {dialogCheck.result.changed_financial_observations.length} changed financial
                      observation(s)
                    </li>
                    <li>
                      Recommendation changed: {dialogCheck.result.recommendation_changed ? "Yes" : "No"}
                    </li>
                  </ul>
                </>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={addMonitorOpen} onOpenChange={setAddMonitorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add monitor</DialogTitle>
            <DialogDescription>
              Monitors compare newly indexed information against previous intelligence and
              surface material changes.
            </DialogDescription>
          </DialogHeader>

          <div>
            <p className="font-mono-label mb-1.5">ENTITY</p>
            <Input
              autoFocus
              value={entityInput}
              onChange={(e) => setEntityInput(e.target.value)}
              placeholder="Company, sector or portfolio"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAddMonitor();
                }
              }}
            />
          </div>

          {/* Only companies are real (no Sector/Portfolio model exists) —
              every entry is treated as a company name, and this note makes
              the actual outcome explicit before the user submits, rather
              than surprising them with a redirect instead of an instant
              "added" confirmation. */}
          {trimmedEntity && (
            <p className="text-xs text-text-muted">
              {matchedRow
                ? `"${matchedRow.company}" is already being tracked — this will jump to its existing row.`
                : "No existing data for this company — this will start new research."}
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setAddMonitorOpen(false)}>
              Cancel
            </Button>
            <Button type="button" onClick={handleAddMonitor} disabled={!trimmedEntity}>
              Add monitor
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
