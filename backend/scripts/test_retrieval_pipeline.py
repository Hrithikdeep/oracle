import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.orchestrator import OrchestratorInput, orchestrator
from database import SessionLocal
from models.document import Document
from models.source import Source
from retrieval.parsing import retrieve_and_parse
from retrieval.search import discover_sources
from retrieval.sec_edgar import get_company_filings

COMPANY_NAME = "Apple"
TICKER = "AAPL"
TASK_OBJECTIVE = "Apple's recent iPhone revenue performance"


async def main():
    db = SessionLocal()
    try:
        _, session_id = await orchestrator(
            OrchestratorInput(raw_question=TASK_OBJECTIVE, company_hint=COMPANY_NAME), db
        )
        print(f"session_id: {session_id}\n")

        print("=== discover_sources(Apple, iPhone revenue objective) ===")
        ranked = await discover_sources(COMPANY_NAME, TASK_OBJECTIVE)
        print(f"{len(ranked)} ranked sources:")
        for r in ranked:
            print(f"  tier={r.authority_tier} type={r.source_type:<18} url={r.url}")
            print(f"    title={r.title!r}")

        print("\n=== get_company_filings(AAPL) ===")
        filings = await get_company_filings(TICKER)
        print(f"{len(filings)} filings:")
        for f in filings:
            print(f"  title={f.title!r}")
            print(f"    url={f.url}")
            print(f"    published_date={f.published_date}")

        top_sources = ranked[:3]
        print(f"\n=== retrieve_and_parse() on top {len(top_sources)} ranked sources ===")
        # This script never runs research_planner(), so there's no real
        # ResearchTask to attach these sources to — task_id=None exercises
        # the session-wide path (same one uploaded PDFs use), not a
        # workaround for a missing feature.
        for r in top_sources:
            doc = await retrieve_and_parse(r, session_id, None, db)
            if doc is None:
                print(f"  FAILED: {r.url}")
            else:
                print(f"  OK: {r.url} -> {len(doc.raw_text)} chars extracted, doc_type={doc.doc_type}")

        sources = db.query(Source).filter(Source.session_id == session_id).all()
        documents = db.query(Document).filter(Document.session_id == session_id).all()

        print("\n=== DB verification ===")
        print(f"Source rows for session: {len(sources)}")
        for s in sources:
            print(f"  id={s.id} status={s.status} url={s.url}")
        print(f"Document rows for session: {len(documents)}")
        for d in documents:
            print(f"  id={d.id} doc_type={d.doc_type} raw_text_len={len(d.raw_text)}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
