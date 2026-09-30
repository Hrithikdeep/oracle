import uuid

from sqlalchemy import text as sql_text
from sqlalchemy.orm import Session

from retrieval.embeddings import get_embedding

# Convention for this file: HIGHER score = more relevant.
# This is the OPPOSITE of agents/source_intelligence.py's authority_tier,
# where LOWER number = higher authority. Don't mix the two conventions up.

# Task objectives are LLM-written instructions ("Analyze the trends in ... over the
# past three fiscal years"). These words say what to DO, never what a filing
# CONTAINS, and under OR matching they hit nearly every chunk (every MD&A section
# has "analysis" and "year" in it) — so they're dropped from the keyword query.
# Stemmed via the same 'english' config as the index inside the SQL below.
_QUERY_BOILERPLATE_WORDS = (
    "analyze analysis assess evaluate examine investigate identify review conduct "
    "thorough comprehensive detailed focus focusing trend trends past recent recently "
    "last key main major significant overall impact understand determine explore compare"
)

# OR-combined, not AND: plainto_tsquery ANDs every lexeme, so a full-sentence
# objective (12+ terms) essentially never matched a single 1000-char chunk and this
# search returned 0 rows — leaving retrieval vector-only. Here a chunk matches if it
# has ANY content term and ts_rank orders by how many distinct terms it covers.
# (websearch_to_tsquery would not help: unquoted words are still ANDed.) No length
# normalization on purpose — chunks are fixed-size windows, so it would add nothing.
KEYWORD_SEARCH_SQL = sql_text(
    """
    WITH q AS (
        SELECT string_agg(quote_literal(lexeme), ' | ')::tsquery AS tsq
        FROM unnest(tsvector_to_array(to_tsvector('english', :query))) AS lexeme
        WHERE lexeme NOT IN (
            SELECT unnest(tsvector_to_array(to_tsvector('english', :boilerplate)))
        )
    )
    SELECT dc.id, dc.text, dc.page,
           ts_rank(to_tsvector('english', dc.text), q.tsq) AS score
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    JOIN sources s ON d.source_id = s.id
    CROSS JOIN q
    WHERE d.session_id = :session_id
      AND (s.task_id = :task_id OR s.task_id IS NULL)
      AND to_tsvector('english', dc.text) @@ q.tsq
    ORDER BY score DESC, dc.document_id, dc.sequence
    LIMIT :limit
    """
)

VECTOR_SEARCH_SQL = sql_text(
    """
    SELECT dc.id, dc.text, dc.page,
           1 - (dc.embedding <=> (:query_vector)::vector) AS score
    FROM document_chunks dc
    JOIN documents d ON dc.document_id = d.id
    JOIN sources s ON d.source_id = s.id
    WHERE d.session_id = :session_id
      AND (s.task_id = :task_id OR s.task_id IS NULL)
      AND dc.embedding IS NOT NULL
    ORDER BY dc.embedding <=> (:query_vector)::vector
    LIMIT :limit
    """
)


async def keyword_search(
    query: str, session_id: uuid.UUID, task_id: uuid.UUID | None, db: Session, limit: int = 10
) -> list[dict]:
    rows = db.execute(
        KEYWORD_SEARCH_SQL,
        {
            "query": query,
            "boilerplate": _QUERY_BOILERPLATE_WORDS,
            "session_id": session_id,
            "task_id": task_id,
            "limit": limit,
        },
    )
    return [
        {"id": str(row.id), "text": row.text, "page": row.page, "score": float(row.score)}
        for row in rows
    ]


async def vector_search(
    query: str, session_id: uuid.UUID, task_id: uuid.UUID | None, db: Session, limit: int = 10
) -> list[dict]:
    query_vector = await get_embedding(query)
    vector_literal = "[" + ",".join(str(x) for x in query_vector) + "]"

    rows = db.execute(
        VECTOR_SEARCH_SQL,
        {
            "query_vector": vector_literal,
            "session_id": session_id,
            "task_id": task_id,
            "limit": limit,
        },
    )
    return [
        {"id": str(row.id), "text": row.text, "page": row.page, "score": float(row.score)}
        for row in rows
    ]


def reciprocal_rank_fusion(list1: list[dict], list2: list[dict], k: int = 60) -> list[dict]:
    fused: dict[str, dict] = {}

    for result_list in (list1, list2):
        for rank, item in enumerate(result_list):
            chunk_id = item["id"]
            if chunk_id not in fused:
                fused[chunk_id] = {
                    "id": chunk_id,
                    "text": item["text"],
                    "page": item.get("page"),
                    "score": 0.0,
                }
            fused[chunk_id]["score"] += 1.0 / (k + rank + 1)

    return sorted(fused.values(), key=lambda item: item["score"], reverse=True)


async def hybrid_retrieve(
    query: str, session_id: uuid.UUID, task_id: uuid.UUID | None, db: Session, top_k: int = 10
) -> list[dict]:
    # Scoped to sources discovered for THIS task, plus any source with a NULL
    # task_id — that's the deliberate marker for session-wide sources (e.g. a
    # user-uploaded PDF, parsed once and meant to inform every area) rather
    # than an accidental default. See retrieval/parsing.py.
    # RRF only rewards a chunk that BOTH lists rank, which needs candidate depth well
    # beyond top_k: at depth 10 a chunk that is #15 by vector and #8 by keyword is
    # never seen by one of them. (Measured on real Costco filings: nothing reached
    # the fused top-k at depth 10; at 30 it did.)
    pool = max(top_k * 3, 30)
    keyword_results = await keyword_search(query, session_id, task_id, db, limit=pool)
    vector_results = await vector_search(query, session_id, task_id, db, limit=pool)
    fused = reciprocal_rank_fusion(keyword_results, vector_results)
    return fused[:top_k]
