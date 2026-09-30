import uuid

from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from database import get_db
from models.evidence import Evidence
from models.source import Source

router = APIRouter()


@router.get("")
def get_evidence_by_ids(
    ids: str = Query(..., description="comma-separated Evidence UUIDs"),
    db: Session = Depends(get_db),
):
    id_list = []
    for raw in ids.split(","):
        raw = raw.strip()
        if not raw:
            continue
        try:
            id_list.append(uuid.UUID(raw))
        except ValueError:
            continue

    if not id_list:
        return {"evidence": []}

    rows = (
        db.query(Evidence, Source.title, Source.publisher)
        .join(Source, Evidence.source_id == Source.id)
        .filter(Evidence.id.in_(id_list))
        .all()
    )

    return {
        "evidence": [
            {
                "id": str(ev.id),
                "observation": ev.observation,
                "location": ev.location,
                "confidence": ev.confidence,
                "source_title": source_title,
                "source_publisher": source_publisher,
            }
            for ev, source_title, source_publisher in rows
        ]
    }
