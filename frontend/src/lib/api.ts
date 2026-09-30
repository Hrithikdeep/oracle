import type {
  CreateResearchResponse,
  DocumentSummary,
  FindingDetail,
  GetEvidenceByIdsResponse,
  ListDocumentsResponse,
  ListFinancialObservationsResponse,
  ListResearchResponse,
  Project,
  RecentFindingsResponse,
  RecentRisksResponse,
  RecheckResult,
  ResearchReport,
  ResearchSessionDetail,
  ResearchSessionSummary,
} from "./types";
import { getToken, handleUnauthorized } from "./auth";
import { API_BASE_URL } from "./config";

// Every router except /auth and /health requires a Bearer token (see
// backend/main.py) — attached here so every call site in this file (and the
// one raw fetch() below that bypasses apiFetch) gets it automatically.
function authHeaders(init?: RequestInit): Headers {
  const headers = new Headers(init?.headers);
  const token = getToken();
  if (token) headers.set("Authorization", `Bearer ${token}`);
  return headers;
}

/** Thrown for any non-2xx response, carrying the HTTP status and parsed body
 * so callers can distinguish "not found" from "server error" etc. */
export class ApiError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(status: number, body: unknown, message?: string) {
    super(message ?? `Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function parseJsonSafe(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    return null;
  }
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE_URL}${path}`, { ...init, headers: authHeaders(init) });
  if (!res.ok) {
    // A dead token (expired, or its user row gone after a DB reset) reaches
    // every call site as a 401 — handle it once here instead of every page
    // rendering its own "Couldn't load this section" for what's really a
    // "you're logged out" state. See handleUnauthorized in lib/auth.ts.
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(res.status, await parseJsonSafe(res));
  }
  return (await res.json()) as T;
}

function detailOf(body: unknown): string | null {
  if (body && typeof body === "object" && "detail" in body) {
    const detail = (body as { detail: unknown }).detail;
    return typeof detail === "string" ? detail : null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// POST /research
// ---------------------------------------------------------------------------

export interface CreateResearchPayload {
  question: string;
  company_hint?: string;
  target_area?: string;
  project_id?: string;
  pdf?: File;
}

export async function createResearch(
  payload: CreateResearchPayload
): Promise<CreateResearchResponse> {
  const formData = new FormData();
  formData.append("question", payload.question);
  if (payload.company_hint) formData.append("company_hint", payload.company_hint);
  if (payload.target_area) formData.append("target_area", payload.target_area);
  if (payload.project_id) formData.append("project_id", payload.project_id);
  if (payload.pdf) formData.append("pdf", payload.pdf);

  // Do NOT set Content-Type manually — fetch sets the correct multipart
  // boundary itself when the body is a FormData instance.
  return apiFetch<CreateResearchResponse>("/research", {
    method: "POST",
    body: formData,
  });
}

// ---------------------------------------------------------------------------
// GET /projects, POST /projects
// ---------------------------------------------------------------------------

export async function getProjects(): Promise<Project[]> {
  return apiFetch<Project[]>("/projects");
}

export async function createProject(name: string): Promise<Project> {
  const formData = new FormData();
  formData.append("name", name);
  return apiFetch<Project>("/projects", { method: "POST", body: formData });
}

// ---------------------------------------------------------------------------
// GET /research  (list)
// ---------------------------------------------------------------------------

export interface ListResearchParams {
  status?: string;
  company?: string;
  limit?: number;
  offset?: number;
}

export async function listResearch(
  params: ListResearchParams = {}
): Promise<ListResearchResponse> {
  const search = new URLSearchParams();
  if (params.status) search.set("status", params.status);
  if (params.company) search.set("company", params.company);
  search.set("limit", String(params.limit ?? 20));
  search.set("offset", String(params.offset ?? 0));
  return apiFetch<ListResearchResponse>(`/research?${search.toString()}`);
}

const MAX_RESEARCH_PAGE_SIZE = 100;

/** Fetches every research session across all pages — GET /research caps
 * `limit` at 100 server-side, so a single call can silently undercount once
 * there are more sessions than that. Used for aggregates (Home page stat
 * cards) that need the true total, not just the first page. */
export async function listAllResearchSessions(): Promise<ResearchSessionSummary[]> {
  const first = await listResearch({ limit: MAX_RESEARCH_PAGE_SIZE, offset: 0 });
  const sessions = [...first.sessions];
  while (sessions.length < first.total) {
    const page = await listResearch({
      limit: MAX_RESEARCH_PAGE_SIZE,
      offset: sessions.length,
    });
    if (page.sessions.length === 0) break; // safety: don't loop forever if total is stale
    sessions.push(...page.sessions);
  }
  return sessions;
}

// ---------------------------------------------------------------------------
// GET /documents  (list)
// ---------------------------------------------------------------------------

export interface ListDocumentsParams {
  type?: string;
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listDocuments(
  params: ListDocumentsParams = {}
): Promise<ListDocumentsResponse> {
  const search = new URLSearchParams();
  if (params.type) search.set("type", params.type);
  if (params.status) search.set("status", params.status);
  search.set("limit", String(params.limit ?? 20));
  search.set("offset", String(params.offset ?? 0));
  return apiFetch<ListDocumentsResponse>(`/documents?${search.toString()}`);
}

const MAX_DOCUMENTS_PAGE_SIZE = 100;

/** Fetches every document across all pages — GET /documents caps `limit` at
 * 100 server-side, and the workspace already has 100+ (confirmed via the
 * Home page's Documents stat card), so a single call would silently
 * undercount. Used for the full /app/documents page's client-side tab
 * filtering. */
export async function listAllDocuments(): Promise<DocumentSummary[]> {
  const first = await listDocuments({ limit: MAX_DOCUMENTS_PAGE_SIZE, offset: 0 });
  const documents = [...first.documents];
  while (documents.length < first.total) {
    const page = await listDocuments({
      limit: MAX_DOCUMENTS_PAGE_SIZE,
      offset: documents.length,
    });
    if (page.documents.length === 0) break; // safety: don't loop forever if total is stale
    documents.push(...page.documents);
  }
  return documents;
}

// ---------------------------------------------------------------------------
// GET /financial-observations
// ---------------------------------------------------------------------------

export async function getFinancialObservations(
  company: string
): Promise<ListFinancialObservationsResponse> {
  return apiFetch<ListFinancialObservationsResponse>(
    `/financial-observations?company=${encodeURIComponent(company)}`
  );
}

// ---------------------------------------------------------------------------
// GET /findings/recent
// ---------------------------------------------------------------------------

export async function getRecentFindings(limit = 10): Promise<RecentFindingsResponse> {
  return apiFetch<RecentFindingsResponse>(`/findings/recent?limit=${limit}`);
}

// ---------------------------------------------------------------------------
// GET /risks/recent
// ---------------------------------------------------------------------------

export async function getRecentRisks(limit = 10): Promise<RecentRisksResponse> {
  return apiFetch<RecentRisksResponse>(`/risks/recent?limit=${limit}`);
}

const MAX_RISKS_PAGE_SIZE = 200;

/** Fetches every tracked risk (not just the Home page widget's "recent 10")
 * for the full /app/risk page — /risks/recent's `limit` caps at 200
 * server-side, which comfortably covers this dev dataset's real risk count. */
export async function getAllRisks(): Promise<RecentRisksResponse> {
  return apiFetch<RecentRisksResponse>(`/risks/recent?limit=${MAX_RISKS_PAGE_SIZE}`);
}

// ---------------------------------------------------------------------------
// GET /evidence?ids=
// ---------------------------------------------------------------------------

export async function getEvidenceByIds(ids: string[]): Promise<GetEvidenceByIdsResponse> {
  return apiFetch<GetEvidenceByIdsResponse>(`/evidence?ids=${ids.map(encodeURIComponent).join(",")}`);
}

// ---------------------------------------------------------------------------
// GET /research/{id}
// ---------------------------------------------------------------------------

export async function getResearchSession(id: string): Promise<ResearchSessionDetail> {
  return apiFetch<ResearchSessionDetail>(`/research/${id}`);
}

// ---------------------------------------------------------------------------
// GET /research/{id}/findings
// ---------------------------------------------------------------------------

export async function getFindings(id: string): Promise<FindingDetail[]> {
  return apiFetch<FindingDetail[]>(`/research/${id}/findings`);
}

// ---------------------------------------------------------------------------
// GET /research/{id}/report
//
// The backend returns two DIFFERENT 404s with distinct `detail` text:
//   - "session not found"                                  -> session doesn't exist at all
//   - "no report has been generated for this session yet"  -> valid session, no Report row yet
// Modeled as a discriminated union instead of throwing on both, so callers
// can render "no report yet" differently from "bad session id".
// ---------------------------------------------------------------------------

export type GetReportResult =
  | { kind: "ok"; data: ResearchReport }
  | { kind: "session_not_found" }
  | { kind: "report_not_ready" };

const SESSION_NOT_FOUND_DETAIL = "session not found";
const REPORT_NOT_READY_DETAIL = "no report has been generated for this session yet";

export async function getReport(id: string): Promise<GetReportResult> {
  const res = await fetch(`${API_BASE_URL}/research/${id}/report`, { headers: authHeaders() });

  if (res.ok) {
    return { kind: "ok", data: (await res.json()) as ResearchReport };
  }

  if (res.status === 401) handleUnauthorized();

  const body = await parseJsonSafe(res);

  if (res.status === 404) {
    const detail = detailOf(body);
    if (detail === SESSION_NOT_FOUND_DETAIL) return { kind: "session_not_found" };
    if (detail === REPORT_NOT_READY_DETAIL) return { kind: "report_not_ready" };
    // Unexpected 404 detail text — don't silently misclassify it as one of
    // the two known cases, surface it as a real error instead.
    throw new ApiError(404, body);
  }

  throw new ApiError(res.status, body);
}

// ---------------------------------------------------------------------------
// GET /research/{id}/recheck
// ---------------------------------------------------------------------------

export async function getRecheck(id: string): Promise<RecheckResult> {
  return apiFetch<RecheckResult>(`/research/${id}/recheck`);
}
