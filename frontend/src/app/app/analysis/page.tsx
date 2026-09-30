"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  CartesianGrid,
  Line,
  LineChart,
  Bar,
  BarChart,
  Legend,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiError, getFinancialObservations, listAllResearchSessions } from "@/lib/api";
import type { FinancialObservationDetail } from "@/lib/types";
import { formatCompanyName } from "@/lib/utils";

const COMPARE_LINE_COLORS = ["#3b82f6", "#f59e0b", "#a855f7"];
const NONE_VALUE = "__none__";

function formatSourceLabel(source: string): string {
  if (source === "yfinance") return "yfinance";
  if (source === "calculated") return "Calculated";
  return source;
}

// The Finance Engine (services/finance_engine.py) only ever computes these
// 5 metrics from yfinance data: total_revenue, net_income, operating_income
// (REPORTED) and revenue_growth_yoy, operating_margin (CALCULATED). EBITDA,
// EBITDA Margin, Free Cash Flow, Debt and Net Debt/EBITDA are never computed
// anywhere in the backend — grepped the whole codebase to confirm. Those
// cards always render "No data" rather than a fabricated number; this is
// the correct, honest state, not a bug.
const METRIC_CARDS: { label: string; metric: string }[] = [
  { label: "Revenue", metric: "total_revenue" },
  { label: "Revenue Growth", metric: "revenue_growth_yoy" },
  { label: "EBITDA", metric: "ebitda" },
  { label: "EBITDA Margin", metric: "ebitda_margin" },
  { label: "Net Income", metric: "net_income" },
  { label: "Free Cash Flow", metric: "free_cash_flow" },
  { label: "Debt", metric: "total_debt" },
  { label: "Net Debt/EBITDA", metric: "net_debt_to_ebitda" },
];

function formatMetricValue(value: number, unit: string): string {
  if (unit === "percent") return `${value.toFixed(2)}%`;
  if (unit === "USD_millions") {
    if (Math.abs(value) >= 1000) return `$${(value / 1000).toFixed(2)}B`;
    return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}M`;
  }
  return `${value} ${unit}`;
}

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

function MetricCard({ label, obs }: { label: string; obs: FinancialObservationDetail | undefined }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <p className="text-xs text-text-muted">{label}</p>
      {obs ? (
        <p className="mt-1 text-3xl font-bold tracking-tight text-text-primary tabular-nums">
          {formatMetricValue(obs.value, obs.unit)}
        </p>
      ) : (
        <p className="mt-1 text-3xl font-bold tracking-tight text-text-muted">No data</p>
      )}
    </div>
  );
}

function ExplainLink() {
  return (
    <button
      type="button"
      disabled
      title="Coming soon — narrative interpretation per metric isn't wired up yet."
      className="text-xs text-text-muted underline decoration-dotted disabled:cursor-not-allowed disabled:opacity-50"
    >
      Explain
    </button>
  );
}

const CHART_BG = "var(--border)";
const CHART_TEXT = "var(--text-muted)";

// Shared Recharts prop bags, applied at every chart instance on this page —
// one definition instead of 8 hand-copied ones, for a consistent, less
// default-Recharts look: faint dashed gridlines, borderless floating axis
// labels, a ringed dot marker, and a tooltip on the app's own shadow/radius
// tokens. Visual-only — no chart's data, axes, or behavior changes.
const CHART_GRID_PROPS = {
  stroke: CHART_BG,
  strokeOpacity: 0.6,
  strokeDasharray: "3 5",
  vertical: false,
} as const;
const CHART_AXIS_PROPS = {
  stroke: CHART_TEXT,
  fontSize: 12,
  tickLine: false,
  axisLine: false,
} as const;
const CHART_TOOLTIP_STYLE: React.CSSProperties = {
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: 10,
  boxShadow: "var(--card-shadow)",
  padding: "8px 12px",
  fontSize: 12,
};
const CHART_LEGEND_PROPS = {
  wrapperStyle: { fontSize: 12, paddingTop: 8 },
  iconType: "circle",
  iconSize: 8,
} as const;
const CHART_ACTIVE_DOT = { r: 5 } as const;

function chartDot(color: string) {
  return { r: 3, strokeWidth: 2, stroke: "var(--surface)", fill: color };
}

/** Card wrapper shared by every chart section — title + Explain link, same
 * border/surface/padding as the metric cards. */
function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono-label">{title}</p>
        <ExplainLink />
      </div>
      {children}
    </div>
  );
}

/** The one honest empty state reused by every chart whose metric the Finance
 * Engine has never computed (EBITDA, EBITDA Margin, Free Cash Flow, Debt) —
 * same structure/messaging format for all of them, just the metric name
 * swapped in. */
function NoDataChart({ metricLabel }: { metricLabel: string }) {
  return (
    <div className="mt-8 flex h-56 items-center justify-center">
      <p className="text-sm text-text-muted">
        No data — {metricLabel} isn&apos;t computed by the Finance Engine yet.
      </p>
    </div>
  );
}

// Only the 3 metrics with real data get a comparison chart — building
// "No data" chart placeholders for the other 5 in compare mode too would
// just repeat the same message 5x without adding anything the table above
// doesn't already say once per metric.
const COMPARE_CHART_METRICS: { title: string; metric: string; unit: "USD_millions" | "percent"; kind: "line" | "bar" }[] = [
  { title: "REVENUE COMPARISON", metric: "total_revenue", unit: "USD_millions", kind: "line" },
  { title: "REVENUE GROWTH COMPARISON", metric: "revenue_growth_yoy", unit: "percent", kind: "line" },
  { title: "NET INCOME COMPARISON", metric: "net_income", unit: "USD_millions", kind: "bar" },
];

interface CompareViewProps {
  companies: Load<string[]>;
  companyA: string | null;
  companyB: string | null;
  companyC: string | null;
  setCompanyA: (v: string | null) => void;
  setCompanyB: (v: string | null) => void;
  setCompanyC: (v: string | null) => void;
  compareCompanies: string[];
  compareObservations: Record<string, Load<FinancialObservationDetail[]>>;
  comparePeriods: string[];
  comparePeriod: string | null;
  setComparePeriod: (v: string | null) => void;
  findCompareObs: (company: string, metric: string) => FinancialObservationDetail | undefined;
  compareSeriesFor: (metric: string) => Record<string, string | number>[];
}

function CompanySelect({
  label,
  value,
  onChange,
  companyList,
  allowNone,
}: {
  label: string;
  value: string | null;
  onChange: (v: string | null) => void;
  companyList: string[];
  allowNone?: boolean;
}) {
  const items: Record<string, string> = Object.fromEntries(companyList.map((c) => [c, c]));
  if (allowNone) items[NONE_VALUE] = "None";

  return (
    <div>
      <p className="font-mono-label mb-1.5">{label}</p>
      <Select
        items={items}
        value={value ?? (allowNone ? NONE_VALUE : undefined)}
        onValueChange={(v) => onChange(v === NONE_VALUE ? null : v)}
      >
        <SelectTrigger className="w-50">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {allowNone && <SelectItem value={NONE_VALUE}>None</SelectItem>}
          {companyList.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}

function CompareView({
  companies,
  companyA,
  companyB,
  companyC,
  setCompanyA,
  setCompanyB,
  setCompanyC,
  compareCompanies,
  compareObservations,
  comparePeriods,
  comparePeriod,
  setComparePeriod,
  findCompareObs,
  compareSeriesFor,
}: CompareViewProps) {
  const companyList = companies.status === "ok" ? companies.data : [];
  // Gate on the fully-resolved value, not just "the list loaded" — Company
  // A/B are always controlled (never allow a `None` state), so mounting
  // them before their value effect has actually run would render with
  // value=undefined first and flip to controlled a render later, which
  // Base UI's Select/Tabs both warn about (and did, before this fix).
  // Company C and the period Tabs are unaffected the same way: C always has
  // a defined sentinel (NONE_VALUE) even when "empty", so it's controlled
  // from its first render regardless.
  const selectorsReady = companyList.length > 0 && companyA !== null && companyB !== null;

  return (
    <>
      {/* Company selection */}
      <div className="mt-6 flex flex-wrap items-end gap-3">
        {!selectorsReady ? (
          <div className="h-8 w-40 animate-pulse rounded-lg bg-border" />
        ) : (
          <>
            <CompanySelect label="COMPANY A" value={companyA} onChange={setCompanyA} companyList={companyList} />
            <CompanySelect label="COMPANY B" value={companyB} onChange={setCompanyB} companyList={companyList} />
            <CompanySelect
              label="COMPANY C (OPTIONAL)"
              value={companyC}
              onChange={setCompanyC}
              companyList={companyList}
              allowNone
            />
          </>
        )}

        {comparePeriod !== null && (
          <Tabs value={comparePeriod} onValueChange={(v) => setComparePeriod(v as string)}>
            <TabsList variant="line">
              {comparePeriods.map((period) => (
                <TabsTrigger key={period} value={period}>
                  {period}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {compareCompanies.length === 0 && (
        <p className="mt-6 text-sm text-text-muted">Select at least one company to compare.</p>
      )}

      {compareCompanies.some((c) => compareObservations[c]?.status === "loading") && (
        <p className="mt-6 text-sm text-text-muted">Loading financial data…</p>
      )}

      {compareCompanies.length > 0 && comparePeriod && (
        <>
          {/* Comparison table */}
          <div className="mt-6 rounded-lg border border-border bg-surface">
            <p className="font-mono-label p-4 pb-0">COMPARISON — {comparePeriod}</p>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Metric</TableHead>
                  {compareCompanies.map((company) => (
                    <TableHead key={company}>{company}</TableHead>
                  ))}
                  <TableHead>Source</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {METRIC_CARDS.map((card) => {
                  const obsPerCompany = compareCompanies.map((c) => findCompareObs(c, card.metric));
                  // Real provenance, not a fabricated citation — the source
                  // is driven by observation_type (yfinance vs calculated),
                  // never by which company it is, so any one real obs's
                  // source is representative for the whole row.
                  const source = obsPerCompany.find((o) => o !== undefined)?.source;
                  return (
                    <TableRow key={card.metric}>
                      <TableCell className="text-text-primary">{card.label}</TableCell>
                      {compareCompanies.map((company, i) => {
                        const obs = obsPerCompany[i];
                        const companyState = compareObservations[company];
                        return (
                          <TableCell key={company} className={obs ? "text-text-primary" : "text-text-muted"}>
                            {companyState?.status === "error"
                              ? "Error"
                              : obs
                                ? formatMetricValue(obs.value, obs.unit)
                                : "No data"}
                          </TableCell>
                        );
                      })}
                      <TableCell className="text-text-muted">
                        {source ? formatSourceLabel(source) : ""}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>

          {/* Comparison charts — only for the 3 metrics with real data */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {COMPARE_CHART_METRICS.map(({ title, metric, unit, kind }) => {
              const series = compareSeriesFor(metric);
              const hasAnyData = series.some((row) =>
                compareCompanies.some((c) => typeof row[c] === "number")
              );
              return (
                <ChartCard key={metric} title={title}>
                  {!hasAnyData ? (
                    <p className="mt-8 text-center text-sm text-text-muted">No data</p>
                  ) : (
                    <div className="mt-4 h-56">
                      <ResponsiveContainer width="100%" height="100%">
                        {kind === "line" ? (
                          <LineChart data={series}>
                            <CartesianGrid {...CHART_GRID_PROPS} />
                            <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                            <YAxis {...CHART_AXIS_PROPS} width={50} />
                            <RechartsTooltip
                              contentStyle={CHART_TOOLTIP_STYLE}
                              formatter={(value) => formatMetricValue(Number(value), unit)}
                            />
                            <Legend {...CHART_LEGEND_PROPS} />
                            {compareCompanies.map((company, i) => (
                              <Line
                                key={company}
                                type="monotone"
                                dataKey={company}
                                stroke={COMPARE_LINE_COLORS[i % COMPARE_LINE_COLORS.length]}
                                strokeWidth={2.5}
                                dot={chartDot(COMPARE_LINE_COLORS[i % COMPARE_LINE_COLORS.length])}
                                activeDot={CHART_ACTIVE_DOT}
                                connectNulls
                              />
                            ))}
                          </LineChart>
                        ) : (
                          <BarChart data={series}>
                            <CartesianGrid {...CHART_GRID_PROPS} />
                            <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                            <YAxis {...CHART_AXIS_PROPS} width={50} />
                            <RechartsTooltip
                              contentStyle={CHART_TOOLTIP_STYLE}
                              formatter={(value) => formatMetricValue(Number(value), unit)}
                            />
                            <Legend {...CHART_LEGEND_PROPS} />
                            {compareCompanies.map((company, i) => (
                              <Bar
                                key={company}
                                dataKey={company}
                                fill={COMPARE_LINE_COLORS[i % COMPARE_LINE_COLORS.length]}
                                radius={[6, 6, 0, 0]}
                              />
                            ))}
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  )}
                </ChartCard>
              );
            })}
          </div>
        </>
      )}
    </>
  );
}

export default function AnalysisPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-text-muted">Loading…</div>}>
      <AnalysisPageInner />
    </Suspense>
  );
}

function AnalysisPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedCompany = searchParams.get("company");
  const isCompareMode = searchParams.get("view") === "compare";

  const [companies, setCompanies] = useState<Load<string[]>>({ status: "loading" });
  const [selectedCompany, setSelectedCompany] = useState<string | null>(null);
  const [observations, setObservations] = useState<Load<FinancialObservationDetail[]>>({
    status: "loading",
  });
  const [selectedPeriod, setSelectedPeriod] = useState<string | null>(null);

  // Compare mode
  const [companyA, setCompanyA] = useState<string | null>(null);
  const [companyB, setCompanyB] = useState<string | null>(null);
  const [companyC, setCompanyC] = useState<string | null>(null); // optional
  const [compareObservations, setCompareObservations] = useState<
    Record<string, Load<FinancialObservationDetail[]>>
  >({});
  const [comparePeriod, setComparePeriod] = useState<string | null>(null);

  function toggleCompareMode() {
    const params = new URLSearchParams(searchParams);
    if (isCompareMode) {
      params.delete("view");
    } else {
      params.set("view", "compare");
      // Carry the single-company view's context over as Company A, for
      // continuity, rather than resetting to blank.
      setCompanyA((prev) => prev ?? selectedCompany);
    }
    router.push(`/app/analysis?${params.toString()}`);
  }

  useEffect(() => {
    listAllResearchSessions()
      .then((sessions) => {
        const names = Array.from(
          new Set(
            sessions
              .map((s) => formatCompanyName(s.company_name))
              .filter((name) => name !== "No company")
          )
        ).sort();
        setCompanies({ status: "ok", data: names });
        if (names.length === 0) return;
        // ?company= deep link (from /app/dashboards) wins if it matches a
        // real company with data; otherwise fall back to the first one
        // alphabetically, same as before this param existed.
        const preselect = requestedCompany && names.includes(requestedCompany) ? requestedCompany : names[0];
        setSelectedCompany((prev) => prev ?? preselect);
      })
      .catch((err) => setCompanies({ status: "error", message: errorMessage(err) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!selectedCompany) return;
    setObservations({ status: "loading" });
    getFinancialObservations(selectedCompany)
      .then((res) => {
        setObservations({ status: "ok", data: res.observations });
        const periods = Array.from(new Set(res.observations.map((o) => o.period))).sort();
        setSelectedPeriod(periods.length > 0 ? periods[periods.length - 1] : null);
      })
      .catch((err) => setObservations({ status: "error", message: errorMessage(err) }));
  }, [selectedCompany]);

  // Default Company A/B once the company list loads, if compare mode is
  // entered directly (e.g. a bookmarked ?view=compare URL) before the user
  // picks anything.
  useEffect(() => {
    if (companies.status !== "ok" || companies.data.length === 0) return;
    setCompanyA((prev) => prev ?? companies.data[0]);
    setCompanyB((prev) => prev ?? companies.data.find((c) => c !== companies.data[0]) ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companies]);

  const compareCompanies = useMemo(
    () => [companyA, companyB, companyC].filter((c): c is string => !!c),
    [companyA, companyB, companyC]
  );

  useEffect(() => {
    for (const company of compareCompanies) {
      if (compareObservations[company]) continue; // already loaded/loading — financial data is immutable, safe to cache
      setCompareObservations((prev) => ({ ...prev, [company]: { status: "loading" } }));
      getFinancialObservations(company)
        .then((res) =>
          setCompareObservations((prev) => ({ ...prev, [company]: { status: "ok", data: res.observations } }))
        )
        .catch((err) =>
          setCompareObservations((prev) => ({
            ...prev,
            [company]: { status: "error", message: errorMessage(err) },
          }))
        );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareCompanies]);

  // Union of periods across every selected company that has any data — NOT
  // the intersection. Intersecting would break the whole period selector
  // the moment one selected company has zero observations (e.g. Google),
  // which is exactly the sparse-company case that must NOT break the table.
  // Companies missing a given period just show "No data" for that period
  // instead, same as the single-company view already does per metric.
  const comparePeriods = useMemo(() => {
    const allPeriods = new Set<string>();
    for (const company of compareCompanies) {
      const state = compareObservations[company];
      if (state?.status === "ok") {
        for (const o of state.data) allPeriods.add(o.period);
      }
    }
    return Array.from(allPeriods).sort();
  }, [compareCompanies, compareObservations]);

  useEffect(() => {
    if (comparePeriods.length === 0) return;
    setComparePeriod((prev) => (prev && comparePeriods.includes(prev) ? prev : comparePeriods[comparePeriods.length - 1]));
  }, [comparePeriods]);

  function findCompareObs(company: string, metric: string): FinancialObservationDetail | undefined {
    const state = compareObservations[company];
    if (state?.status !== "ok") return undefined;
    return state.data.find((o) => o.metric === metric && o.period === comparePeriod);
  }

  function compareSeriesFor(metric: string) {
    return comparePeriods.map((period) => {
      const row: Record<string, string | number> = { period };
      for (const company of compareCompanies) {
        const state = compareObservations[company];
        const obs = state?.status === "ok" ? state.data.find((o) => o.metric === metric && o.period === period) : undefined;
        if (obs) row[company] = obs.value;
      }
      return row;
    });
  }

  const data = observations.status === "ok" ? observations.data : [];

  const periods = useMemo(
    () => Array.from(new Set(data.map((o) => o.period))).sort(),
    [data]
  );

  const revenueSeries = useMemo(
    () =>
      data
        .filter((o) => o.metric === "total_revenue")
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((o) => ({ period: o.period, value: o.value })),
    [data]
  );

  const ebitdaSeries = useMemo(
    () =>
      data
        .filter((o) => o.metric === "ebitda")
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((o) => ({ period: o.period, value: o.value })),
    [data]
  );

  const marginSeries = useMemo(
    () =>
      data
        .filter((o) => o.metric === "ebitda_margin")
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((o) => ({ period: o.period, value: o.value })),
    [data]
  );

  const freeCashFlowSeries = useMemo(
    () =>
      data
        .filter((o) => o.metric === "free_cash_flow")
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((o) => ({ period: o.period, value: o.value })),
    [data]
  );

  const netIncomeSeries = useMemo(
    () =>
      data
        .filter((o) => o.metric === "net_income")
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((o) => ({ period: o.period, value: o.value })),
    [data]
  );

  const debtSeries = useMemo(
    () =>
      data
        .filter((o) => o.metric === "total_debt")
        .sort((a, b) => a.period.localeCompare(b.period))
        .map((o) => ({ period: o.period, value: o.value })),
    [data]
  );

  function findObs(metric: string): FinancialObservationDetail | undefined {
    return data.find((o) => o.metric === metric && o.period === selectedPeriod);
  }

  return (
    <div className="p-6 page-texture">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Financial Analysis</h1>
          <p className="mt-2 text-sm text-text-muted">
            Deterministic metric calculation from structured data, with narrative interpretation
            layered on top.
          </p>
        </div>

        <Button variant="outline" onClick={toggleCompareMode}>
          {isCompareMode ? "Single company" : "Compare Companies"}
        </Button>
      </div>

      {isCompareMode ? (
        <CompareView
          companies={companies}
          companyA={companyA}
          companyB={companyB}
          companyC={companyC}
          setCompanyA={setCompanyA}
          setCompanyB={setCompanyB}
          setCompanyC={setCompanyC}
          compareCompanies={compareCompanies}
          compareObservations={compareObservations}
          comparePeriods={comparePeriods}
          comparePeriod={comparePeriod}
          setComparePeriod={setComparePeriod}
          findCompareObs={findCompareObs}
          compareSeriesFor={compareSeriesFor}
        />
      ) : (
        <>
      {/* Company + period selection */}
      <div className="mt-6 flex flex-wrap items-center gap-3">
        {companies.status === "loading" && (
          <div className="h-8 w-40 animate-pulse rounded-lg bg-border" />
        )}
        {companies.status === "error" && (
          <p className="text-sm text-red-400">Couldn&apos;t load companies: {companies.message}</p>
        )}
        {companies.status === "ok" && companies.data.length === 0 && (
          <p className="text-sm text-text-muted">No companies with research sessions yet.</p>
        )}
        {companies.status === "ok" && companies.data.length > 0 && (
          <Select
            value={selectedCompany ?? undefined}
            onValueChange={(value) => setSelectedCompany(value)}
          >
            <SelectTrigger className="w-50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {companies.data.map((name) => (
                <SelectItem key={name} value={name}>
                  {name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}

        {periods.length > 0 && (
          <Tabs value={selectedPeriod ?? undefined} onValueChange={(v) => setSelectedPeriod(v as string)}>
            <TabsList variant="line">
              {periods.map((period) => (
                <TabsTrigger key={period} value={period}>
                  {period}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        )}
      </div>

      {observations.status === "loading" && (
        <p className="mt-6 text-sm text-text-muted">Loading financial data…</p>
      )}
      {observations.status === "error" && (
        <p className="mt-6 text-sm text-red-400">
          Couldn&apos;t load financial data: {observations.message}
        </p>
      )}

      {observations.status === "ok" && (
        <>
          {/* Metric cards */}
          <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {METRIC_CARDS.map((card) => (
              <MetricCard key={card.metric} label={card.label} obs={findObs(card.metric)} />
            ))}
          </div>

          {/* Trend charts */}
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="REVENUE TREND">
              {revenueSeries.length === 0 ? (
                <p className="mt-8 text-center text-sm text-text-muted">No data</p>
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={revenueSeries}>
                      <CartesianGrid {...CHART_GRID_PROPS} />
                      <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                      <YAxis {...CHART_AXIS_PROPS} width={50} />
                      <RechartsTooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value) => formatMetricValue(Number(value), "USD_millions")}
                      />
                      <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2.5} dot={chartDot("#3b82f6")} activeDot={CHART_ACTIVE_DOT} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
              {revenueSeries.length === 1 && (
                <p className="mt-2 text-xs text-text-muted">
                  Only 1 period of data available — trend line isn&apos;t meaningful yet.
                </p>
              )}
            </ChartCard>

            <ChartCard title="EBITDA TREND">
              {ebitdaSeries.length === 0 ? (
                <NoDataChart metricLabel="EBITDA" />
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={ebitdaSeries}>
                      <CartesianGrid {...CHART_GRID_PROPS} />
                      <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                      <YAxis {...CHART_AXIS_PROPS} width={50} />
                      <RechartsTooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                      />
                      <Bar dataKey="value" fill="#10b981" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>

          {/* Margin trend + Cash flow */}
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            <ChartCard title="MARGIN TREND">
              {marginSeries.length === 0 ? (
                <NoDataChart metricLabel="EBITDA Margin" />
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={marginSeries}>
                      <CartesianGrid {...CHART_GRID_PROPS} />
                      <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                      <YAxis {...CHART_AXIS_PROPS} width={50} />
                      <RechartsTooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value) => formatMetricValue(Number(value), "percent")}
                      />
                      <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2.5} dot={chartDot("#3b82f6")} activeDot={CHART_ACTIVE_DOT} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>

            <ChartCard title="CASH FLOW">
              {freeCashFlowSeries.length === 0 && netIncomeSeries.length === 0 ? (
                <NoDataChart metricLabel="Free Cash Flow" />
              ) : (
                <>
                  {/* Free Cash Flow itself is never computed by the Finance
                      Engine — rather than blanking this whole section (Net
                      Income IS real data we already have), show the real Net
                      Income bars and flag FCF specifically as missing, so
                      real data isn't hidden just because half the intended
                      comparison is unavailable. */}
                  <p className="mt-1 text-xs text-text-muted">
                    No data — Free Cash Flow isn&apos;t computed by the Finance Engine yet. Showing Net
                    Income only.
                  </p>
                  <div className="mt-3 h-56">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={netIncomeSeries}>
                        <CartesianGrid {...CHART_GRID_PROPS} />
                        <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                        <YAxis {...CHART_AXIS_PROPS} width={50} />
                        <RechartsTooltip
                          contentStyle={CHART_TOOLTIP_STYLE}
                          formatter={(value) => formatMetricValue(Number(value), "USD_millions")}
                        />
                        <Bar dataKey="value" name="Net Income" fill="#10b981" radius={[6, 6, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </>
              )}
            </ChartCard>
          </div>

          {/* Debt Profile */}
          <div className="mt-4">
            <ChartCard title="GROSS DEBT">
              {debtSeries.length === 0 ? (
                <NoDataChart metricLabel="Debt" />
              ) : (
                <div className="mt-4 h-56">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={debtSeries}>
                      <CartesianGrid {...CHART_GRID_PROPS} />
                      <XAxis dataKey="period" {...CHART_AXIS_PROPS} />
                      <YAxis {...CHART_AXIS_PROPS} width={50} />
                      <RechartsTooltip
                        contentStyle={CHART_TOOLTIP_STYLE}
                        formatter={(value) => formatMetricValue(Number(value), "USD_millions")}
                      />
                      <Line type="monotone" dataKey="value" stroke="#3b82f6" strokeWidth={2.5} dot={chartDot("#3b82f6")} activeDot={CHART_ACTIVE_DOT} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}
            </ChartCard>
          </div>
        </>
      )}
        </>
      )}
    </div>
  );
}
