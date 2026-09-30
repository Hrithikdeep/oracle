"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  Building2,
  FileText,
  FolderKanban,
  Plus,
  Sparkles,
  Upload,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { UploadDocumentsModal } from "@/components/documents/UploadDocumentsModal";
import {
  ApiError,
  getRecentFindings,
  getRecentRisks,
  listAllResearchSessions,
  listDocuments,
} from "@/lib/api";
import type { RecentFinding, RecentRisk, ResearchSessionSummary } from "@/lib/types";
import { cn, formatCompanyName, formatRelativeTime } from "@/lib/utils";
import { ACTIVE_STATUSES, materialityClasses, statusDotColor } from "@/lib/session-status";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

export default function AppHomePage() {
  const [sessionsState, setSessionsState] = useState<Load<ResearchSessionSummary[]>>({
    status: "loading",
  });
  const [documentsTotalState, setDocumentsTotalState] = useState<Load<number>>({
    status: "loading",
  });
  const [findingsState, setFindingsState] = useState<Load<RecentFinding[]>>({
    status: "loading",
  });
  const [risksState, setRisksState] = useState<Load<RecentRisk[]>>({ status: "loading" });

  const [uploadOpen, setUploadOpen] = useState(false);
  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    listAllResearchSessions()
      .then((data) => setSessionsState({ status: "ok", data }))
      .catch((err) => setSessionsState({ status: "error", message: errorMessage(err) }));

    listDocuments({ limit: 1 })
      .then((res) => setDocumentsTotalState({ status: "ok", data: res.total }))
      .catch((err) => setDocumentsTotalState({ status: "error", message: errorMessage(err) }));

    getRecentFindings(5)
      .then((res) => setFindingsState({ status: "ok", data: res.findings }))
      .catch((err) => setFindingsState({ status: "error", message: errorMessage(err) }));

    getRecentRisks(5)
      .then((res) => setRisksState({ status: "ok", data: res.risks }))
      .catch((err) => setRisksState({ status: "error", message: errorMessage(err) }));
  }, []);

  const sessions = sessionsState.status === "ok" ? sessionsState.data : null;
  const activeProjects = sessions?.filter((s) => ACTIVE_STATUSES.has(s.status)).length ?? null;
  const reportsReady = sessions?.filter((s) => s.report_ready).length ?? null;
  const monitoredCompanies = sessions
    ? new Set(
        sessions
          .map((s) => formatCompanyName(s.company_name))
          .filter((name) => name !== "No company")
      ).size
    : null;
  const recentProjects = sessions?.slice(0, 4) ?? [];

  return (
    <div className="p-6 page-texture">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="font-mono-label">INVESTMENT INTELLIGENCE</p>
          <h1 className="mt-2 text-3xl font-semibold text-text-primary">Welcome back, there.</h1>
          <p className="mt-2 text-sm text-text-muted">
            Here&apos;s what&apos;s happening across your research.
          </p>
        </div>

        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Button variant="outline" onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4" />
            Upload Documents
          </Button>
          <Button variant="outline" onClick={() => setNewProjectOpen(true)}>
            <Plus className="h-4 w-4" />
            New Project
          </Button>
          <Button render={<Link href="/app/chat" />} nativeButton={false}>
            <Plus className="h-4 w-4" />
            New Research
          </Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mt-8 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          icon={<FolderKanban className="h-4 w-4" />}
          label="Active Projects"
          state={sessionsState}
          value={activeProjects}
        />
        <StatCard
          icon={<FileText className="h-4 w-4" />}
          label="Documents"
          state={documentsTotalState}
          value={documentsTotalState.status === "ok" ? documentsTotalState.data : null}
        />
        <StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="Reports"
          state={sessionsState}
          value={reportsReady}
        />
        <StatCard
          icon={<Building2 className="h-4 w-4" />}
          label="Monitored Companies"
          state={sessionsState}
          value={monitoredCompanies}
        />
      </div>

      {/* Main content: recent projects + intelligence, risk sidebar */}
      <div className="mt-8 grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-8">
          <section>
            <p className="font-mono-label">RECENT PROJECTS</p>
            <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {sessionsState.status === "loading" && (
                <>
                  <CardSkeleton />
                  <CardSkeleton />
                  <CardSkeleton />
                  <CardSkeleton />
                </>
              )}
              {sessionsState.status === "error" && (
                <InlineError message={sessionsState.message} className="sm:col-span-2" />
              )}
              {sessionsState.status === "ok" && recentProjects.length === 0 && (
                <p className="text-sm text-text-muted sm:col-span-2">
                  No research sessions yet.
                </p>
              )}
              {sessionsState.status === "ok" &&
                recentProjects.map((session) => (
                  <Link
                    key={session.session_id}
                    href={`/app/projects/${session.session_id}`}
                    className="rounded-lg border border-border bg-surface p-4 transition-colors hover:border-text-muted/40 hover:bg-border/60"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="line-clamp-2 text-sm font-medium text-text-primary">
                        {session.question}
                      </p>
                      <span
                        className={cn(
                          "mt-1 h-2 w-2 shrink-0 rounded-full",
                          statusDotColor(session.status)
                        )}
                        aria-label={session.status}
                      />
                    </div>
                    <div className="mt-3 flex items-center justify-between text-xs text-text-muted">
                      <span>{formatCompanyName(session.company_name)}</span>
                      <span>updated {formatRelativeTime(session.created_at)}</span>
                    </div>
                    {session.report_ready && (
                      <Badge variant="outline" className="mt-2">
                        Report ready
                      </Badge>
                    )}
                  </Link>
                ))}
            </div>
          </section>

          <section>
            <p className="font-mono-label">RECENT INTELLIGENCE</p>
            <div className="mt-3 space-y-2">
              {findingsState.status === "loading" && (
                <>
                  <RowSkeleton />
                  <RowSkeleton />
                  <RowSkeleton />
                </>
              )}
              {findingsState.status === "error" && <InlineError message={findingsState.message} />}
              {findingsState.status === "ok" && findingsState.data.length === 0 && (
                <p className="text-sm text-text-muted">No findings yet.</p>
              )}
              {findingsState.status === "ok" &&
                findingsState.data.map((finding) => (
                  <div
                    key={finding.id}
                    className="rounded-lg border border-border bg-surface p-4"
                  >
                    <p className="line-clamp-2 text-sm text-text-primary">{finding.statement}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                      <Badge variant="outline">{finding.area}</Badge>
                      <span>{formatCompanyName(finding.company_name)}</span>
                      <span>&middot;</span>
                      <span>{formatRelativeTime(finding.created_at)}</span>
                    </div>
                  </div>
                ))}
            </div>
          </section>
        </div>

        <div>
          <p className="font-mono-label">RISK WATCH</p>
          <div className="mt-3 space-y-2">
            {risksState.status === "loading" && (
              <>
                <RowSkeleton />
                <RowSkeleton />
                <RowSkeleton />
              </>
            )}
            {risksState.status === "error" && <InlineError message={risksState.message} />}
            {risksState.status === "ok" && risksState.data.length === 0 && (
              <p className="text-sm text-text-muted">No risks flagged yet.</p>
            )}
            {risksState.status === "ok" &&
              risksState.data.map((risk) => (
                <div key={risk.id} className="rounded-lg border border-border bg-surface p-4">
                  <div className="flex items-start justify-between gap-2">
                    <AlertTriangle className="h-4 w-4 shrink-0 text-text-muted" />
                    <span
                      className={cn(
                        "rounded-full px-2 py-0.5 text-[0.65rem] font-medium",
                        materialityClasses(risk.materiality)
                      )}
                    >
                      {risk.materiality}
                    </span>
                  </div>
                  <p className="mt-2 line-clamp-3 text-sm text-text-primary">{risk.description}</p>
                  <p className="mt-2 text-xs text-text-muted">
                    {formatCompanyName(risk.company_name)}
                  </p>
                </div>
              ))}
          </div>
        </div>
      </div>

      <UploadDocumentsModal open={uploadOpen} onOpenChange={setUploadOpen} />
      <NewProjectModal open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  state,
}: {
  icon: React.ReactNode;
  label: string;
  value: number | null;
  state: Load<unknown>;
}) {
  return (
    <div className="rounded-lg border border-border bg-surface p-4">
      <div className="flex items-center gap-2 text-text-muted">
        {icon}
        <span className="text-xs">{label}</span>
      </div>
      <p className="mt-1 text-4xl font-bold tracking-tight text-text-primary tabular-nums">
        {state.status === "loading" && (
          <span className="inline-block h-9 w-12 animate-pulse rounded bg-border" />
        )}
        {state.status === "error" && <span className="text-base text-red-400">—</span>}
        {state.status === "ok" && (value ?? 0)}
      </p>
    </div>
  );
}

function CardSkeleton() {
  return (
    <div className="h-26 animate-pulse rounded-lg border border-border bg-surface" />
  );
}

function RowSkeleton() {
  return <div className="h-20 animate-pulse rounded-lg border border-border bg-surface" />;
}

function InlineError({ message, className }: { message: string; className?: string }) {
  return (
    <p className={cn("text-sm text-red-400", className)}>Couldn&apos;t load this section: {message}</p>
  );
}
