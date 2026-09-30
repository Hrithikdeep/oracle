"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Tabs,
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
import { NewProjectModal } from "@/components/projects/NewProjectModal";
import { ApiError, listAllResearchSessions } from "@/lib/api";
import type { ResearchSessionSummary } from "@/lib/types";
import { cn, formatCompanyName, formatRelativeTime } from "@/lib/utils";
import {
  formatStatusLabel,
  isActiveStatus,
  isCompletedStatus,
  statusDotColor,
} from "@/lib/session-status";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

type FilterTab = "all" | "active" | "completed";

export default function ProjectsPage() {
  const router = useRouter();
  const [sessionsState, setSessionsState] = useState<Load<ResearchSessionSummary[]>>({
    status: "loading",
  });
  const [tab, setTab] = useState<FilterTab>("all");

  const [newProjectOpen, setNewProjectOpen] = useState(false);

  useEffect(() => {
    listAllResearchSessions()
      .then((data) => setSessionsState({ status: "ok", data }))
      .catch((err) => setSessionsState({ status: "error", message: errorMessage(err) }));
  }, []);

  const sessions = sessionsState.status === "ok" ? sessionsState.data : [];

  const counts = useMemo(
    () => ({
      all: sessions.length,
      active: sessions.filter((s) => isActiveStatus(s.status)).length,
      completed: sessions.filter((s) => isCompletedStatus(s.status)).length,
    }),
    [sessions]
  );

  const filteredSessions = useMemo(() => {
    if (tab === "active") return sessions.filter((s) => isActiveStatus(s.status));
    if (tab === "completed") return sessions.filter((s) => isCompletedStatus(s.status));
    return sessions;
  }, [sessions, tab]);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Projects</h1>
          <p className="mt-2 text-sm text-text-muted">
            Every research, diligence and risk workstream in this workspace.
          </p>
        </div>

        <Button variant="outline" onClick={() => setNewProjectOpen(true)}>
          <Plus className="h-4 w-4" />
          New Project
        </Button>
      </div>

      {/* Filter tabs */}
      <Tabs
        value={tab}
        onValueChange={(value) => setTab(value as FilterTab)}
        className="mt-6"
      >
        <TabsList variant="line">
          <TabsTrigger value="all">All ({counts.all})</TabsTrigger>
          <TabsTrigger value="active">Active ({counts.active})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({counts.completed})</TabsTrigger>
          <TabsTrigger
            value="archived"
            disabled
            title="Coming soon — archiving isn't a concept the backend tracks yet."
          >
            Archived
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Table */}
      <div className="mt-4 rounded-lg border border-border bg-surface">
        {sessionsState.status === "loading" && (
          <div className="space-y-2 p-4">
            <div className="h-10 animate-pulse rounded bg-border" />
            <div className="h-10 animate-pulse rounded bg-border" />
            <div className="h-10 animate-pulse rounded bg-border" />
            <div className="h-10 animate-pulse rounded bg-border" />
          </div>
        )}

        {sessionsState.status === "error" && (
          <p className="p-4 text-sm text-red-400">
            Couldn&apos;t load projects: {sessionsState.message}
          </p>
        )}

        {sessionsState.status === "ok" && filteredSessions.length === 0 && (
          <p className="p-4 text-sm text-text-muted">No projects in this view yet.</p>
        )}

        {sessionsState.status === "ok" && filteredSessions.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project Name</TableHead>
                <TableHead>Company</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Owner</TableHead>
                <TableHead className="text-right">Last Updated</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredSessions.map((session) => (
                <TableRow
                  key={session.session_id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/app/projects/${session.session_id}`)}
                >
                  <TableCell className="max-w-xs whitespace-normal text-text-primary">
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

      <NewProjectModal open={newProjectOpen} onOpenChange={setNewProjectOpen} />
    </div>
  );
}
