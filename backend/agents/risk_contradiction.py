import re
import uuid
from typing import Literal

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.contradiction import Contradiction
from models.evidence import Evidence
from models.financial_observation import FinancialObservation
from models.finding import Finding

# Two reported values for the same (metric, period) that differ by more than this,
# relative to the larger of the two magnitudes, are treated as a contradiction.
# 5% is a reasonable tolerance for rounding/restatement noise while still catching
# genuinely conflicting figures.
FINANCIAL_CONTRADICTION_THRESHOLD_PCT = 5.0

RISK_SYSTEM_PROMPT = (
    "You identify risks for an investment research report on a company, based ONLY on "
    "the evidence and financial data provided below. Every risk you list must be "
    "traceable to something actually stated in the input — do not invent risks unrelated "
    "to the provided evidence/data, and do not add generic boilerplate risks that aren't "
    "grounded in what's given. If there isn't enough information to identify any real "
    "risks, return an empty risks list rather than fabricating one.\n\n"
    "Each risk is grounded in ONE of two kinds of source, never both:\n"
    "- If it's drawn from the 'Evidence collected' bullets, include evidence_summaries: "
    "one or more short quotes or close paraphrases of the specific bullets it's drawn "
    "from, so it can be matched back to its source.\n"
    "- If it's drawn from the 'Financial data collected' lines instead, include "
    "financial_metric_refs: one or more {metric, period} pairs copied EXACTLY (same "
    "spelling/casing) from those lines, so it can be matched back to the real "
    "underlying data.\n"
    "Leave the other field empty for that risk."
)

SEMANTIC_CONTRADICTION_SYSTEM_PROMPT = (
    "You review a set of evidence statements collected during research on a company. "
    "Identify any pairs that GENUINELY CONFLICT — they make disagreeing claims about the "
    "SAME specific fact (e.g. one says revenue grew, another says it declined, for the "
    "same period/metric). Do NOT flag pairs that are just about different topics, or that "
    "are complementary/non-overlapping. For each conflicting pair, summarize each side by "
    "quoting or closely paraphrasing its actual text (so it can be matched back to its "
    "source) and describe the conflict. If no genuine conflicts exist, return "
    "contradictions_found=false and an empty pairs list."
)


class FinancialMetricRef(BaseModel):
    metric: str
    period: str


class RiskItem(BaseModel):
    category: str
    title: str
    description: str
    severity: Literal["HIGH", "MEDIUM", "LOW"]
    # Short quotes/paraphrases of the evidence bullets this risk is drawn from.
    # Never trusted as real ids — deterministically re-matched to real Evidence
    # rows in _persist_risks(), same pattern as check_semantic_contradictions().
    evidence_summaries: list[str] = []
    # (metric, period) pairs for risks drawn from Finance Engine data instead of
    # evidence text. Unlike evidence_summaries, this needs no fuzzy text matching —
    # FinancialObservation has exact metric+period keys — but the model's claimed
    # values are still never trusted blindly: _persist_risks() looks them up
    # against real rows for this session and drops any that don't actually exist.
    financial_metric_refs: list[FinancialMetricRef] = []


class RiskAnalysisOutput(BaseModel):
    risks: list[RiskItem]


class EvidencePairSummary(BaseModel):
    evidence_a_summary: str
    evidence_b_summary: str
    description: str


class SemanticContradictionCheck(BaseModel):
    contradictions_found: bool
    pairs: list[EvidencePairSummary]


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def _financial_contradiction_marker(metric: str, period: str) -> str:
    """Stable substring that uniquely identifies which (metric, period) pair a
    financial-contradiction description is about — used to detect that this pair
    was already flagged, without needing to parse the freeform description back
    into structured fields."""
    return f"{metric} for {period} reported as both"


def _find_contradicting_pair(
    group: list[FinancialObservation],
) -> tuple[FinancialObservation, FinancialObservation] | None:
    for i in range(len(group)):
        for j in range(i + 1, len(group)):
            a, b = group[i], group[j]
            magnitude = max(abs(a.value), abs(b.value))
            if magnitude == 0:
                continue
            relative_diff_pct = abs(a.value - b.value) / magnitude * 100
            if relative_diff_pct > FINANCIAL_CONTRADICTION_THRESHOLD_PCT:
                return a, b
    return None


async def check_financial_contradictions(
    session_id: uuid.UUID, db: Session
) -> list[Contradiction]:
    """Pure deterministic check — no LLM call. Groups FinancialObservation rows by
    (metric, period) and flags pairs whose values differ by more than
    FINANCIAL_CONTRADICTION_THRESHOLD_PCT (relative to the larger magnitude).

    Dedup: an OPEN Contradiction already recorded for a given (metric, period) is
    not re-inserted on a later run — Contradiction stays legitimately one-to-many
    (many distinct real contradictions per session is correct), this only guards
    against re-flagging the exact same (metric, period) pair every time this
    check runs again on an unchanged session.
    """
    observations = (
        db.query(FinancialObservation).filter(FinancialObservation.session_id == session_id).all()
    )

    groups: dict[tuple[str, str], list[FinancialObservation]] = {}
    for obs in observations:
        groups.setdefault((obs.metric, obs.period), []).append(obs)

    existing_open_descriptions = [
        c.description
        for c in db.query(Contradiction)
        .filter(Contradiction.session_id == session_id, Contradiction.status == "OPEN")
        .all()
    ]

    def _already_flagged(metric: str, period: str) -> bool:
        marker = _financial_contradiction_marker(metric, period)
        return any(marker in desc for desc in existing_open_descriptions)

    created: list[Contradiction] = []
    for (metric, period), group in groups.items():
        if len(group) < 2 or _already_flagged(metric, period):
            continue

        pair = _find_contradicting_pair(group)
        if pair is None:
            continue

        a, b = pair
        magnitude = max(abs(a.value), abs(b.value))
        relative_diff_pct = abs(a.value - b.value) / magnitude * 100
        description = (
            f"{metric} for {period} reported as both {a.value} {a.unit} "
            f"(source={a.source!r}) and {b.value} {b.unit} (source={b.source!r}) "
            f"— a {relative_diff_pct:.1f}% relative difference, exceeding the "
            f"{FINANCIAL_CONTRADICTION_THRESHOLD_PCT}% threshold."
        )
        contradiction = Contradiction(
            session_id=session_id,
            finding_id=None,
            evidence_a_id=None,
            evidence_b_id=None,
            description=description,
            materiality="MEDIUM",
            status="OPEN",
        )
        db.add(contradiction)
        created.append(contradiction)
        existing_open_descriptions.append(description)

    db.commit()
    for c in created:
        db.refresh(c)
    return created


async def identify_risks(
    session_id: uuid.UUID, company_name: str, db: Session
) -> RiskAnalysisOutput:
    evidence_rows = db.query(Evidence).filter(Evidence.session_id == session_id).all()
    financial_rows = (
        db.query(FinancialObservation).filter(FinancialObservation.session_id == session_id).all()
    )

    evidence_text = "\n".join(f"- {e.observation}" for e in evidence_rows) or "(no evidence collected)"
    financial_text = "\n".join(
        f"- {f.metric} ({f.period}): {f.value} {f.unit} [{f.observation_type}]"
        for f in financial_rows
    ) or "(no financial data collected)"

    user_content = (
        f"Company: {company_name}\n\nEvidence collected:\n{evidence_text}\n\n"
        f"Financial data collected:\n{financial_text}"
    )

    llm = ChatOpenAI(model="gpt-4o-mini").with_structured_output(RiskAnalysisOutput)
    output: RiskAnalysisOutput = await llm.ainvoke(
        [SystemMessage(content=RISK_SYSTEM_PROMPT), HumanMessage(content=user_content)]
    )
    return output


def _persist_risks(session_id: uuid.UUID, risks: list[RiskItem], db: Session) -> list[Finding]:
    evidence_rows = db.query(Evidence).filter(Evidence.session_id == session_id).all()
    financial_rows = (
        db.query(FinancialObservation).filter(FinancialObservation.session_id == session_id).all()
    )
    financial_by_key = {(fo.metric, fo.period): fo for fo in financial_rows}

    rows = []
    for risk in risks:
        # Never trust the model's own claim of which evidence backs this risk —
        # deterministically re-match its text summaries to real Evidence rows.
        matched_evidence_ids: list[str] = []
        for summary in risk.evidence_summaries:
            match = _best_matching_evidence(summary, evidence_rows)
            if match is not None and str(match.id) not in matched_evidence_ids:
                matched_evidence_ids.append(str(match.id))
            else:
                print(
                    f"[identify_risks] could not match evidence summary to a real "
                    f"Evidence row for risk {risk.title!r}: {summary!r}"
                )

        # Same discipline for financial refs: exact (metric, period) lookup against
        # real rows for this session — never trust the model's claimed values as-is.
        matched_fo_ids: list[str] = []
        for ref in risk.financial_metric_refs:
            fo = financial_by_key.get((ref.metric, ref.period))
            if fo is not None and str(fo.id) not in matched_fo_ids:
                matched_fo_ids.append(str(fo.id))
            else:
                print(
                    f"[identify_risks] could not match financial_metric_ref to a real "
                    f"FinancialObservation row for risk {risk.title!r}: "
                    f"metric={ref.metric!r} period={ref.period!r}"
                )

        rows.append(
            Finding(
                session_id=session_id,
                area="Risks",
                statement=f"{risk.title}: {risk.description}",
                materiality=risk.severity,
                status="DRAFT",
                evidence_ids=matched_evidence_ids,
                financial_observation_ids=matched_fo_ids,
            )
        )

    db.add_all(rows)
    db.commit()
    for row in rows:
        db.refresh(row)
    return rows


def _best_matching_evidence(summary: str, evidence_rows: list[Evidence]) -> Evidence | None:
    normalized_summary = _normalize(summary)

    for e in evidence_rows:
        normalized_obs = _normalize(e.observation)
        if normalized_obs in normalized_summary or normalized_summary in normalized_obs:
            return e

    summary_tokens = set(normalized_summary.split())
    best_match, best_overlap = None, 0
    for e in evidence_rows:
        overlap = len(summary_tokens & set(_normalize(e.observation).split()))
        if overlap > best_overlap:
            best_match, best_overlap = e, overlap
    return best_match if best_overlap > 0 else None


async def check_semantic_contradictions(session_id: uuid.UUID, db: Session) -> list[Contradiction]:
    evidence_rows = db.query(Evidence).filter(Evidence.session_id == session_id).all()
    if len(evidence_rows) < 2:
        return []

    evidence_listing = "\n".join(f"- {e.observation}" for e in evidence_rows)
    user_content = f"Evidence statements:\n{evidence_listing}"

    llm = ChatOpenAI(model="gpt-4o-mini").with_structured_output(SemanticContradictionCheck)
    output: SemanticContradictionCheck = await llm.ainvoke(
        [SystemMessage(content=SEMANTIC_CONTRADICTION_SYSTEM_PROMPT), HumanMessage(content=user_content)]
    )

    if not output.contradictions_found or not output.pairs:
        return []

    # Dedup key: the (evidence_a_id, evidence_b_id) pair, order-independent — NOT
    # the description text. Verified empirically that gpt-4o-mini generates fresh
    # wording for the same underlying conflicting pair on every call (three
    # different description strings observed for the identical evidence pair
    # across three runs in testing), so "same description" as a dedup key is
    # unreliable for LLM-generated prose. The evidence ids are deterministically
    # re-matched below, so they're a stable key even when the prose isn't.
    existing_open_pairs = {
        frozenset((c.evidence_a_id, c.evidence_b_id))
        for c in db.query(Contradiction)
        .filter(Contradiction.session_id == session_id, Contradiction.status == "OPEN")
        .all()
        if c.evidence_a_id is not None and c.evidence_b_id is not None
    }

    created: list[Contradiction] = []
    for pair in output.pairs:
        # Never trust the model's own ids (it wasn't given any) — deterministically
        # re-match its text summaries back to real, distinct Evidence rows.
        evidence_a = _best_matching_evidence(pair.evidence_a_summary, evidence_rows)
        evidence_b = _best_matching_evidence(pair.evidence_b_summary, evidence_rows)

        if evidence_a is None or evidence_b is None or evidence_a.id == evidence_b.id:
            print(
                f"[check_semantic_contradictions] DROPPED pair — could not match both "
                f"summaries to two distinct real Evidence rows "
                f"(a={pair.evidence_a_summary!r}, b={pair.evidence_b_summary!r})"
            )
            continue

        pair_key = frozenset((evidence_a.id, evidence_b.id))
        if pair_key in existing_open_pairs:
            print(
                f"[check_semantic_contradictions] SKIPPED — an OPEN contradiction "
                f"already exists for this exact evidence pair ({evidence_a.id}, "
                f"{evidence_b.id}): {pair.description!r}"
            )
            continue

        contradiction = Contradiction(
            session_id=session_id,
            finding_id=None,
            evidence_a_id=evidence_a.id,
            evidence_b_id=evidence_b.id,
            description=pair.description,
            materiality="MEDIUM",
            status="OPEN",
        )
        db.add(contradiction)
        created.append(contradiction)
        existing_open_pairs.add(pair_key)

    db.commit()
    for c in created:
        db.refresh(c)
    return created


async def run_risk_contradiction_agent(
    session_id: uuid.UUID, company_name: str, db: Session
) -> dict:
    financial_contradictions = await check_financial_contradictions(session_id, db)
    risk_output = await identify_risks(session_id, company_name, db)
    risk_findings = _persist_risks(session_id, risk_output.risks, db)
    semantic_contradictions = await check_semantic_contradictions(session_id, db)

    return {
        "risks_found": len(risk_findings),
        "contradictions_found": len(financial_contradictions) + len(semantic_contradictions),
        "financial_contradictions": len(financial_contradictions),
        "semantic_contradictions": len(semantic_contradictions),
    }
