import uuid
from typing import Optional

from pydantic import BaseModel, Field


class OracleState(BaseModel):
    session_id: Optional[uuid.UUID] = None
    question: str
    company_hint: Optional[str] = None
    # Consumed by evidence_agent() (via evidence_node): parsed alongside the
    # auto-discovered sources, not in place of them, into an UPLOAD-type Source.
    pdf_path: Optional[str] = None
    target_area: str = "Financial"
    company_name: Optional[str] = None
    interpreted_objective: Optional[str] = None
    plan: Optional[dict] = None
    tasks: list[dict] = Field(default_factory=list)
    selected_task_id: Optional[uuid.UUID] = None
    financial_observations: list[dict] = Field(default_factory=list)
    evidence_answer: Optional[str] = None
    risks_found: Optional[int] = None
    contradictions_found: Optional[int] = None
    verification_summary: dict = Field(default_factory=dict)
    report_ready: bool = False
    decision_record_created: bool = False
    status: str = "CREATED"
    error: Optional[str] = None
