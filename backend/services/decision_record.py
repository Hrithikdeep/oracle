import uuid

from sqlalchemy.orm import Session

from models.decision_record import DecisionRecord
from models.financial_observation import FinancialObservation
from models.finding import Finding
from models.report import Report


def gather_current_findings(session_id: uuid.UUID, db: Session) -> list[dict]:
    findings = db.query(Finding).filter(Finding.session_id == session_id).all()
    return [
        {
            "id": str(finding.id),
            "area": finding.area,
            "statement": finding.statement,
            "materiality": finding.materiality,
            "status": finding.status,
            "evidence_ids": finding.evidence_ids,
            "verification": (
                {"status": finding.verification.status, "reasoning": finding.verification.reasoning}
                if finding.verification is not None
                else None
            ),
        }
        for finding in findings
    ]


def gather_current_financial_observations(session_id: uuid.UUID, db: Session) -> list[dict]:
    financial_observations = (
        db.query(FinancialObservation).filter(FinancialObservation.session_id == session_id).all()
    )
    return [
        {
            "metric": fo.metric,
            "value": fo.value,
            "period": fo.period,
            "observation_type": fo.observation_type,
            # needed so compute_diff() can deterministically dedupe same-key rows
            # by recency rather than relying on insertion order
            "created_at": fo.created_at.isoformat(),
        }
        for fo in financial_observations
    ]


def gather_current_report(session_id: uuid.UUID, db: Session) -> dict | None:
    latest_report = (
        db.query(Report)
        .filter(Report.session_id == session_id)
        .order_by(Report.created_at.desc())
        .first()
    )
    if latest_report is None:
        return None
    return {
        "executive_summary": latest_report.executive_summary,
        "recommendation": latest_report.recommendation,
    }


def snapshot_session(session_id: uuid.UUID, db: Session) -> DecisionRecord:
    """Pure data capture — no LLM call. Gathers everything needed for a
    point-in-time snapshot of a session's research state and persists it as a
    new DecisionRecord row. Callable standalone with just a session_id + db."""
    snapshot = {
        "session_id": str(session_id),
        "findings": gather_current_findings(session_id, db),
        "financial_observations": gather_current_financial_observations(session_id, db),
        "report": gather_current_report(session_id, db),
    }

    decision_record = DecisionRecord(session_id=session_id, snapshot=snapshot)
    db.add(decision_record)
    db.commit()
    db.refresh(decision_record)
    return decision_record
