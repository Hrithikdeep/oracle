"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CheckCircle2, Circle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ReportView } from "@/components/research/ReportView";
import { ApiError, getFindings, getReport, getResearchSession } from "@/lib/api";
import type { FindingDetail, ResearchReport, ResearchSessionDetail } from "@/lib/types";
import { cn, formatCompanyName, formatRelativeTime } from "@/lib/utils";
import {
  formatStatusLabel,
  isActiveStatus,
  materialityClasses,
  statusDotColor,
} from "@/lib/session-status";

type StageStatus = "done" | "active" | "pending";

function StageRow({ label, status }: { label: string; status: StageStatus }) {
  return (
    <div className="flex items-center gap-3 py-2">
      {status === "done" && <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-500" />}
      {status === "active" && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-500" />}
      {status === "pending" && <Circle className="h-4 w-4 shrink-0 text-text-muted" />}
      <span className={cn("text-sm", status === "pending" ? "text-text-muted" : "text-text-primary")}>
        {label}
      </span>
    </div>
  );
}

const VALID_TABS = ["overview", "plan", "sources", "evidence", "risk", "report"];

export default function ProjectDetailPage({ params }: PageProps<"/app/projects/[id]">) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab");
  const initialTab = requestedTab && VALID_TABS.includes(requestedTab) ? requestedTab : "overview";

  const [session, setSession] = useState<ResearchSessionDetail | null>(null);
  const [findings, setFindings] = useState<FindingDetail[] | null>(null);
  const [report, setReport] = useState<ResearchReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      setSession(null);
      setFindings(null);
      setReport(null);

      try {
        const sessionData = await getResearchSession(id);
        if (cancelled) return;
        setSession(sessionData);

        const findingsData = await getFindings(id);
        if (cancelled) return;
        setFindings(findingsData);

        if (sessionData.report_ready) {
          const reportResult = await getReport(id);
          if (cancelled) return;
          if (reportResult.kind === "ok") setReport(reportResult.data);
        }
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError) {
          setError(
            err.status === 404
              ? "Project not found — this research session doesn't exist."
              : `Server error (HTTP ${err.status}). Please try again later.`
          );
        } else {
          setError("Could not reach the server. Check that the backend is running.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return <div className="p-6 text-sm text-text-muted">Loading project…</div>;
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="rounded-md border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      </div>
    );
  }

  if (!session) return null;

  const totalEvidenceCount = (findings ?? []).reduce((sum, f) => sum + f.evidence.length, 0);

  // "Assessing risks" has no dedicated field on the session — risk_node runs
  // between evidence_node and verification_node in the (currently
  // synchronous) LangGraph pipeline, and the whole graph executes inside one
  // blocking request before the client ever gets a session_id back. So by
  // the time a session is reachable via this page at all with a terminal
  // status, risk assessment has already run to completion — there's no way
  // to observe a session "mid-risk-assessment" through a separate page load
  // in the current architecture. Using the same terminal/active
  // classification the Projects list already uses for consistency.
  const stages: { label: string; done: boolean }[] = [
    { label: "Plan created", done: session.plan_areas.length > 0 },
    { label: `Sources found (${session.sources.length})`, done: session.sources.length > 0 },
    { label: `Evidence extracted (${totalEvidenceCount})`, done: totalEvidenceCount > 0 },
    {
      label: "Calculating financial metrics",
      done: session.financial_observations.length > 0,
    },
    { label: "Assessing risks", done: !isActiveStatus(session.status) },
    {
      label: "Verifying findings",
      done: Object.keys(session.verification_summary).length > 0,
    },
    { label: "Generating report", done: session.report_ready },
  ];
  const firstIncompleteIndex = stages.findIndex((s) => !s.done);
  const stagesWithStatus = stages.map((s, i) => ({
    ...s,
    status: (s.done
      ? "done"
      : i === firstIncompleteIndex && isActiveStatus(session.status)
        ? "active"
        : "pending") as StageStatus,
  }));

  return (
    <div className="p-6">
      {/* Header */}
      <p className="font-mono-label">
        <Link href="/app/projects" className="hover:text-text-primary">
          PROJECTS
        </Link>{" "}
        / {session.question.toUpperCase()}
      </p>
      <h1 className="mt-2 text-3xl font-semibold text-text-primary">{session.question}</h1>
      <div className="mt-2 flex items-center gap-2 text-sm text-text-muted">
        <span>{formatCompanyName(session.company_name).toUpperCase()}</span>
        <span>&middot;</span>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn("h-2 w-2 rounded-full", statusDotColor(session.status))} />
          {formatStatusLabel(session.status)}
        </span>
        <span>&middot;</span>
        <span>updated {formatRelativeTime(session.created_at)}</span>
      </div>

      {/* Tabs */}
      <Tabs defaultValue={initialTab} className="mt-6">
        <TabsList variant="line">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="plan">Plan</TabsTrigger>
          <TabsTrigger value="sources">Sources</TabsTrigger>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="risk">Risk</TabsTrigger>
          <TabsTrigger value="report">Report</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <div className="max-w-md rounded-lg border border-border bg-surface p-4">
            <p className="font-mono-label mb-2">LIVE PROGRESS</p>
            <div className="flex flex-col divide-y divide-border">
              {stagesWithStatus.map((stage) => (
                <StageRow key={stage.label} label={stage.label} status={stage.status} />
              ))}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="plan" className="mt-4">
          <p className="font-mono-label mb-2">PLAN AREAS</p>
          {session.plan_areas.length === 0 ? (
            <p className="text-sm text-text-muted">No plan generated yet.</p>
          ) : (
            <div className="mb-6 flex flex-wrap gap-2">
              {session.plan_areas.map((area) => (
                <Badge key={area} variant="outline">
                  {area}
                </Badge>
              ))}
            </div>
          )}

          <p className="font-mono-label mb-2">TASKS</p>
          {session.tasks.length === 0 ? (
            <p className="text-sm text-text-muted">No tasks yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {session.tasks.map((task, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-text-primary">{task.area}</span>
                    <span className="text-xs text-text-muted">{formatStatusLabel(task.status)}</span>
                  </div>
                  <p className="mt-1 text-text-muted">{task.objective}</p>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="sources" className="mt-4">
          {session.sources.length === 0 ? (
            <p className="text-sm text-text-muted">No sources yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Publisher</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {session.sources.map((source, i) => (
                  <TableRow key={i}>
                    <TableCell className="max-w-sm whitespace-normal text-text-primary">
                      {source.title}
                    </TableCell>
                    <TableCell className="text-text-muted">{source.publisher ?? "—"}</TableCell>
                    <TableCell className="text-text-muted">
                      {formatStatusLabel(source.source_type)}
                    </TableCell>
                    <TableCell className="text-text-muted">
                      {formatStatusLabel(source.status)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </TabsContent>

        <TabsContent value="evidence" className="mt-4">
          <p className="mb-3 text-xs text-text-muted">
            Read-only list for now — the full Evidence Inspector view is still pending a design
            reference.
          </p>
          {!findings || findings.length === 0 ? (
            <p className="text-sm text-text-muted">No findings yet.</p>
          ) : (
            <ul className="flex flex-col gap-3">
              {findings.map((finding) => (
                <li key={finding.id} className="rounded-lg border border-border bg-surface p-4 text-sm">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline">{finding.area}</Badge>
                    <span className="text-xs text-text-muted">{finding.materiality}</span>
                  </div>
                  <p className="mt-2 text-text-primary">{finding.statement}</p>
                  {finding.evidence.length === 0 ? (
                    <p className="mt-2 text-xs text-text-muted">No evidence linked.</p>
                  ) : (
                    <ul className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                      {finding.evidence.map((ev, i) => (
                        <li key={i} className="text-text-muted">
                          &quot;{ev.observation}&quot; — {ev.location}
                          {ev.confidence !== null && ` (confidence: ${ev.confidence})`}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="risk" className="mt-4">
          {session.contradictions.length === 0 ? (
            <p className="text-sm text-text-muted">No contradictions found.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {session.contradictions.map((c, i) => (
                <li key={i} className="rounded-lg border border-border bg-surface p-4 text-sm">
                  <p className="text-text-primary">{c.description}</p>
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 font-medium",
                        materialityClasses(c.materiality)
                      )}
                    >
                      {c.materiality}
                    </span>
                    <span className="text-text-muted">{c.status}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="report" className="mt-4">
          {!session.report_ready ? (
            <p className="text-sm text-text-muted">No report has been generated for this session yet.</p>
          ) : report ? (
            <ReportView report={report} />
          ) : (
            <p className="text-sm text-text-muted">Loading report…</p>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
