from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.company import Company
from models.finding import Finding
from models.session import ResearchSession

router = APIRouter()


@router.get("/recent")
def get_recent_findings(
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    rows = (
        db.query(Finding, Company.name)
        .join(ResearchSession, Finding.session_id == ResearchSession.id)
        .join(Company, ResearchSession.company_id == Company.id)
        .order_by(Finding.created_at.desc())
        .limit(limit)
        .all()
    )

    return {
        "findings": [
            {
                "id": str(finding.id),
                "session_id": str(finding.session_id),
                "company_name": company_name,
                "area": finding.area,
                "statement": finding.statement,
                "materiality": finding.materiality,
                "status": finding.status,
                "created_at": finding.created_at,
            }
            for finding, company_name in rows
        ]
    }
