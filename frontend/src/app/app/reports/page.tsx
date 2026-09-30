"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClipboardList, FileText, Plus, Search, ShieldAlert, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ApiError, listAllResearchSessions } from "@/lib/api";
import type { ResearchSessionSummary } from "@/lib/types";
import { cn, formatCompanyName, formatRelativeTime } from "@/lib/utils";
import { formatStatusLabel, statusDotColor } from "@/lib/session-status";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

// Static, informational only — the Report model (models/report.py) has no
// `type` field at all (executive_summary, sections, recommendation,
// limitations, created_at is the whole schema), so these are NOT live
// filters and carry no real per-type counts. Every actual report row below
// is the same underlying Report shape regardless of which of these labels
// its content might read like.
const REPORT_TYPES = [
  {
    icon: FileText,
    label: "Investment Memo",
    description: "Thesis, valuation context and recommendation for a single company.",
  },
  {
    icon: Search,
    label: "Research Report",
    description: "Full evidence-backed writeup across every research area.",
  },
  {
    icon: ShieldAlert,
    label: "Risk Report",
    description: "Contradictions, materiality and open questions surfaced during research.",
  },
  {
    icon: ClipboardList,
    label: "Due Diligence Report",
    description: "Sources, verification status and limitations behind each finding.",
  },
  {
    icon: TrendingUp,
    label: "Executive Summary",
    description: "The short version — headline conclusion and key numbers only.",
  },
];

export default function ReportsPage() {
  const router = useRouter();
  const [sessionsState, setSessionsState] = useState<Load<ResearchSessionSummary[]>>({
    status: "loading",
  });

  useEffect(() => {
    listAllResearchSessions()
      .then((data) => setSessionsState({ status: "ok", data }))
      .catch((err) => setSessionsState({ status: "error", message: errorMessage(err) }));
  }, []);

  const reportReadySessions = useMemo(
    () =>
      (sessionsState.status === "ok" ? sessionsState.data : [])
        .filter((s) => s.report_ready)
        .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [sessionsState]
  );

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Reports</h1>
          <p className="mt-2 text-sm text-text-muted">
            Decision-ready output generated from your evidence, analysis and risk assessment.
          </p>
        </div>

        <Button
          variant="outline"
          render={<Link href="/app/chat" />}
          nativeButton={false}
          title="A report only comes from a completed research session — there's no standalone report-creation flow."
        >
          <Plus className="h-4 w-4" />
          New Report
        </Button>
      </div>

      {/* Report Types — static taxonomy, not live data */}
      <div className="mt-6">
        <p className="font-mono-label mb-3">REPORT TYPES</p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {REPORT_TYPES.map(({ icon: Icon, label, description }) => (
            <div key={label} className="rounded-lg border border-border bg-surface p-4">
              <Icon className="h-4 w-4 text-text-muted" />
              <p className="mt-2 text-sm font-medium text-text-primary">{label}</p>
              <p className="mt-1 text-xs text-text-muted">{description}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recent Reports */}
      <div className="mt-6">
        <p className="font-mono-label mb-3">RECENT REPORTS</p>
        <div className="rounded-lg border border-border bg-surface">
          {sessionsState.status === "loading" && (
            <div className="space-y-2 p-4">
              <div className="h-10 animate-pulse rounded bg-border" />
              <div className="h-10 animate-pulse rounded bg-border" />
              <div className="h-10 animate-pulse rounded bg-border" />
            </div>
          )}

          {sessionsState.status === "error" && (
            <p className="p-4 text-sm text-red-400">
              Couldn&apos;t load reports: {sessionsState.message}
            </p>
          )}

          {sessionsState.status === "ok" && reportReadySessions.length === 0 && (
            <p className="p-4 text-sm text-text-muted">No reports generated yet.</p>
          )}

          {sessionsState.status === "ok" && reportReadySessions.length > 0 && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Report</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead className="text-right">Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {reportReadySessions.map((session) => (
                  <TableRow
                    key={session.session_id}
                    className="cursor-pointer"
                    onClick={() => router.push(`/app/projects/${session.session_id}?tab=report`)}
                  >
                    <TableCell className="max-w-sm whitespace-normal text-text-primary">
                      <span className="line-clamp-2">{session.question}</span>
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {formatCompanyName(session.company_name)}
                    </TableCell>
                    <TableCell>
                      <span className="inline-flex items-center gap-2 text-text-primary">
                        <span
                          className={cn("h-2 w-2 shrink-0 rounded-full", statusDotColor(session.status))}
                        />
                        {formatStatusLabel(session.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-text-muted">—</TableCell>
                    <TableCell className="text-right text-text-muted">
                      {formatRelativeTime(session.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </div>
    </div>
  );
}
