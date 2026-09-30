import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from sqlalchemy import or_

from database import SessionLocal
from models.chunk import DocumentChunk
from models.document import Document
from models.source import Source
from retrieval.chunking import chunk_document, save_chunks
from retrieval.embeddings import embed_chunks
from retrieval.hybrid_retrieval import hybrid_retrieve, keyword_search, vector_search


def preview(text: str, n: int = 160) -> str:
    flat = " ".join(text.split())
    return flat[:n] + ("..." if len(flat) > n else "")


async def main():
    db = SessionLocal()
    try:
        docs = (
            db.query(Document)
            .join(Source, Document.source_id == Source.id)
            .filter(or_(Source.url.ilike("%macrumors%"), Source.url.ilike("%sixcolors%")))
            .all()
        )
        print(f"Found {len(docs)} persisted documents to chunk:")
        for d in docs:
            print(f"  id={d.id} doc_type={d.doc_type} raw_text_len={len(d.raw_text)}")

        session_ids = {d.session_id for d in docs}
        assert len(session_ids) == 1, f"expected one session, got {session_ids}"
        session_id = session_ids.pop()
        print(f"session_id: {session_id}\n")

        all_chunks: list[DocumentChunk] = []
        for d in docs:
            chunks = chunk_document(d.raw_text)
            saved = save_chunks(d, d.source_id, chunks, db)
            all_chunks.extend(saved)
            print(f"Document {d.id}: chunk_document() -> {len(chunks)} chunks, saved {len(saved)} rows")

        print(f"\nTotal chunks created: {len(all_chunks)}")

        print("\nEmbedding all chunks...")
        await embed_chunks(all_chunks, db, batch_size=20)

        spot_check = db.query(DocumentChunk).filter(DocumentChunk.id == all_chunks[0].id).first()
        print(
            f"Spot check chunk {spot_check.id}: embedding is "
            f"{'NON-NULL, len=' + str(len(spot_check.embedding)) if spot_check.embedding is not None else 'NULL'}"
        )

        # This script's documents predate per-task Source scoping and have no
        # real ResearchTask to attach to — task_id=None exercises the
        # session-wide path (still a fully valid, real code path: it's the
        # same one uploaded PDFs use), not a stand-in for a missing feature.
        print("\n=== keyword_search('iPhone revenue') ===")
        kw_results = await keyword_search("iPhone revenue", session_id, None, db, limit=5)
        for r in kw_results:
            contains_word = "iphone" in r["text"].lower() or "revenue" in r["text"].lower()
            print(f"  score={r['score']:.4f} page={r['page']} contains_keyword={contains_word}")
            print(f"    text: {preview(r['text'])}")

        print("\n=== vector_search('how is Apple's smartphone business performing') ===")
        vec_results = await vector_search(
            "how is Apple's smartphone business performing", session_id, None, db, limit=5
        )
        for r in vec_results:
            print(f"  score={r['score']:.4f} page={r['page']}")
            print(f"    text: {preview(r['text'])}")

        print("\n=== hybrid_retrieve('Apple iPhone revenue') ===")
        hybrid_results = await hybrid_retrieve("Apple iPhone revenue", session_id, None, db, top_k=5)
        for r in hybrid_results:
            print(f"  fused_score={r['score']:.4f} page={r['page']}")
            print(f"    text: {preview(r['text'])}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
