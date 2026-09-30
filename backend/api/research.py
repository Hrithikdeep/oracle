import os
import shutil
import uuid

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy.orm import Session

from database import get_db
from models.company import Company
from models.contradiction import Contradiction
from models.decision_record import DecisionRecord
from models.evidence import Evidence
from models.financial_observation import FinancialObservation
from models.finding import Finding
from models.plan import ResearchPlan
from models.project import Project
from models.report import Report
from models.session import ResearchSession
from models.source import Source
from models.task import ResearchTask
from models.verification import Verification
from workflows.oracle_workflow import run_oracle_workflow

router = APIRouter()

UPLOAD_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)


@router.post("")
async def create_research(
    question: str = Form(...),
    company_hint: str | None = Form(None),
    target_area: str = Form("Financial"),
    project_id: uuid.UUID | None = Form(None),
    pdf: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    if not question.strip():
        raise HTTPException(status_code=400, detail="question is required")

    if project_id is not None:
        project = db.query(Project).filter(Project.id == project_id).first()
        if project is None:
            raise HTTPException(status_code=404, detail="project not found")

    file_path = None
    if pdf is not None and pdf.filename:
        if not pdf.filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail="pdf must be a .pdf file")
        file_path = os.path.join(UPLOAD_DIR, f"{uuid.uuid4()}_{pdf.filename}")
        with open(file_path, "wb") as f:
            shutil.copyfileobj(pdf.file, f)

    final_state = await run_oracle_workflow(
        question=question,
        pdf_path=file_path,
        db=db,
        company_hint=company_hint,
        target_area=target_area,
    )

    if project_id is not None and final_state.session_id:
        db.query(ResearchSession).filter(ResearchSession.id == final_state.session_id).update(
            {"project_id": project_id}
        )
        db.commit()

    return {
        "session_id": str(final_state.session_id) if final_state.session_id else None,
        "status": final_state.status,
        "error": final_state.error,
        "company_name": final_state.company_name,
        "interpreted_objective": final_state.interpreted_objective,
        "plan_areas": (final_state.plan or {}).get("areas", []),
        "evidence_answer": final_state.evidence_answer,
        "project_id": str(project_id) if project_id else None,
    }


@router.get("")
def list_research(
    status: str | None = Query(None),
    company: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # company_id is NOT NULL on ResearchSession, so an inner join never drops a session
    query = db.query(ResearchSession, Company.name).join(
        Company, ResearchSession.company_id == Company.id
    )
    if status:
        query = query.filter(ResearchSession.status == status)
    if company:
        query = query.filter(Company.name.ilike(f"%{company}%"))

    total = query.count()

    rows = (
        query.order_by(ResearchSession.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    session_ids = [session.id for session, _ in rows]
    report_session_ids = (
        {row[0] for row in db.query(Report.session_id).filter(Report.session_id.in_(session_ids)).all()}
        if session_ids
        else set()
    )
    decision_record_session_ids = (
        {
            row[0]
            for row in db.query(DecisionRecord.session_id)
            .filter(DecisionRecord.session_id.in_(session_ids))
            .all()
        }
        if session_ids
        else set()
    )

    return {
        "total": total,
        "sessions": [
            {
                "session_id": str(session.id),
                "question": session.question,
                "status": session.status,
                "company_name": company_name,
                "created_at": session.created_at,
                "started_at": session.started_at,
                "report_ready": session.id in report_session_ids,
                "decision_record_created": session.id in decision_record_session_ids,
            }
            for session, company_name in rows
        ],
    }


@router.get("/{session_id}")
def get_research(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    plan = db.query(ResearchPlan).filter(ResearchPlan.session_id == session_id).first()
    tasks = db.query(ResearchTask).filter(ResearchTask.session_id == session_id).all()
    company = db.query(Company).filter(Company.id == session.company_id).first()
    sources = db.query(Source).filter(Source.session_id == session_id).all()
    financial_observations = (
        db.query(FinancialObservation).filter(FinancialObservation.session_id == session_id).all()
    )

    finding_ids = [f.id for f in db.query(Finding.id).filter(Finding.session_id == session_id).all()]
    verifications = (
        db.query(Verification).filter(Verification.finding_id.in_(finding_ids)).all()
        if finding_ids
        else []
    )
    verification_summary: dict[str, int] = {}
    for v in verifications:
        verification_summary[v.status] = verification_summary.get(v.status, 0) + 1

    contradictions = db.query(Contradiction).filter(Contradiction.session_id == session_id).all()

    report_ready = (
        db.query(Report).filter(Report.session_id == session_id).first() is not None
    )
    decision_record_created = (
        db.query(DecisionRecord).filter(DecisionRecord.session_id == session_id).first() is not None
    )
    project = (
        db.query(Project).filter(Project.id == session.project_id).first()
        if session.project_id
        else None
    )

    return {
        "session_id": str(session.id),
        "question": session.question,
        "status": session.status,
        "company_name": company.name if company else None,
        "created_at": session.created_at,
        "started_at": session.started_at,
        "project_id": str(session.project_id) if session.project_id else None,
        "project_name": project.name if project else None,
        "plan_areas": plan.areas if plan else [],
        "tasks": [{"area": t.area, "objective": t.objective, "status": t.status} for t in tasks],
        "sources": [
            {
                "title": s.title,
                "publisher": s.publisher,
                "source_type": s.source_type,
                "status": s.status,
            }
            for s in sources
        ],
        "financial_observations": [
            {
                "metric": fo.metric,
                "value": fo.value,
                "unit": fo.unit,
                "period": fo.period,
                "observation_type": fo.observation_type,
            }
            for fo in financial_observations
        ],
        "verification_summary": verification_summary,
        "contradictions": [
            {
                "description": c.description,
                "materiality": c.materiality,
                "status": c.status,
            }
            for c in contradictions
        ],
        "report_ready": report_ready,
        "decision_record_created": decision_record_created,
    }


@router.get("/{session_id}/report")
def get_research_report(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    report = (
        db.query(Report)
        .filter(Report.session_id == session_id)
        .order_by(Report.created_at.desc())
        .first()
    )
    if report is None:
        raise HTTPException(status_code=404, detail="no report has been generated for this session yet")

    return {
        "session_id": str(session_id),
        "executive_summary": report.executive_summary,
        "sections": report.sections,
        "recommendation": report.recommendation,
        "limitations": report.limitations,
        "created_at": report.created_at,
    }


@router.get("/{session_id}/findings")
def get_research_findings(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    findings = db.query(Finding).filter(Finding.session_id == session_id).all()

    result = []
    for finding in findings:
        evidence_rows = (
            db.query(Evidence)
            .join(ResearchTask, Evidence.task_id == ResearchTask.id)
            .filter(Evidence.session_id == session_id, ResearchTask.area == finding.area)
            .all()
        )
        result.append(
            {
                "id": str(finding.id),
                "area": finding.area,
                "statement": finding.statement,
                "interpretation": finding.interpretation,
                "materiality": finding.materiality,
                "status": finding.status,
                "created_at": finding.created_at,
                "evidence": [
                    {
                        "observation": ev.observation,
                        "location": ev.location,
                        "confidence": ev.confidence,
                    }
                    for ev in evidence_rows
                ],
            }
        )

    return result
