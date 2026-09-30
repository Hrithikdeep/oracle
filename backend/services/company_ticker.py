import uuid

from sqlalchemy.orm import Session

from models.company import Company
from models.session import ResearchSession


def get_company_ticker(session_id: uuid.UUID, db: Session) -> str | None:
    """The ticker the Orchestrator resolved (SEC name -> ticker lookup) and persisted
    on this session's Company row — the single source of truth for every step that
    needs one (SEC EDGAR filings in evidence_agent, yfinance data in finance_node).
    None when it couldn't resolve one; callers must treat that as "skip", not an
    error."""
    ticker = (
        db.query(Company.ticker)
        .join(ResearchSession, ResearchSession.company_id == Company.id)
        .filter(ResearchSession.id == session_id)
        .scalar()
    )
    if not ticker or not ticker.strip():
        return None
    return ticker.strip().upper()
