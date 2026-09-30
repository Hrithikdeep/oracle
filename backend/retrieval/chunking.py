import re
import uuid

from sqlalchemy.orm import Session

from models.chunk import DocumentChunk
from models.document import Document

PAGE_MARKER_RE = re.compile(r"\[PAGE (\d+)\]\n")

HEADING_MAX_LEN = 80
SENTENCE_ENDINGS = (".", "!", "?")


def _sliding_windows(text: str, chunk_size: int, overlap: int) -> list[str]:
    if not text:
        return []
    step = max(chunk_size - overlap, 1)
    windows = []
    start = 0
    n = len(text)
    while start < n:
        end = min(start + chunk_size, n)
        windows.append(text[start:end])
        if end == n:
            break
        start += step
    return windows


def _best_effort_heading(chunk_text: str) -> str | None:
    """Heuristic only — NOT reliable. Treats a short first line that doesn't end
    in sentence punctuation as a likely heading. Will misfire on short sentences,
    bullet fragments, or mid-paragraph chunk boundaries. Good enough as a hint
    for downstream display, not something to depend on for correctness.
    """
    stripped = chunk_text.strip()
    if not stripped:
        return None
    first_line = stripped.splitlines()[0].strip()
    if first_line and len(first_line) < HEADING_MAX_LEN and not first_line.endswith(SENTENCE_ENDINGS):
        return first_line
    return None


def chunk_document(text: str, chunk_size: int = 1000, overlap: int = 200) -> list[dict]:
    page_matches = list(PAGE_MARKER_RE.finditer(text))
    chunks: list[dict] = []
    sequence = 0

    if page_matches:
        for i, match in enumerate(page_matches):
            page_number = int(match.group(1))
            content_start = match.end()
            content_end = page_matches[i + 1].start() if i + 1 < len(page_matches) else len(text)
            page_text = text[content_start:content_end]

            for window in _sliding_windows(page_text, chunk_size, overlap):
                if not window.strip():
                    continue
                chunks.append(
                    {
                        "sequence": sequence,
                        "text": window,
                        "heading": _best_effort_heading(window),
                        "page": page_number,
                    }
                )
                sequence += 1
    else:
        for window in _sliding_windows(text, chunk_size, overlap):
            if not window.strip():
                continue
            chunks.append(
                {
                    "sequence": sequence,
                    "text": window,
                    "heading": _best_effort_heading(window),
                    "page": None,
                }
            )
            sequence += 1

    return chunks


def save_chunks(
    document: Document, source_id: uuid.UUID, chunks: list[dict], db: Session
) -> list[DocumentChunk]:
    rows = [
        DocumentChunk(
            document_id=document.id,
            source_id=source_id,
            sequence=chunk["sequence"],
            text=chunk["text"],
            heading=chunk["heading"],
            page=chunk["page"],
        )
        for chunk in chunks
    ]
    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows
