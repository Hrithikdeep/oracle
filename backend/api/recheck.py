import uuid

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from database import get_db
from models.session import ResearchSession
from services.recheck import compute_diff

router = APIRouter()


@router.get("/{session_id}/recheck")
def get_research_recheck(session_id: uuid.UUID, db: Session = Depends(get_db)):
    session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")

    return compute_diff(session_id, db)
