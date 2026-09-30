import io
import re
import uuid
from datetime import datetime, timezone

import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
from sqlalchemy.orm import Session

from agents.source_intelligence import RankedSource, normalize_url
from models.document import Document
from models.source import Source

STRIP_TAGS = ["script", "style", "nav", "header", "footer"]
FETCH_TIMEOUT_SECONDS = 15.0


def parse_html(html: str) -> str:
    soup = BeautifulSoup(html, "html.parser")

    for tag_name in STRIP_TAGS:
        for tag in soup.find_all(tag_name):
            tag.decompose()

    raw_text = soup.get_text(separator="\n")

    lines = [line.strip() for line in raw_text.splitlines()]
    non_empty_lines = [line for line in lines if line]
    collapsed = "\n".join(non_empty_lines)
    return re.sub(r"[ \t]+", " ", collapsed).strip()


def parse_pdf_pages(pdf_bytes: bytes) -> dict[int, str]:
    reader = PdfReader(io.BytesIO(pdf_bytes))
    return {i: (page.extract_text() or "") for i, page in enumerate(reader.pages, start=1)}


def format_paginated_text(page_texts: dict[int, str]) -> str:
    return "\n\n".join(f"[PAGE {i}]\n{page_texts[i]}" for i in sorted(page_texts))


def parse_pdf(pdf_bytes: bytes) -> str:
    return format_paginated_text(parse_pdf_pages(pdf_bytes))


async def retrieve_and_parse(
    source: RankedSource, session_id: uuid.UUID, task_id: uuid.UUID | None, db: Session
) -> Document | None:
    """Download `source.url`, parse it, and persist Source + Document rows.

    `session_id` is the ResearchSession this source belongs to (the `db` argument
    is the SQLAlchemy session — kept as a separate name to avoid confusion with
    the research-domain "session" the spec refers to). `task_id` is the
    ResearchTask (area) this source was discovered for — hybrid_retrieve()
    uses it to keep each area's retrieval scoped to its own sources instead
    of the whole session's pooled documents.

    Never raises: any failure is logged, the Source row (if created) is marked
    FAILED/UNSUPPORTED, and None is returned so the caller can keep going with
    other sources.
    """
    try:
        normalized = normalize_url(source.url)

        existing = (
            db.query(Source)
            .filter(Source.session_id == session_id, Source.url == normalized)
            .first()
        )
        if existing is not None:
            # A different task independently re-discovered the same URL as
            # relevant to ITS objective too — that's real signal this source
            # serves more than one area, so promote it to session-wide
            # (task_id=None) rather than leaving it locked to whichever task
            # happened to discover it first, which would make it invisible
            # to this task's own hybrid_retrieve() scoping.
            if existing.task_id is not None and existing.task_id != task_id:
                existing.task_id = None
                db.commit()
            return db.query(Document).filter(Document.source_id == existing.id).first()

        source_row = Source(
            session_id=session_id,
            task_id=task_id,
            title=source.title,
            publisher=source.publisher,
            source_type=source.source_type,
            status="DISCOVERED",
            url=normalized,
        )
        db.add(source_row)
        db.commit()
        db.refresh(source_row)

        try:
            async with httpx.AsyncClient(
                timeout=FETCH_TIMEOUT_SECONDS, follow_redirects=True
            ) as client:
                response = await client.get(
                    source.url, headers={"User-Agent": "Oracle Research Project research@example.com"}
                )
                response.raise_for_status()
        except Exception as exc:
            print(f"[retrieve_and_parse] FAILED to fetch {source.url}: {exc}")
            source_row.status = "FAILED"
            db.commit()
            return None

        content_type = response.headers.get("content-type", "").lower()

        try:
            if "pdf" in content_type or source.url.lower().endswith(".pdf"):
                text = parse_pdf(response.content)
                doc_type = "PDF"
            elif "html" in content_type or "text" in content_type:
                text = parse_html(response.text)
                doc_type = "HTML"
            else:
                print(
                    f"[retrieve_and_parse] UNSUPPORTED content-type "
                    f"{content_type!r} for {source.url}"
                )
                source_row.status = "UNSUPPORTED"
                db.commit()
                return None
        except Exception as exc:
            print(f"[retrieve_and_parse] FAILED to parse {source.url}: {exc}")
            source_row.status = "FAILED"
            db.commit()
            return None

        if not text.strip():
            print(f"[retrieve_and_parse] FAILED: no extractable text from {source.url}")
            source_row.status = "FAILED"
            db.commit()
            return None

        source_row.status = "RETRIEVED"
        source_row.retrieved_at = datetime.now(timezone.utc)
        db.commit()

        document = Document(
            source_id=source_row.id,
            session_id=session_id,
            doc_type=doc_type,
            raw_text=text,
            title=source.title,
            parsing_status="PARSED",
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        return document
    except Exception as exc:
        print(f"[retrieve_and_parse] UNEXPECTED FAILURE for {source.url}: {exc}")
        return None


def retrieve_and_parse_upload(
    file_path: str, title: str, session_id: uuid.UUID, db: Session
) -> Document | None:
    """Same contract and Source/Document persistence as retrieve_and_parse(),
    but for a PDF that's already saved to local disk (a user upload from the
    Chat page) instead of one fetched over HTTP.

    The "retrieve" step is a local file read rather than an httpx GET, and
    there's no content-type sniffing since only .pdf uploads reach this
    function (enforced by the API layer) — everything past that point
    (PDF text extraction, Source/Document persistence, failure handling)
    reuses the exact same parse_pdf() used by retrieve_and_parse(), so the
    two paths stay identical from "bytes in hand" onward.

    Never raises: any failure is logged, the Source row is marked FAILED,
    and None is returned so the caller can continue without this document.
    """
    try:
        # task_id is deliberately left None (not per-task) — a user-uploaded
        # PDF is attached once at session creation, not per-area, and is
        # equally relevant to all 5 areas (Business, Financial, Risks, ...).
        # hybrid_retrieve() treats a NULL task_id as "visible to every task
        # in this session" for exactly this reason.
        source_row = Source(
            session_id=session_id,
            task_id=None,
            title=title,
            publisher=None,
            source_type="UPLOAD",
            status="DISCOVERED",
            url=None,
        )
        db.add(source_row)
        db.commit()
        db.refresh(source_row)

        try:
            with open(file_path, "rb") as f:
                pdf_bytes = f.read()
            text = parse_pdf(pdf_bytes)
        except Exception as exc:
            print(f"[retrieve_and_parse_upload] FAILED to parse {file_path}: {exc}")
            source_row.status = "FAILED"
            db.commit()
            return None

        if not text.strip():
            print(f"[retrieve_and_parse_upload] FAILED: no extractable text from {file_path}")
            source_row.status = "FAILED"
            db.commit()
            return None

        source_row.status = "RETRIEVED"
        source_row.retrieved_at = datetime.now(timezone.utc)
        db.commit()

        document = Document(
            source_id=source_row.id,
            session_id=session_id,
            doc_type="PDF",
            raw_text=text,
            title=title,
            parsing_status="PARSED",
        )
        db.add(document)
        db.commit()
        db.refresh(document)

        return document
    except Exception as exc:
        print(f"[retrieve_and_parse_upload] UNEXPECTED FAILURE for {file_path}: {exc}")
        return None
