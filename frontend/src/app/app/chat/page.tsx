"use client";

import { Suspense, useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { ArrowUp, FileText, FolderPlus, Loader2, Paperclip, X } from "lucide-react";
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
import { ApiError, createProject, createResearch, getProjects } from "@/lib/api";
import type { Project } from "@/lib/types";

const PROMPT_TILES = [
  "Analyze Microsoft's latest annual report",
  "Compare Apple and Microsoft",
  "Identify the key financial risks",
  "Prepare an investment memo",
];

const ALL_PROJECTS_VALUE = "all-projects";
const NEW_PROJECT_VALUE = "__new_project__";

export default function ChatPage() {
  return (
    <Suspense fallback={null}>
      <ChatPageInner />
    </Suspense>
  );
}

function ChatPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  // ?q= pre-fills the question — used by Monitoring's "Add monitor" flow to
  // hand off to a real question here instead of faking an instant "added"
  // confirmation for a company with no existing data.
  const [question, setQuestion] = useState(() => searchParams.get("q") ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(ALL_PROJECTS_VALUE);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachedFile, setAttachedFile] = useState<File | null>(null);

  const [newProjectOpen, setNewProjectOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [creatingProject, setCreatingProject] = useState(false);
  const [projectError, setProjectError] = useState<string | null>(null);

  useEffect(() => {
    getProjects()
      .then(setProjects)
      .catch(() => {
        // Non-fatal: the dropdown just falls back to "All projects" only.
      });
  }, []);

  function handleSelectChange(value: string | null) {
    if (value === NEW_PROJECT_VALUE) {
      setProjectError(null);
      setNewProjectName("");
      setNewProjectOpen(true);
      return;
    }
    setSelectedProjectId(value ?? ALL_PROJECTS_VALUE);
  }

  async function handleCreateProject() {
    const trimmed = newProjectName.trim();
    if (!trimmed || creatingProject) return;

    setCreatingProject(true);
    setProjectError(null);

    try {
      const project = await createProject(trimmed);
      setProjects((prev) => [project, ...prev]);
      setSelectedProjectId(project.id);
      setNewProjectOpen(false);
    } catch (err) {
      if (err instanceof ApiError) {
        setProjectError(`Request failed (HTTP ${err.status}). Please try again.`);
      } else {
        setProjectError("Could not reach the server. Check that the backend is running.");
      }
    } finally {
      setCreatingProject(false);
    }
  }

  function handleFileChange(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) setAttachedFile(file);
    // reset so selecting the same file again still fires onChange
    e.target.value = "";
  }

  function handleRemoveFile() {
    setAttachedFile(null);
  }

  async function handleSubmit() {
    const trimmed = question.trim();
    if (!trimmed || submitting) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await createResearch({
        question: trimmed,
        project_id: selectedProjectId === ALL_PROJECTS_VALUE ? undefined : selectedProjectId,
        pdf: attachedFile ?? undefined,
      });

      if (!result.session_id) {
        setError(result.error ?? "The research session could not be created. Please try again.");
        setSubmitting(false);
        return;
      }

      setAttachedFile(null);
      router.push(`/app/projects/${result.session_id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(`Request failed (HTTP ${err.status}). Please try again.`);
      } else {
        setError("Could not reach the server. Check that the backend is running.");
      }
      setSubmitting(false);
    }
  }

  return (
    // Topbar is h-14 (3.5rem) — fill exactly what's left below it so the two
    // groups below distribute over the real available height, not just the
    // content's own height.
    <div className="flex min-h-[calc(100vh-3.5rem)] flex-col px-6 py-10">
      {/* Hero + tiles: centered within the space ABOVE the input bar, not the
          whole page — this group grows to fill the remaining space and
          centers its own content inside that space. */}
      <div className="flex flex-1 flex-col items-center justify-center gap-8">
        <div className="max-w-2xl text-center">
          <p className="font-mono-label">PRIVATE INTELLIGENCE</p>
          <h1 className="mt-4 text-4xl font-semibold text-text-primary">Ask. Analyze. Decide.</h1>
          <p className="mt-3 text-base text-text-muted">
            Research your documents and financial data with evidence you can inspect.
          </p>
        </div>

        <div className="grid w-full max-w-2xl grid-cols-2 gap-3">
          {PROMPT_TILES.map((tile) => (
            <button
              key={tile}
              type="button"
              onClick={() => setQuestion(tile)}
              className="rounded-lg border border-border bg-surface p-4 text-left text-sm text-text-primary transition-colors hover:border-text-muted/40 hover:bg-border/60"
            >
              {tile}
            </button>
          ))}
        </div>
      </div>

      {/* Input + footer: pinned near the bottom of the content area, a small
          fixed gap apart, regardless of viewport height. */}
      <div className="flex w-full flex-col items-center gap-3">
        <div className="w-full max-w-2xl">
          <div className="rounded-xl border border-border bg-surface p-4">
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about your documents, companies, financial data, or risks..."
              rows={2}
              disabled={submitting}
              className="w-full resize-none bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />

            {attachedFile && (
              <div className="mb-3 flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary w-fit">
                <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                <span className="max-w-50 truncate">{attachedFile.name}</span>
                <button
                  type="button"
                  onClick={handleRemoveFile}
                  aria-label="Remove attached file"
                  className="rounded-sm p-0.5 text-text-muted hover:text-text-primary"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            )}

            <div className="mt-3 flex items-center justify-between">
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                onChange={handleFileChange}
                className="hidden"
              />
              <button
                type="button"
                aria-label="Attach a PDF"
                onClick={() => fileInputRef.current?.click()}
                disabled={submitting}
                className="rounded-md p-2 text-text-muted transition-colors hover:text-text-primary disabled:opacity-50"
              >
                <Paperclip className="h-4 w-4" />
              </button>

              <div className="flex items-center gap-3">
                {/* `items` is required so SelectValue can resolve a label for
                    a value selected programmatically (e.g. right after
                    creating a project) — Base UI's SelectValue only reads
                    rendered SelectItem children while the popup is mounted,
                    it does not keep its own registry across renders. */}
                <Select
                  items={{
                    [ALL_PROJECTS_VALUE]: "All projects",
                    ...Object.fromEntries(projects.map((p) => [p.id, p.name])),
                  }}
                  value={selectedProjectId}
                  onValueChange={handleSelectChange}
                >
                  <SelectTrigger className="w-[150px] border-none bg-transparent text-xs" size="sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={ALL_PROJECTS_VALUE}>All projects</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>
                        {project.name}
                      </SelectItem>
                    ))}
                    <SelectItem value={NEW_PROJECT_VALUE}>
                      <FolderPlus className="h-3.5 w-3.5" />
                      New project
                    </SelectItem>
                  </SelectContent>
                </Select>

                <Button
                  type="button"
                  size="icon-lg"
                  className="rounded-full"
                  disabled={submitting || !question.trim()}
                  onClick={handleSubmit}
                  aria-label="Submit question"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowUp className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </div>
          </div>

          {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
        </div>

        <p className="font-mono-label text-center">
          VERIFY IMPORTANT FINANCIAL DECISIONS AGAINST PRIMARY SOURCES
        </p>
      </div>

      <Dialog open={newProjectOpen} onOpenChange={setNewProjectOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>
              Give this project a name to scope research sessions under it.
            </DialogDescription>
          </DialogHeader>

          <Input
            autoFocus
            value={newProjectName}
            onChange={(e) => setNewProjectName(e.target.value)}
            placeholder="e.g. Tech Sector Research"
            disabled={creatingProject}
            onKeyDown={(e: KeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleCreateProject();
              }
            }}
          />
          {projectError && <p className="text-sm text-red-400">{projectError}</p>}

          <DialogFooter>
            <Button
              type="button"
              onClick={handleCreateProject}
              disabled={!newProjectName.trim() || creatingProject}
            >
              {creatingProject ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create project"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
