"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { UploadDocumentsModal } from "@/components/documents/UploadDocumentsModal";
import { ApiError, listAllDocuments, listAllResearchSessions } from "@/lib/api";
import type { DocumentSummary, SourceStatus, SourceType } from "@/lib/types";
import { cn, formatCompanyName, formatRelativeTime } from "@/lib/utils";

type Load<T> =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ok"; data: T };

function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return `Request failed (HTTP ${err.status}).`;
  return "Could not reach the server.";
}

// Source.source_type is REGULATORY_FILING/EARNINGS_MATERIAL/NEWS/WEB/UPLOAD
// (confirmed on the model) — the reference's Reports/Filings/Research/
// Internal/Other tabs aren't a real backend taxonomy, so this is my own
// explicit 1:1 mapping from the 5 real enum values onto the 5 reference
// category names, not a fabricated new one:
//   REGULATORY_FILING -> Filings   (obvious direct match)
//   EARNINGS_MATERIAL -> Reports   (earnings reports/materials)
//   WEB                -> Research (general web sources used for research)
//   UPLOAD              -> Internal (the user's own uploaded document)
//   NEWS                -> Other    (leaves no category empty by definition)
const TABS: { value: string; label: string; sourceType: SourceType | null }[] = [
  { value: "all", label: "All", sourceType: null },
  { value: "reports", label: "Reports", sourceType: "EARNINGS_MATERIAL" },
  { value: "filings", label: "Filings", sourceType: "REGULATORY_FILING" },
  { value: "research", label: "Research", sourceType: "WEB" },
  { value: "internal", label: "Internal", sourceType: "UPLOAD" },
  { value: "other", label: "Other", sourceType: "NEWS" },
];

function sourceStatusDotColor(status: SourceStatus): string {
  if (status === "RETRIEVED") return "bg-emerald-500";
  if (status === "FAILED") return "bg-red-500";
  if (status === "UNSUPPORTED") return "bg-amber-500";
  return "bg-blue-500"; // DISCOVERED — not yet retrieved
}

function formatSourceStatusLabel(status: SourceStatus): string {
  return status.charAt(0) + status.slice(1).toLowerCase();
}

function formatSourceTypeLabel(type: SourceType): string {
  return type
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export default function DocumentsPage() {
  const [documentsState, setDocumentsState] = useState<Load<DocumentSummary[]>>({
    status: "loading",
  });
  const [companyBySession, setCompanyBySession] = useState<Map<string, string | null>>(new Map());
  const [activeTab, setActiveTab] = useState("all");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);

  const [uploadOpen, setUploadOpen] = useState(false);

  useEffect(() => {
    listAllDocuments()
      .then((docs) => setDocumentsState({ status: "ok", data: docs }))
      .catch((err) => setDocumentsState({ status: "error", message: errorMessage(err) }));

    listAllResearchSessions()
      .then((sessions) => {
        setCompanyBySession(new Map(sessions.map((s) => [s.session_id, s.company_name])));
      })
      .catch(() => {
        // Non-fatal: the Company column just falls back to "No company" for every row.
      });
  }, []);

  const documents = documentsState.status === "ok" ? documentsState.data : [];

  const activeSourceType = TABS.find((t) => t.value === activeTab)?.sourceType ?? null;

  const tabFiltered = useMemo(
    () => (activeSourceType ? documents.filter((d) => d.source_type === activeSourceType) : documents),
    [documents, activeSourceType]
  );

  const failedInTab = useMemo(() => tabFiltered.filter((d) => d.status === "FAILED"), [tabFiltered]);

  const visibleDocuments = onlyFailed ? failedInTab : tabFiltered;

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold text-text-primary">Documents</h1>
          <p className="mt-2 text-sm text-text-muted">
            Every filing, report, research note and internal document available to this
            workspace.
          </p>
        </div>

        <Button variant="outline" onClick={() => setUploadOpen(true)}>
          <Upload className="h-4 w-4" />
          Upload Documents
        </Button>
      </div>

      {/* Filter tabs */}
      <Tabs
        value={activeTab}
        onValueChange={(v) => {
          setActiveTab(v as string);
          setOnlyFailed(false);
        }}
        className="mt-6"
      >
        <TabsList variant="line">
          {TABS.map((tab) => (
            <TabsTrigger key={tab.value} value={tab.value}>
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {documentsState.status === "loading" && (
        <p className="mt-6 text-sm text-text-muted">Loading documents…</p>
      )}
      {documentsState.status === "error" && (
        <p className="mt-6 text-sm text-red-400">
          Couldn&apos;t load documents: {documentsState.message}
        </p>
      )}

      {documentsState.status === "ok" && (
        <>
          {/* Failed-documents banner */}
          {!bannerDismissed && failedInTab.length > 0 && (
            <div className="mt-6 flex items-center justify-between gap-3 rounded-lg border border-red-900/40 bg-red-950/20 px-4 py-3 text-sm text-red-400">
              <div className="flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                <span>
                  Document processing failed for {failedInTab.length} document
                  {failedInTab.length === 1 ? "" : "s"} in this view.
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setOnlyFailed(true)}
                  className="underline decoration-dotted hover:text-red-300"
                >
                  View
                </button>
                <button
                  type="button"
                  onClick={() => setBannerDismissed(true)}
                  aria-label="Dismiss"
                  className="text-red-400 hover:text-red-300"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          )}

          {onlyFailed && (
            <div className="mt-4 flex items-center gap-2 text-xs text-text-muted">
              Showing only failed documents.
              <button
                type="button"
                onClick={() => setOnlyFailed(false)}
                className="underline decoration-dotted hover:text-text-primary"
              >
                Clear
              </button>
            </div>
          )}

          {/* Table */}
          <div className="mt-4 rounded-lg border border-border bg-surface">
            {visibleDocuments.length === 0 ? (
              <p className="p-4 text-sm text-text-muted">No documents in this view yet.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Document</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Company</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Owner</TableHead>
                    <TableHead className="text-right">Retrieved</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleDocuments.map((doc) => (
                    <TableRow key={doc.id}>
                      <TableCell className="max-w-sm whitespace-normal text-text-primary">
                        <span className="line-clamp-2">{doc.title}</span>
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {formatSourceTypeLabel(doc.source_type)}
                      </TableCell>
                      <TableCell className="text-text-muted">
                        {formatCompanyName(companyBySession.get(doc.session_id) ?? null)}
                      </TableCell>
                      <TableCell>
                        <span className="inline-flex items-center gap-2 text-text-primary">
                          <span
                            className={cn(
                              "h-2 w-2 shrink-0 rounded-full",
                              sourceStatusDotColor(doc.status)
                            )}
                          />
                          {formatSourceStatusLabel(doc.status)}
                        </span>
                      </TableCell>
                      <TableCell className="text-text-muted">—</TableCell>
                      <TableCell className="text-right text-text-muted">
                        {doc.retrieved_at ? formatRelativeTime(doc.retrieved_at) : "Never"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <UploadDocumentsModal open={uploadOpen} onOpenChange={setUploadOpen} />
    </div>
  );
}
