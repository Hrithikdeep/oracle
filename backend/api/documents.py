from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session, joinedload

from database import get_db
from models.source import Source

router = APIRouter()

# "Documents" here means Source rows, not Document rows: Source is the
# canonical, complete record of everything discovered for a session
# (title, url, publisher, type, and a real processing/indexing `status` —
# DISCOVERED/RETRIEVED/FAILED/UNSUPPORTED). Document is a 1:1 CHILD of
# Source (models/document.py: source_id FK, uselist=False both sides),
# created only in retrieval/parsing.py's retrieve_and_parse() AFTER a
# Source is successfully fetched and parsed — a Source with status FAILED
# or UNSUPPORTED has no Document row at all. Listing Documents alone would
# silently drop every failed/unsupported item, which is the opposite of
# what a "documents" list page needs to show. So this endpoint lists
# Sources, with the joined Document's doc_type/content surfaced per row
# when one exists.


@router.get("")
def list_documents(
    type: str | None = Query(None),
    status: str | None = Query(None),
    limit: int = Query(20, ge=1, le=100),
    offset: int = Query(0, ge=0),
    db: Session = Depends(get_db),
):
    query = db.query(Source).options(joinedload(Source.document))
    if type:
        query = query.filter(Source.source_type == type)
    if status:
        query = query.filter(Source.status == status)

    total = query.count()

    # Source has no created_at column — retrieved_at is the only timestamp,
    # and it's null until a source is actually fetched, so unretrieved/failed
    # sources sort last rather than being ordered arbitrarily.
    sources = (
        query.order_by(Source.retrieved_at.desc().nullslast())
        .offset(offset)
        .limit(limit)
        .all()
    )

    return {
        "total": total,
        "documents": [
            {
                "id": str(s.id),
                "session_id": str(s.session_id),
                "title": s.title,
                "publisher": s.publisher,
                "url": s.url,
                "source_type": s.source_type,
                "status": s.status,
                "retrieved_at": s.retrieved_at,
                "doc_type": s.document.doc_type if s.document else None,
                "has_content": s.document is not None,
            }
            for s in sources
        ],
    }
