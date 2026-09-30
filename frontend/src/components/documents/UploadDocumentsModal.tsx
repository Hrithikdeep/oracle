"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { useRouter } from "next/navigation";
import { FileText, Loader2, UploadCloud, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ApiError, createResearch } from "@/lib/api";
import { cn } from "@/lib/utils";

interface UploadDocumentsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

// Shared by the Documents page and the Home page's "+ Upload Documents"
// button — there's no standalone "just upload a file" endpoint, every
// upload is still a real POST /research call with a question, same as
// Chat's attach flow. This modal presents that constraint honestly instead
// of pretending a pure-upload flow exists.
export function UploadDocumentsModal({ open, onOpenChange }: UploadDocumentsModalProps) {
  const router = useRouter();
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadQuestion, setUploadQuestion] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setUploadFile(null);
      setUploadQuestion("");
      setUploadError(null);
    }
  }, [open]);

  function close() {
    if (uploading) return; // don't let Cancel/Escape interrupt an in-flight request
    onOpenChange(false);
  }

  function pickFile(file: File | undefined) {
    if (!file) return;
    if (!file.name.toLowerCase().endsWith(".pdf")) {
      setUploadError("Only PDF files are supported.");
      return;
    }
    setUploadError(null);
    setUploadFile(file);
  }

  function handleFileInputChange(e: ChangeEvent<HTMLInputElement>) {
    pickFile(e.target.files?.[0]);
    e.target.value = ""; // allow re-selecting the same file
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    pickFile(e.dataTransfer.files?.[0]);
  }

  async function handleStartUpload() {
    const trimmedQuestion = uploadQuestion.trim();
    if (!uploadFile || !trimmedQuestion || uploading) return;

    setUploading(true);
    setUploadError(null);

    try {
      const result = await createResearch({ question: trimmedQuestion, pdf: uploadFile });

      if (!result.session_id) {
        setUploadError(result.error ?? "The research session could not be created. Please try again.");
        setUploading(false);
        return;
      }

      router.push(`/app/projects/${result.session_id}`);
    } catch (err) {
      if (err instanceof ApiError) {
        setUploadError(`Request failed (HTTP ${err.status}). Please try again.`);
      } else {
        setUploadError("Could not reach the server. Check that the backend is running.");
      }
      setUploading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Upload documents</DialogTitle>
          <DialogDescription>
            Filings, annual reports, research notes and internal documents. Files are indexed
            for retrieval inside this workspace only.
          </DialogDescription>
        </DialogHeader>

        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          onChange={handleFileInputChange}
          className="hidden"
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={cn(
            "flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center transition-colors",
            dragActive ? "border-text-primary bg-border/40" : "border-border hover:border-text-muted/50"
          )}
        >
          <UploadCloud className="h-6 w-6 text-text-muted" />
          <p className="text-sm text-text-primary">Drop a file here or click to browse</p>
          {/* The backend only ever accepts .pdf (POST /research validates the
              extension and retrieve_and_parse_upload() only parses PDFs) —
              this copy states that, not a DOCX/XLSX capability that doesn't exist. */}
          <p className="text-xs text-text-muted">PDF only</p>
        </div>

        {uploadFile && (
          <div className="flex items-center gap-2 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs text-text-primary w-fit">
            <FileText className="h-3.5 w-3.5 shrink-0 text-text-muted" />
            <span className="max-w-50 truncate">{uploadFile.name}</span>
            <button
              type="button"
              onClick={() => setUploadFile(null)}
              aria-label="Remove attached file"
              className="rounded-sm p-0.5 text-text-muted hover:text-text-primary"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        )}

        <div>
          <p className="font-mono-label mb-1.5">WHAT SHOULD WE RESEARCH USING THIS DOCUMENT?</p>
          <textarea
            value={uploadQuestion}
            onChange={(e) => setUploadQuestion(e.target.value)}
            placeholder="e.g. Analyze the risk factors disclosed in this filing"
            rows={2}
            disabled={uploading}
            className="w-full resize-none rounded-md border border-border bg-background p-2 text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
          />
        </div>

        {uploadError && <p className="text-sm text-red-400">{uploadError}</p>}

        <DialogFooter>
          <Button type="button" variant="outline" onClick={close} disabled={uploading}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleStartUpload}
            disabled={uploading || !uploadFile || !uploadQuestion.trim()}
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Start upload"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
