from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from database import get_db
from models.company import Company
from models.financial_observation import FinancialObservation

router = APIRouter()

# FinancialObservation rows are session-scoped (session_id FK), but the same
# company can have many research sessions, each independently re-running the
# Finance Engine — finance_engine.py doesn't upsert, so the same (metric,
# period) can end up duplicated across sessions for one company. This
# endpoint is company-scoped (not session-scoped) on purpose, for pages like
# /app/analysis that show one company's metrics regardless of which session
# produced them, deduped the same "most recent row wins" way
# services/recheck.py already dedupes duplicate (metric, period) rows within
# a single session.


@router.get("")
def get_financial_observations(
    company: str = Query(...),
    db: Session = Depends(get_db),
):
    company_row = db.query(Company).filter(Company.name.ilike(company)).first()
    if company_row is None:
        raise HTTPException(status_code=404, detail="company not found")

    rows = (
        db.query(FinancialObservation)
        .filter(FinancialObservation.company_id == company_row.id)
        .all()
    )

    deduped: dict[tuple[str, str], FinancialObservation] = {}
    for row in rows:
        key = (row.metric, row.period)
        existing = deduped.get(key)
        if existing is None or row.created_at > existing.created_at:
            deduped[key] = row

    observations = sorted(deduped.values(), key=lambda r: (r.metric, r.period))

    return {
        "company_name": company_row.name,
        "observations": [
            {
                "metric": o.metric,
                "value": o.value,
                "unit": o.unit,
                "period": o.period,
                "observation_type": o.observation_type,
                # Real provenance ("yfinance" for REPORTED, "calculated" for
                # CALCULATED — see services/finance_engine.py) — not a
                # document/page citation, since these numbers come from the
                # yfinance API, not a parsed filing with a page number.
                "source": o.source,
            }
            for o in observations
        ],
    }
