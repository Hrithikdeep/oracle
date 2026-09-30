from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.company import Company
from models.contradiction import Contradiction
from models.finding import Finding
from models.session import ResearchSession

router = APIRouter()


@router.get("/recent")
def get_recent_risks(
    limit: int = Query(10, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    # outerjoin: Contradiction.finding_id is nullable (deterministic
    # financial-data conflicts have no Finding at all) — an inner join would
    # silently drop those rows instead of returning finding_area=None for them.
    query = (
        db.query(Contradiction, Company.name, Finding.area)
        .join(ResearchSession, Contradiction.session_id == ResearchSession.id)
        .join(Company, ResearchSession.company_id == Company.id)
        .outerjoin(Finding, Contradiction.finding_id == Finding.id)
    )

    total = query.count()

    rows = (
        query.order_by(Contradiction.created_at.desc())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "risks": [
            {
                "id": str(c.id),
                "session_id": str(c.session_id),
                "company_name": company_name,
                "description": c.description,
                "materiality": c.materiality,
                "status": c.status,
                "created_at": c.created_at,
                "finding_id": str(c.finding_id) if c.finding_id else None,
                "finding_area": finding_area,
                "evidence_a_id": str(c.evidence_a_id) if c.evidence_a_id else None,
                "evidence_b_id": str(c.evidence_b_id) if c.evidence_b_id else None,
            }
            for c, company_name, finding_area in rows
        ],
    }
