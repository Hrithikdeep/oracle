"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { LayoutDashboard, Plus } from "lucide-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ApiError, getAllRisks, getFinancialObservations, listAllResearchSessions } from "@/lib/api";
import type { RecentRisk, ResearchSessionSummary } from "@/lib/types";
import { formatCompanyName, formatRelativeTime, newResearchChatUrl } from "@/lib/utils";

const NONE_VALUE = "__none__";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

interface CompanyDashboard {
  company: string;
  metricCount: number;
  riskCount: number;
  reportCount: number;
  lastUpdated: string;
}

export default function DashboardsPage() {
  const router = useRouter();
  const [dashboards, setDashboards] = useState<Load<CompanyDashboard[]>>({ status: "loading" });

  const [createOpen, setCreateOpen] = useState(false);
  const [selectedCompany, setSelectedCompany] = useState<string>(NONE_VALUE);
  const [newCompanyInput, setNewCompanyInput] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [sessions, risksRes] = await Promise.all([listAllResearchSessions(), getAllRisks()]);
        if (cancelled) return;

        const companies = Array.from(
          new Set(
            sessions.map((s) => formatCompanyName(s.company_name)).filter((name) => name !== "No company")
          )
        ).sort();

        // Fetching financial observations per company (a handful of real
        // companies in this dev dataset, not a paginated list) rather than
        // adding a new cross-company backend endpoint just for a count.
        const observationCounts = await Promise.all(
          companies.map((company) =>
            getFinancialObservations(company)
              .then((res) => res.observations.length)
              .catch(() => 0)
          )
        );
        if (cancelled) return;

        const sessionsByCompany = new Map<string, ResearchSessionSummary[]>();
        for (const session of sessions) {
          const company = formatCompanyName(session.company_name);
          if (company === "No company") continue;
          const list = sessionsByCompany.get(company) ?? [];
          list.push(session);
          sessionsByCompany.set(company, list);
        }

        const risksByCompany = new Map<string, RecentRisk[]>();
        for (const risk of risksRes.risks) {
          const company = formatCompanyName(risk.company_name);
          if (company === "No company") continue;
          const list = risksByCompany.get(company) ?? [];
          list.push(risk);
          risksByCompany.set(company, list);
        }

        const result: CompanyDashboard[] = companies.map((company, i) => {
          const companySessions = sessionsByCompany.get(company) ?? [];
          const reportCount = companySessions.filter((s) => s.report_ready).length;
          const riskCount = (risksByCompany.get(company) ?? []).length;
          const lastUpdated = companySessions
            .map((s) => s.created_at)
            .sort()
            .at(-1);
          return {
            company,
            metricCount: observationCounts[i],
            riskCount,
            reportCount,
            lastUpdated: lastUpdated ?? new Date(0).toISOString(),
          };
        });

        setDashboards({ status: "ok", data: result });
      } catch (err) {
        if (!cancelled) setDashboards({ status: "error", message: errorMessage(err) });
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  const cards = useMemo(
    () => (dashboards.status === "ok" ? dashboards.data : []),
    [dashboards]
  );

  const trimmedNewCompany = newCompanyInput.trim();
  // Mutually exclusive: the dropdown picks an existing company, the text
  // input starts research on a new one — typing in one clears the other so
  // the primary button's action is never ambiguous.
  const isNewCompanyPath = trimmedNewCompany.length > 0;
  const isExistingCompanyPath = !isNewCompanyPath && selectedCompany !== NONE_VALUE;

  function openCreateDialog() {
    setSelectedCompany(NONE_VALUE);
    setNewCompanyInput("");
    setCreateOpen(true);
  }

  function handleCreateDashboard() {
    if (isNewCompanyPath) {
      setCreateOpen(false);
      router.push(newResearchChatUrl(trimmedNewCompany));
      return;
    }
    if (isExistingCompanyPath) {
      setCreateOpen(false);
      router.push(`/app/analysis?company=${encodeURIComponent(selectedCompany)}`);
    }
  }

  return (
    <div className="p-6 page-texture">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Dashboards</h1>
          <p className="mt-2 text-sm text-text-muted">
            Structured intelligence views built from your analysis, metrics and risk mapping.
          </p>
        </div>

        <Button variant="outline" onClick={openCreateDialog}>
          <Plus className="h-4 w-4" />
          Create Dashboard
        </Button>
      </div>

      {dashboards.status === "loading" && (
        <p className="mt-6 text-sm text-text-muted">Loading dashboards…</p>
      )}
      {dashboards.status === "error" && (
        <p className="mt-6 text-sm text-red-400">
          Couldn&apos;t load dashboards: {dashboards.message}
        </p>
      )}

      {dashboards.status === "ok" && cards.length === 0 && (
        <p className="mt-6 text-sm text-text-muted">
          No companies with research data yet — run a research session from Chat first.
        </p>
      )}

      {dashboards.status === "ok" && cards.length > 0 && (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const componentCount = card.metricCount + card.riskCount + card.reportCount;
            return (
              <button
                key={card.company}
                type="button"
                onClick={() =>
                  router.push(`/app/analysis?company=${encodeURIComponent(card.company)}`)
                }
                className="rounded-lg border border-border bg-surface p-4 text-left transition-colors hover:border-text-muted/40 hover:bg-border/60"
              >
                <div className="flex items-center gap-2 text-text-muted">
                  <LayoutDashboard className="h-4 w-4" />
                  <span className="text-xs">{card.company}</span>
                </div>
                <p className="mt-2 text-base font-medium text-text-primary">
                  {card.company} Intelligence Dashboard
                </p>
                <p className="mt-1 text-xs text-text-muted">
                  Financial metrics, tracked risks and generated reports for {card.company}.
                </p>
                <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
                  <span>
                    {componentCount} component{componentCount === 1 ? "" : "s"}
                  </span>
                  <span>updated {formatRelativeTime(card.lastUpdated)}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create dashboard</DialogTitle>
            <DialogDescription>
              Dashboards are generated automatically for every company with research data in
              this workspace. Select an existing company, or start new research to generate one.
            </DialogDescription>
          </DialogHeader>

          <div>
            <p className="font-mono-label mb-1.5">COMPANY</p>
            {cards.length > 0 ? (
              <Select
                items={{
                  [NONE_VALUE]: "Select a company…",
                  ...Object.fromEntries(cards.map((c) => [c.company, c.company])),
                }}
                value={selectedCompany}
                onValueChange={(v) => {
                  setSelectedCompany(v ?? NONE_VALUE);
                  if (v && v !== NONE_VALUE) setNewCompanyInput("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE}>Select a company…</SelectItem>
                  {cards.map((c) => (
                    <SelectItem key={c.company} value={c.company}>
                      {c.company}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
              <p className="text-sm text-text-muted">
                No companies with research data yet.
              </p>
            )}
          </div>

          <div>
            <p className="font-mono-label mb-1.5">OR RESEARCH A NEW COMPANY</p>
            <Input
              value={newCompanyInput}
              onChange={(e) => {
                setNewCompanyInput(e.target.value);
                if (e.target.value.trim()) setSelectedCompany(NONE_VALUE);
              }}
              placeholder="Company name"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleCreateDashboard();
                }
              }}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateDashboard}
              disabled={!isNewCompanyPath && !isExistingCompanyPath}
            >
              {isNewCompanyPath ? "Start research" : "Open dashboard"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
