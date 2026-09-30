"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileText, Lightbulb, FolderKanban, Search, Bell, HelpCircle, LogOut } from "lucide-react";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { IconButton } from "./IconButton";
import { ThemeToggle } from "./ThemeToggle";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { listAllResearchSessions, listAllDocuments, getRecentFindings } from "@/lib/api";
import type { DocumentSummary, RecentFinding, ResearchSessionSummary } from "@/lib/types";
import { cn, formatCompanyName } from "@/lib/utils";
import { logout } from "@/lib/auth";

// Client-side filter over already-fetched/cached data — no search endpoint
// exists on the backend. Findings are capped at the most recent 50
// (GET /findings/recent's own server-side limit, le=50) — this searches
// "recent findings", not the complete Finding table, and the empty-state
// copy below says so rather than implying a full-table search.
const MAX_RESULTS_PER_GROUP = 5;
const FINDINGS_SEARCH_POOL = 50;

type SearchCache = {
  sessions: ResearchSessionSummary[];
  documents: DocumentSummary[];
  findings: RecentFinding[];
};

type SearchResults = {
  sessions: ResearchSessionSummary[];
  documents: DocumentSummary[];
  findings: RecentFinding[];
  totalSessions: number;
  totalDocuments: number;
  totalFindings: number;
};

function filterResults(cache: SearchCache, query: string): SearchResults {
  const q = query.trim().toLowerCase();

  const matchedSessions = cache.sessions.filter(
    (s) =>
      s.question.toLowerCase().includes(q) ||
      formatCompanyName(s.company_name).toLowerCase().includes(q)
  );
  const matchedDocuments = cache.documents.filter((d) => d.title.toLowerCase().includes(q));
  const matchedFindings = cache.findings.filter((f) => f.statement.toLowerCase().includes(q));

  return {
    sessions: matchedSessions.slice(0, MAX_RESULTS_PER_GROUP),
    documents: matchedDocuments.slice(0, MAX_RESULTS_PER_GROUP),
    findings: matchedFindings.slice(0, MAX_RESULTS_PER_GROUP),
    totalSessions: matchedSessions.length,
    totalDocuments: matchedDocuments.length,
    totalFindings: matchedFindings.length,
  };
}

function SearchBar() {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [open, setOpen] = useState(false);

  const [cache, setCache] = useState<SearchCache | null>(null);
  const [cacheState, setCacheState] = useState<"idle" | "loading" | "error">("idle");

  // Debounce: wait 250ms after the user stops typing before filtering.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), 250);
    return () => clearTimeout(t);
  }, [query]);

  // Lazy-load and cache the searchable data once, on first real interaction
  // (focus), rather than on every mount of this globally-rendered Topbar —
  // it's reused for every keystroke's filtering after that, never refetched
  // mid-session.
  async function ensureCacheLoaded() {
    if (cache || cacheState === "loading") return;
    setCacheState("loading");
    try {
      const [sessions, documents, findingsRes] = await Promise.all([
        listAllResearchSessions(),
        listAllDocuments(),
        getRecentFindings(FINDINGS_SEARCH_POOL),
      ]);
      setCache({ sessions, documents, findings: findingsRes.findings });
      setCacheState("idle");
    } catch {
      setCacheState("error");
    }
  }

  // Global ⌘K / Ctrl+K — focuses the search input from anywhere in the app.
  useEffect(() => {
    function handleKeydown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    }
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, []);

  // Close on outside click.
  useEffect(() => {
    function handlePointerDown(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  function goTo(path: string) {
    setOpen(false);
    setQuery("");
    router.push(path);
  }

  const trimmed = debouncedQuery.trim();
  const results = cache && trimmed ? filterResults(cache, trimmed) : null;
  const hasAnyMatch =
    results !== null &&
    (results.sessions.length > 0 || results.documents.length > 0 || results.findings.length > 0);

  return (
    <div ref={containerRef} className="relative w-full max-w-md">
      <Search className="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-text-muted" />
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => {
          setOpen(true);
          ensureCacheLoaded();
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            setOpen(false);
            inputRef.current?.blur();
          }
        }}
        placeholder="Search workspace..."
        className="w-full rounded-md border border-border bg-surface py-2 pr-14 pl-9 text-sm text-text-primary placeholder:text-text-muted focus:ring-1 focus:ring-text-muted focus:outline-none"
      />
      <kbd className="font-mono-label absolute top-1/2 right-3 -translate-y-1/2 rounded border border-border px-1.5 py-0.5">
        ⌘K
      </kbd>

      {open && trimmed && (
        <div className="absolute top-full left-0 z-20 mt-1.5 w-full rounded-md border border-border bg-surface p-1.5 shadow-lg">
          {cacheState === "loading" && (
            <p className="p-3 text-sm text-text-muted">Loading workspace data…</p>
          )}
          {cacheState === "error" && (
            <p className="p-3 text-sm text-red-400">Couldn&apos;t load search data.</p>
          )}
          {cacheState === "idle" && results && !hasAnyMatch && (
            <p className="p-3 text-sm text-text-muted">
              No results for &quot;{trimmed}&quot;.
            </p>
          )}
          {cacheState === "idle" && results && hasAnyMatch && (
            <div className="flex flex-col gap-1">
              {results.sessions.length > 0 && (
                <ResultGroup
                  label="SESSIONS"
                  total={results.totalSessions}
                  shown={results.sessions.length}
                >
                  {results.sessions.map((s) => (
                    <ResultRow
                      key={s.session_id}
                      icon={<FolderKanban className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                      primary={s.question}
                      secondary={formatCompanyName(s.company_name)}
                      onClick={() => goTo(`/app/projects/${s.session_id}`)}
                    />
                  ))}
                </ResultGroup>
              )}

              {results.documents.length > 0 && (
                <ResultGroup
                  label="DOCUMENTS"
                  total={results.totalDocuments}
                  shown={results.documents.length}
                >
                  {results.documents.map((d) => (
                    <ResultRow
                      key={d.id}
                      icon={<FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                      primary={d.title}
                      secondary={d.publisher ?? undefined}
                      onClick={() => goTo("/app/documents")}
                    />
                  ))}
                </ResultGroup>
              )}

              {results.findings.length > 0 && (
                <ResultGroup
                  label="FINDINGS"
                  total={results.totalFindings}
                  shown={results.findings.length}
                  note="most recent 50 only"
                >
                  {results.findings.map((f) => (
                    <ResultRow
                      key={f.id}
                      icon={<Lightbulb className="h-3.5 w-3.5 shrink-0 text-text-muted" />}
                      primary={f.statement}
                      secondary={`${f.area} · ${formatCompanyName(f.company_name)}`}
                      onClick={() => goTo(`/app/projects/${f.session_id}`)}
                    />
                  ))}
                </ResultGroup>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ResultGroup({
  label,
  total,
  shown,
  note,
  children,
}: {
  label: string;
  total: number;
  shown: number;
  note?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="font-mono-label px-2 pt-1.5 pb-1 text-text-muted">
        {label}
        {total > shown ? ` (${shown} of ${total})` : ""}
        {note ? ` — ${note}` : ""}
      </p>
      <div className="flex flex-col">{children}</div>
    </div>
  );
}

function ResultRow({
  icon,
  primary,
  secondary,
  onClick,
}: {
  icon: React.ReactNode;
  primary: string;
  secondary?: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-border/50"
      )}
    >
      {icon}
      <span className="min-w-0">
        <span className="line-clamp-1 block text-sm text-text-primary">{primary}</span>
        {secondary && (
          <span className="line-clamp-1 block text-xs text-text-muted">{secondary}</span>
        )}
      </span>
    </button>
  );
}

function UserMenu() {
  const router = useRouter();

  function handleLogout() {
    logout();
    router.replace("/login");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Account menu"
        className="ml-2 flex h-8 w-8 items-center justify-center rounded-full bg-border text-xs font-medium text-text-primary outline-none transition-colors hover:bg-border/70"
      >
        AM
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem variant="destructive" onClick={handleLogout}>
          <LogOut className="h-4 w-4" />
          Log out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function Topbar() {
  return (
    <header className="sticky top-0 z-10 flex h-14 shrink-0 items-center gap-4 border-b border-border bg-background/95 px-4 backdrop-blur">
      <span className="text-sm font-bold tracking-wide text-text-primary">ORACLE</span>

      <Separator orientation="vertical" className="h-6 bg-border" />

      <WorkspaceSwitcher />

      <div className="flex flex-1 justify-center">
        <SearchBar />
      </div>

      <div className="flex items-center gap-1">
        <ThemeToggle />
        <IconButton label="Notifications">
          <Bell className="h-4 w-4" />
        </IconButton>
        <IconButton label="Help">
          <HelpCircle className="h-4 w-4" />
        </IconButton>

        <UserMenu />
      </div>
    </header>
  );
}
