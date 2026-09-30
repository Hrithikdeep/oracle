// Types mirroring the ACTUAL backend response shapes.
//
// Important: none of the 5 endpoints below use Pydantic response_models —
// every one just returns a plain dict (FastAPI's jsonable_encoder handles
// serialization). These types were written by reading the literal dict
// literals in backend/api/research.py, backend/api/recheck.py, and
// backend/services/recheck.py, cross-checked against the SQLAlchemy models
// in backend/models/ for nullability. Field names/casing match exactly
// (snake_case, as returned — not converted to camelCase anywhere).

// ---------------------------------------------------------------------------
// Shared status string unions (documented in the backend as column comments,
// not enforced by a DB-level enum yet — kept as string unions, not literal
// enums, since the backend itself treats them as plain strings)
// ---------------------------------------------------------------------------

export type SessionStatus =
  | "CREATED"
  | "PLANNING"
  | "RESEARCHING"
  | "ANALYZING"
  | "VERIFYING"
  | "ASSESSING"
  | "SYNTHESIZING"
  | "COMPLETED"
  | "COMPLETED_WITH_LIMITATIONS"
  | "FAILED"
  | "CANCELLED";

export type TaskStatus =
  | "PENDING"
  | "RUNNING"
  | "COMPLETED"
  | "COMPLETED_WITH_LIMITATIONS"
  | "FAILED"
  | "CANCELLED";

export type SourceType = "REGULATORY_FILING" | "EARNINGS_MATERIAL" | "NEWS" | "WEB" | "UPLOAD";
export type SourceStatus = "DISCOVERED" | "RETRIEVED" | "FAILED" | "UNSUPPORTED";
export type FinancialObservationType = "REPORTED" | "CALCULATED";
export type Materiality = "HIGH" | "MEDIUM" | "LOW";
export type VerificationStatus = "SUPPORTED" | "SUPPORTED_WITH_LIMITATIONS" | "CONFLICTING" | "INSUFFICIENT";
export type ContradictionStatus = "OPEN" | "RESOLVED" | "UNRESOLVED";

// ---------------------------------------------------------------------------
// POST /research  (backend/api/research.py: create_research)
// ---------------------------------------------------------------------------

export interface CreateResearchResponse {
  session_id: string | null;
  status: SessionStatus;
  error: string | null;
  company_name: string | null;
  interpreted_objective: string | null;
  plan_areas: string[];
  evidence_answer: string | null;
  project_id: string | null;
}

// ---------------------------------------------------------------------------
// GET /projects, POST /projects  (backend/api/projects.py)
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  created_at: string; // ISO 8601 datetime string
}

// ---------------------------------------------------------------------------
// GET /research  (backend/api/research.py: list_research)
// ---------------------------------------------------------------------------

export interface ResearchSessionSummary {
  session_id: string;
  question: string;
  status: SessionStatus;
  company_name: string | null;
  created_at: string;
  started_at: string | null;
  report_ready: boolean;
  decision_record_created: boolean;
}

export interface ListResearchResponse {
  total: number;
  sessions: ResearchSessionSummary[];
}

// ---------------------------------------------------------------------------
// GET /documents  (backend/api/documents.py: list_documents)
// "documents" here are Source rows, not Document rows — see the endpoint's
// own comment for why (Document is a 1:1 child created only for sources
// that were successfully parsed; Source is the complete set).
// ---------------------------------------------------------------------------

export interface DocumentSummary {
  id: string;
  session_id: string;
  title: string;
  publisher: string | null;
  url: string | null;
  source_type: SourceType;
  status: SourceStatus;
  retrieved_at: string | null;
  doc_type: "PDF" | "HTML" | null;
  has_content: boolean;
}

export interface ListDocumentsResponse {
  total: number;
  documents: DocumentSummary[];
}

// ---------------------------------------------------------------------------
// GET /financial-observations  (backend/api/financial_observations.py)
// Company-scoped (not session-scoped) — deduped server-side by (metric,
// period) across every session that company has, most-recent-row-wins.
// ---------------------------------------------------------------------------

export interface FinancialObservationDetail {
  metric: string;
  value: number;
  unit: string;
  period: string;
  observation_type: FinancialObservationType;
  // Real provenance ("yfinance" for REPORTED, "calculated" for CALCULATED)
  // — NOT a document/page citation; GET /research/{id}'s own
  // financial_observations field does NOT include this (that dict is built
  // separately in api/research.py and never had it), which is why this is
  // its own type rather than reusing FinancialObservationSummary.
  source: string;
}

export interface ListFinancialObservationsResponse {
  company_name: string;
  observations: FinancialObservationDetail[];
}

// ---------------------------------------------------------------------------
// GET /findings/recent  (backend/api/findings.py)
// ---------------------------------------------------------------------------

export interface RecentFinding {
  id: string;
  session_id: string;
  company_name: string | null;
  area: string;
  statement: string;
  materiality: Materiality;
  status: string;
  created_at: string;
}

export interface RecentFindingsResponse {
  findings: RecentFinding[];
}

// ---------------------------------------------------------------------------
// GET /risks/recent  (backend/api/risks.py)
// ---------------------------------------------------------------------------

export interface RecentRisk {
  id: string;
  session_id: string;
  company_name: string | null;
  description: string;
  materiality: Materiality;
  status: ContradictionStatus;
  created_at: string;
  // Contradiction.finding_id is a real nullable column, but as of the
  // current risk_contradiction agent it's ALWAYS hardcoded to None on every
  // insert (confirmed via grep of agents/risk_contradiction.py) — so
  // finding_area is always null in practice today, not just for
  // deterministic financial-data contradictions. Kept in the type/response
  // so the UI picks it up automatically if that ever changes.
  finding_id: string | null;
  finding_area: string | null;
  // Only null for deterministic financial-data contradictions (two
  // conflicting FinancialObservation values, no Evidence rows to cite).
  evidence_a_id: string | null;
  evidence_b_id: string | null;
}

export interface RecentRisksResponse {
  total: number;
  risks: RecentRisk[];
}

// ---------------------------------------------------------------------------
// GET /evidence?ids=  (backend/api/evidence.py)
// ---------------------------------------------------------------------------

export interface EvidenceDetail {
  id: string;
  observation: string;
  location: string;
  confidence: number | null;
  source_title: string;
  source_publisher: string | null;
}

export interface GetEvidenceByIdsResponse {
  evidence: EvidenceDetail[];
}

// ---------------------------------------------------------------------------
// GET /research/{id}  (backend/api/research.py: get_research)
// ---------------------------------------------------------------------------

export interface ResearchTaskSummary {
  area: string;
  objective: string;
  status: TaskStatus;
}

export interface SourceSummary {
  title: string;
  // Source.publisher is nullable=True on the model (null for Phase 1 UPLOAD
  // sources, which have no publisher concept)
  publisher: string | null;
  source_type: SourceType;
  status: SourceStatus;
}

export interface FinancialObservationSummary {
  metric: string;
  value: number;
  unit: string;
  period: string;
  observation_type: FinancialObservationType;
}

// Built in get_research() as {status: count} over this session's Verification
// rows — NOT a fixed set of keys, only whichever statuses actually occurred.
export type VerificationSummary = Partial<Record<VerificationStatus, number>>;

export interface ContradictionSummary {
  description: string;
  materiality: Materiality;
  status: ContradictionStatus;
}

export interface ResearchSessionDetail {
  session_id: string;
  question: string;
  status: SessionStatus;
  company_name: string | null;
  created_at: string; // ISO 8601 datetime string
  started_at: string | null;
  // NOTE: ResearchSession.completed_at exists on the model but is NOT included
  // in this endpoint's response dict — omitted here to match reality, not the
  // model's full field set.
  project_id: string | null;
  project_name: string | null;
  plan_areas: string[];
  tasks: ResearchTaskSummary[];
  sources: SourceSummary[];
  financial_observations: FinancialObservationSummary[];
  verification_summary: VerificationSummary;
  contradictions: ContradictionSummary[];
  // Both computed as `db.query(...).first() is not None` in the actual code —
  // ALWAYS a real boolean, never null. (The task description hypothesized
  // these might be nullable "before evidence-gathering completes" — checked
  // the real code: that's not the case, so these are NOT marked optional.)
  report_ready: boolean;
  decision_record_created: boolean;
}

// ---------------------------------------------------------------------------
// GET /research/{id}/findings  (backend/api/research.py: get_research_findings)
// Returns a bare JSON array, not wrapped in an object.
// ---------------------------------------------------------------------------

export interface FindingEvidenceRef {
  observation: string;
  location: string;
  // Evidence.confidence is Float, nullable=True on the model
  confidence: number | null;
}

export interface FindingDetail {
  id: string;
  area: string;
  statement: string;
  // Finding.interpretation is Text, nullable=True on the model
  interpretation: string | null;
  materiality: Materiality;
  status: string; // model comment only documents "DRAFT, ..." — not a closed set yet
  created_at: string;
  evidence: FindingEvidenceRef[];
}

export type GetFindingsResponse = FindingDetail[];

// ---------------------------------------------------------------------------
// GET /research/{id}/report  (backend/api/research.py: get_research_report)
// ---------------------------------------------------------------------------

export interface ResearchReport {
  session_id: string;
  executive_summary: string;
  // Report.sections keys are whatever ReportSection.area strings the LLM
  // produced (e.g. "Financial", "Risks") — observed as Title Case in real
  // runs, NOT the lowercase "business"/"financial" example in the model's
  // own code comment. Not a fixed/closed set of keys.
  sections: Record<string, string>;
  // Report.recommendation is String, nullable=True on the model
  recommendation: string | null;
  limitations: string[];
  created_at: string;
}

// ---------------------------------------------------------------------------
// GET /research/{id}/recheck  (backend/api/recheck.py + services/recheck.py: compute_diff)
// ---------------------------------------------------------------------------

export interface RecheckNewFinding {
  id: string;
  area: string;
  statement: string;
  status: VerificationStatus | null;
}

export interface RecheckChangedFinding {
  id: string;
  area: string;
  old_status: VerificationStatus | null;
  new_status: VerificationStatus | null;
}

export interface RecheckNewFinancialObservation {
  metric: string;
  period: string;
  value: number;
}

export interface RecheckChangedFinancialObservation {
  metric: string;
  period: string;
  old_value: number;
  new_value: number;
}

export interface RecheckResult {
  has_decision_record: boolean;
  // Only null via _empty_diff() when has_decision_record is false
  snapshot_taken_at: string | null;
  new_findings: RecheckNewFinding[];
  changed_findings: RecheckChangedFinding[];
  new_financial_observations: RecheckNewFinancialObservation[];
  changed_financial_observations: RecheckChangedFinancialObservation[];
  recommendation_changed: boolean;
  summary: string;
}
