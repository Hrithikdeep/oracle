import os
import re
import uuid

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from agents.source_intelligence import CandidateSource, RankedSource, rank_sources
from models.chunk import DocumentChunk
from models.evidence import Evidence
from models.finding import Finding
from models.task import ResearchTask
from retrieval.chunking import chunk_document, save_chunks
from retrieval.embeddings import embed_chunks
from retrieval.hybrid_retrieval import hybrid_retrieve
from retrieval.parsing import retrieve_and_parse, retrieve_and_parse_upload
from retrieval.search import discover_sources
from retrieval.sec_edgar import get_company_filings
from services.company_ticker import get_company_ticker

MAX_SOURCES = 5
TOP_K_CHUNKS = 10

EXTRACTION_SYSTEM_PROMPT = (
    "You are an evidence extraction assistant. Given a research objective and a set of "
    "retrieved text chunks (each tagged with a chunk_id), extract evidence items relevant "
    "to the objective. Each evidence item must include: a short observation summarizing "
    "what the evidence shows, an exact verbatim quote copied from one chunk's text (do not "
    "paraphrase, alter, or combine text from multiple chunks), the chunk_id of the chunk "
    "the quote came from (must exactly match one of the provided chunk_id values), and a "
    "confidence score between 0 and 1. If nothing in the provided chunks is relevant to "
    "the objective, return an empty evidence_items list. Do not fabricate quotes or "
    "chunk_ids under any circumstances."
)

ANSWER_SYSTEM_PROMPT = (
    "You write a short, direct answer to a research objective based only on the provided "
    "validated evidence. Write 2-4 sentences in plain text. When an evidence item has a "
    "page number, cite it inline like '(p. 1)'; when an evidence item has no page number "
    "(a web/HTML source), state the claim without a page citation. Do not introduce claims "
    "that aren't supported by the evidence provided."
)


class EvidenceItem(BaseModel):
    observation: str
    quote: str
    chunk_id: str
    confidence: float


class EvidenceAgentOutput(BaseModel):
    evidence_items: list[EvidenceItem]
    answer: str


# Quote-mark variants (straight/curly, single/double, backtick) all compare as one character,
# so 'highly competitive' matches "highly competitive" and Costco’s matches Costco's. Quote
# marks are canonicalized rather than deleted, so a quote mark the model added where the
# source has none (or an apostrophe it dropped) still fails.
_QUOTE_MARKS = str.maketrans({c: '"' for c in "'`‘’‚‛“”„‟′″"})
# What may be trimmed from the ends of an extracted quote: whitespace, sentence punctuation,
# quote marks and ellipses ("...", "…"). Only the ENDS — an ellipsis inside a quote marks an
# elision and must keep failing.
_QUOTE_EDGE = r"[\s.,;:!?\"…]*"


def _normalize(text: str) -> str:
    text = text.translate(_QUOTE_MARKS).lower()
    text = re.sub(r"\s+", " ", text)
    # Parsed HTML/10-K tables break lines around symbols ("$222.73 billion\n, from",
    # "$\n5,844", "(\n71\n)"), which whitespace-collapse turns into "billion , from" /
    # "$ 5,844" / "( 71 )"; the model writes "billion, from" / "$5,844" / "(71)". Only the
    # whitespace is dropped — the characters themselves must still match.
    text = re.sub(r"([$(\[€£¥]) ", r"\1", text)
    return re.sub(r" ([.,;:!?)\]%])", r"\1", text).strip()


def _quote_in_chunk(quote: str, chunk_text: str) -> bool:
    """Exact-content provenance check, tolerant only of cosmetic differences.

    Both sides get the same normalization (case, whitespace, quote-mark style, space before
    punctuation); the quote additionally has leading/trailing punctuation, quote marks and
    ellipses trimmed, since a quote cut out of the middle of a sentence ("...including X,
    and Y." from "risks including X, and Y. RESOLVED") legitimately differs only there.
    Everything else must match character-for-character: no fuzzy/similarity matching, so
    substituted, elided or reworded text still fails. The match must also start and end on
    word boundaries, and not inside a number, so neither "grew to 4" nor "grew to 4." can
    pass as a prefix of "grew to 45%" or "grew to 4.1%".
    """
    needle = re.sub(rf"^{_QUOTE_EDGE}|{_QUOTE_EDGE}$", "", _normalize(quote))
    if not needle:
        return False
    pattern = rf"(?<![a-z0-9])(?<!\d[.,]){re.escape(needle)}(?![a-z0-9])(?![.,]\d)"
    return re.search(pattern, _normalize(chunk_text)) is not None


def _ranked_to_candidate(source: RankedSource) -> CandidateSource:
    return CandidateSource(
        url=source.url,
        title=source.title,
        publisher=source.publisher,
        snippet=source.snippet,
        published_date=source.published_date,
    )


async def evidence_agent(
    task_id: uuid.UUID,
    company_name: str,
    session_id: uuid.UUID,
    db: Session,
    pdf_path: str | None = None,
) -> EvidenceAgentOutput:
    task = db.query(ResearchTask).filter(ResearchTask.id == task_id).first()

    # --- discover + merge + re-rank candidates from Tavily and (best-effort) SEC EDGAR ---
    tavily_ranked = await discover_sources(company_name, task.objective)
    tavily_candidates = [_ranked_to_candidate(r) for r in tavily_ranked]

    ticker = get_company_ticker(session_id, db)
    edgar_candidates: list[CandidateSource] = []
    if ticker:
        # get_company_filings never raises — any SEC/network failure is logged
        # inside it and comes back as [], so this degrades to web-only sources.
        edgar_candidates = await get_company_filings(ticker)
        print(
            f"[evidence_agent] Company.ticker={ticker!r} for {company_name!r} -> queried SEC EDGAR, "
            f"found {len(edgar_candidates)} filing(s): "
            + ("; ".join(c.title for c in edgar_candidates) or "none")
        )
    else:
        print(
            f"[evidence_agent] Company.ticker is null for {company_name!r} (the SEC name lookup "
            f"couldn't resolve one) — skipping SEC EDGAR for this run, using web sources only"
        )

    ranked_sources = rank_sources(edgar_candidates + tavily_candidates)
    top_sources = ranked_sources[:MAX_SOURCES]
    print(f"[evidence_agent] {len(ranked_sources)} candidates ranked, taking top {len(top_sources)}")

    # --- retrieve + parse each source; failures are expected and non-fatal ---
    retrieved_documents = []

    if pdf_path:
        # Original filename, not the uuid4()-prefixed name it's saved under on
        # disk (see api/research.py) — uuid4() strings contain no underscores,
        # so splitting on the first "_" cleanly isolates it.
        upload_title = os.path.basename(pdf_path).split("_", 1)[-1]
        upload_document = retrieve_and_parse_upload(pdf_path, upload_title, session_id, db)
        if upload_document is not None:
            retrieved_documents.append(upload_document)
            print(f"[evidence_agent] uploaded PDF {upload_title!r} parsed successfully")
        else:
            print(f"[evidence_agent] uploaded PDF {upload_title!r} FAILED to parse")

    for source in top_sources:
        document = await retrieve_and_parse(source, session_id, task_id, db)
        if document is not None:
            retrieved_documents.append(document)
    print(
        f"[evidence_agent] {len(retrieved_documents)}/{len(top_sources)} "
        f"source(s) retrieved successfully"
    )

    # --- chunk + embed every successfully retrieved document ---
    total_chunks = 0
    reused_documents = 0
    for document in retrieved_documents:
        # A source rediscovered by an earlier task comes back as the SAME
        # already-chunked Document (see retrieve_and_parse). SEC EDGAR hands
        # every task the same 10-K/10-Q, so without this each task would
        # re-chunk and re-embed them, duplicating rows and filling top-k
        # retrieval with identical passages.
        already_chunked = (
            db.query(DocumentChunk.id).filter(DocumentChunk.document_id == document.id).first()
            is not None
        )
        if already_chunked:
            reused_documents += 1
            continue
        chunks = chunk_document(document.raw_text)
        saved_rows = save_chunks(document, document.source_id, chunks, db)
        if saved_rows:
            await embed_chunks(saved_rows, db, batch_size=20)
        total_chunks += len(saved_rows)
    print(
        f"[evidence_agent] {total_chunks} chunk(s) created and embedded across "
        f"{len(retrieved_documents) - reused_documents} new document(s); "
        f"{reused_documents} document(s) reused (already chunked by an earlier task)"
    )

    # --- hybrid retrieval, scoped to this task's own sources (plus any
    # session-wide source, e.g. an uploaded PDF) — not the whole session's
    # pooled documents across every area ---
    top_chunks = await hybrid_retrieve(task.objective, session_id, task_id, db, top_k=TOP_K_CHUNKS)

    chunk_ids = [c["id"] for c in top_chunks]
    chunk_rows = (
        db.query(DocumentChunk).filter(DocumentChunk.id.in_(chunk_ids)).all() if chunk_ids else []
    )
    chunk_lookup = {str(row.id): row for row in chunk_rows}

    context_parts = []
    for i, c in enumerate(top_chunks, start=1):
        chunk_row = chunk_lookup.get(c["id"])
        page_label = f"page {chunk_row.page}" if chunk_row and chunk_row.page is not None else "no page number (web source)"
        context_parts.append(f"[chunk_id={c['id']} | {page_label}]\n{c['text']}")
    context_text = "\n\n".join(context_parts) if context_parts else "(no relevant chunks retrieved)"

    extraction_llm = ChatOpenAI(model="gpt-4o-mini").with_structured_output(EvidenceAgentOutput)
    user_content = f"Research objective: {task.objective}\n\nRetrieved chunks:\n{context_text}"

    raw_output: EvidenceAgentOutput = await extraction_llm.ainvoke(
        [SystemMessage(content=EXTRACTION_SYSTEM_PROMPT), HumanMessage(content=user_content)]
    )

    # Deterministic provenance check: never trust the model's chunk_id/quote claims blindly.
    # Page is NOT something we ask the model to state — it's read from the chunk row we
    # already trust, so it's correct-by-construction rather than model-reported. A page
    # of None (HTML source) is expected and valid, not a validation failure.
    validated: list[tuple[EvidenceItem, DocumentChunk]] = []
    for item in raw_output.evidence_items:
        chunk_row = chunk_lookup.get(item.chunk_id)
        if chunk_row is None:
            print(
                f"[evidence_agent] DROPPED evidence item (chunk_id={item.chunk_id!r}, "
                f"quote={item.quote!r}): chunk_id does not match any retrieved chunk"
            )
            continue
        if not _quote_in_chunk(item.quote, chunk_row.text):
            print(
                f"[evidence_agent] DROPPED evidence item (chunk_id={item.chunk_id!r}, "
                f"quote={item.quote!r}): quote not found verbatim in that chunk's text"
            )
            continue
        validated.append((item, chunk_row))

    if len(validated) == len(raw_output.evidence_items):
        print(f"[evidence_agent] validation: all {len(raw_output.evidence_items)} item(s) passed")
    else:
        print(
            f"[evidence_agent] validation: {len(validated)}/"
            f"{len(raw_output.evidence_items)} item(s) passed"
        )

    for item, chunk_row in validated:
        db.add(
            Evidence(
                session_id=session_id,
                task_id=task_id,
                source_id=chunk_row.source_id,
                observation=item.observation,
                verbatim_quote=item.quote,
                evidence_type="DOCUMENT",
                location=f"Page {chunk_row.page}" if chunk_row.page is not None else "N/A (web source)",
                confidence=item.confidence,
                status="ACCEPTED",
            )
        )
    db.commit()

    if validated:
        evidence_summary = "\n".join(
            f'- ({"p. " + str(chunk_row.page) if chunk_row.page is not None else "web source"}) '
            f'{item.observation}: "{item.quote}"'
            for item, chunk_row in validated
        )
    else:
        evidence_summary = "(no validated evidence available)"

    answer_llm = ChatOpenAI(model="gpt-4o-mini")
    answer_user_content = (
        f"Research objective: {task.objective}\n\nValidated evidence:\n{evidence_summary}"
    )
    answer_response = await answer_llm.ainvoke(
        [SystemMessage(content=ANSWER_SYSTEM_PROMPT), HumanMessage(content=answer_user_content)]
    )
    answer_text = answer_response.content

    db.add(
        Finding(
            session_id=session_id,
            area=task.area,
            statement=answer_text,
            materiality="MEDIUM",
            status="DRAFT",
        )
    )

    task.status = "COMPLETED"
    db.commit()

    return EvidenceAgentOutput(
        evidence_items=[item for item, _ in validated],
        answer=answer_text,
    )
