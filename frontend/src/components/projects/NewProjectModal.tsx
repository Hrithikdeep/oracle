"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
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
import { ApiError, createResearch } from "@/lib/api";

// Purely descriptive — there's no `type` field on ResearchSession to persist
// this to, so it's folded into the generated question text instead (see
// buildQuestion() below), not stored anywhere structured.
const PROJECT_TYPES = [
  "Investment Review",
  "Due Diligence",
  "Competitive Analysis",
  "Risk Assessment",
  "Market Research",
];

function buildQuestion(projectType: string, company: string, projectName: string): string {
  return `${projectType} for ${company}: ${projectName}`;
}

interface NewProjectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Shared by the Projects page and the Home page's "+ New Project" button —
// there's no separate empty-project entity, this always kicks off a real
// POST /research call, exactly like Chat's submit, just with a question
// generated from 3 fields instead of free text.
export function NewProjectModal({ open, onOpenChange }: NewProjectModalProps) {
  const router = useRouter();
  const [projectName, setProjectName] = useState("");
  const [company, setCompany] = useState("");
  const [projectType, setProjectType] = useState(PROJECT_TYPES[0]);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setProjectName("");
      setCompany("");
      setProjectType(PROJECT_TYPES[0]);
      setCreateError(null);
    }
  }, [open]);

  function close() {
    if (creating) return; // don't let Cancel/Escape interrupt an in-flight request
    onOpenChange(false);
  }

  async function handleCreateProject() {
    const trimmedName = projectName.trim();
    const trimmedCompany = company.trim();
    if (!trimmedName || !trimmedCompany || creating) return;

    setCreating(true);
    setCreateError(null);

    const question = buildQuestion(projectType, trimmedCompany, trimmedName);

    try {
      const result = await createResearch({ question, company_hint: trimmedCompany });

      if (!result.session_id) {
        setCreateError(result.error ?? "The research session could not be created. Please try again.");
        setCreating(false);
        return;
      }

      router.push(`/app/projects/${result.session_id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setCreateError(`Request failed (HTTP ${err.status}). Please try again.`);
      } else {
        setCreateError("Could not reach the server. Check that the backend is running.");
      }
      setCreating(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            There&apos;s no separate empty-project entity — this kicks off a real research
            session, the same as submitting a question from Chat.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div>
            <p className="font-mono-label mb-1.5">PROJECT NAME</p>
            <Input
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="e.g. Q3 iPhone Revenue Deep Dive"
              disabled={creating}
              autoFocus
            />
          </div>

          <div>
            <p className="font-mono-label mb-1.5">COMPANY</p>
            <Input
              value={company}
              onChange={(e) => setCompany(e.target.value)}
              placeholder="e.g. Apple"
              disabled={creating}
            />
          </div>

          <div>
            <p className="font-mono-label mb-1.5">TYPE</p>
            <Select value={projectType} onValueChange={(v) => v && setProjectType(v)}>
              <SelectTrigger className="w-full" disabled={creating}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PROJECT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {type}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(projectName.trim() || company.trim()) && (
            <p className="text-xs text-text-muted">
              Will research: &quot;{buildQuestion(projectType, company.trim() || "…", projectName.trim() || "…")}
              &quot;
            </p>
          )}

          {createError && <p className="text-sm text-red-400">{createError}</p>}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={creating}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleCreateProject}
            disabled={creating || !projectName.trim() || !company.trim()}
          >
            {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create project"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
