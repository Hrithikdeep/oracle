import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy import or_
from sqlalchemy.orm import Session

from models.contradiction import Contradiction
from models.evidence import Evidence
from models.financial_observation import FinancialObservation
from models.finding import Finding
from models.task import ResearchTask
from models.verification import Verification

CHALLENGE_SYSTEM_PROMPT = (
    "You are a skeptical fact-checker reviewing a research finding against its supporting "
    "evidence. Your job is to challenge the finding, not rubber-stamp it. Read the finding "
    "statement and the evidence texts provided. Determine: does the evidence actually "
    "support this finding, or is the finding overstated, unsupported, or contradicted by "
    "the evidence? If a known contradiction is noted below, factor it into your verdict. "
    "Be skeptical by default — only mark SUPPORTED if the evidence clearly and directly "
    "backs the finding's claim. Evidence items may include a 'Verbatim source quote': that "
    "text has been mechanically confirmed to appear in the source document, so treat it as "
    "the authoritative evidence and the accompanying summary only as a description of it. "
    "Give your reasoning in 2-3 concise sentences, not a chain-of-thought dump."
)


class VerificationChallenge(BaseModel):
    semantic_verdict: Literal["SUPPORTED", "SUPPORTED_WITH_LIMITATIONS", "CONFLICTING", "INSUFFICIENT"]
    reasoning: str
    contradicts_evidence: bool


def _evidence_for_finding(finding: Finding, db: Session) -> list[Evidence]:
    # Prefer the finding's own explicit evidence_ids (set for findings synthesized
    # from evidence gathered under a different task/area, e.g. Risk findings) —
    # only fall back to the session+area join for area-native findings, where
    # evidence_ids is empty. Purely additive: this changes nothing for findings
    # that never populate evidence_ids.
    if finding.evidence_ids:
        ids = [uuid.UUID(i) if isinstance(i, str) else i for i in finding.evidence_ids]
        return db.query(Evidence).filter(Evidence.id.in_(ids)).all()

    return (
        db.query(Evidence)
        .join(ResearchTask, Evidence.task_id == ResearchTask.id)
        .filter(Evidence.session_id == finding.session_id, ResearchTask.area == finding.area)
        .all()
    )


def _evidence_text(evidence: Evidence) -> str:
    # The paraphrased observation alone is lossy (it can drop the very figures a finding
    # cites), so show the verifier the source-verified quote whenever one was stored.
    # Rows created before verbatim_quote existed have NULL here: fall back to the
    # observation, exactly what the verifier used to see.
    if evidence.verbatim_quote:
        return f'{evidence.observation}\n  Verbatim source quote: "{evidence.verbatim_quote}"'
    return evidence.observation


def _find_related_contradiction(
    finding: Finding, evidence_ids: set[uuid.UUID], db: Session
) -> Optional[Contradiction]:
    filters = [Contradiction.finding_id == finding.id]
    if evidence_ids:
        filters.append(Contradiction.evidence_a_id.in_(evidence_ids))
        filters.append(Contradiction.evidence_b_id.in_(evidence_ids))
    return (
        db.query(Contradiction)
        .filter(Contradiction.session_id == finding.session_id, or_(*filters))
        .first()
    )


def _financial_observations_for_finding(finding: Finding, db: Session) -> list[FinancialObservation]:
    if not finding.financial_observation_ids:
        return []
    ids = [uuid.UUID(i) if isinstance(i, str) else i for i in finding.financial_observation_ids]
    return db.query(FinancialObservation).filter(FinancialObservation.id.in_(ids)).all()


def deterministic_checks(finding: Finding, db: Session) -> dict:
    evidence_rows = _evidence_for_finding(finding, db)
    evidence_ids = {e.id for e in evidence_rows}
    source_count = len({e.source_id for e in evidence_rows})

    # financially_grounded is a DIFFERENT kind of "well-sourced" than source_count,
    # not a substitute number for it. source_count answers "how many independent
    # human-authored sources corroborate this?" — a meaningful question for
    # LLM-extracted evidence text, where any single source could misreport or be
    # cherry-picked. It's the WRONG question for a finding grounded purely in
    # Finance Engine output: that data is real math (finance_engine.py) on real
    # fetched numbers, not interpretation, so "how many sources" doesn't apply —
    # what matters is whether the finding's claim actually matches the numbers,
    # which is exactly what the LLM challenge checks when given that data as
    # context (see llm_challenge). Only used when evidence_ids is empty — a
    # finding with real evidence backing goes through the normal source_count path.
    financially_grounded = False
    if not finding.evidence_ids and finding.financial_observation_ids:
        financially_grounded = len(_financial_observations_for_finding(finding, db)) > 0

    contradiction = _find_related_contradiction(finding, evidence_ids, db)
    has_contradiction = contradiction is not None

    evidence_exists = source_count > 0 or financially_grounded
    hard_fail = not evidence_exists

    return {
        "source_count": source_count,
        "has_contradiction": has_contradiction,
        "evidence_exists": evidence_exists,
        "hard_fail": hard_fail,
        "financially_grounded": financially_grounded,
    }


async def llm_challenge(
    finding: Finding,
    evidence_texts: list[str],
    contradiction_context: str | None,
    db: Session,
    financial_observations: list[FinancialObservation] | None = None,
) -> VerificationChallenge:
    if financial_observations:
        context_label = (
            "Supporting financial data (from Finance Engine — deterministic calculations "
            "on real reported figures, not LLM-extracted text)"
        )
        context_block = "\n".join(
            f"- {fo.metric} ({fo.period}): {fo.value} {fo.unit} [{fo.observation_type}]"
            for fo in financial_observations
        )
    else:
        context_label = "Supporting evidence"
        context_block = (
            "\n".join(f"- {text}" for text in evidence_texts) if evidence_texts else "(no evidence text available)"
        )

    contradiction_block = (
        f"\n\nKnown contradiction: {contradiction_context}" if contradiction_context else ""
    )

    user_content = (
        f"Finding statement: {finding.statement}\n\n{context_label}:\n{context_block}"
        f"{contradiction_block}"
    )

    llm = ChatOpenAI(model="gpt-4o").with_structured_output(VerificationChallenge)
    output: VerificationChallenge = await llm.ainvoke(
        [SystemMessage(content=CHALLENGE_SYSTEM_PROMPT), HumanMessage(content=user_content)]
    )
    return output


def combine_verdict(det: dict, challenge: VerificationChallenge) -> str:
    if det["hard_fail"]:
        return "INSUFFICIENT"
    if det["has_contradiction"] or challenge.contradicts_evidence:
        return "CONFLICTING"
    if det["source_count"] >= 2 and challenge.semantic_verdict == "SUPPORTED":
        return "SUPPORTED"
    # financially_grounded satisfies the "well-sourced" bar on its own terms — it
    # does NOT need to also clear the source_count>=2 bar, since "count of
    # independent sources" is the wrong question for deterministic Finance Engine
    # data (see deterministic_checks). The LLM challenge still has to actually
    # confirm the claim matches the real numbers, though — this isn't a rubber
    # stamp, just a different (and for this data, more appropriate) sufficiency
    # test than counting sources.
    if det.get("financially_grounded") and challenge.semantic_verdict == "SUPPORTED":
        return "SUPPORTED"
    if challenge.semantic_verdict in ("SUPPORTED", "SUPPORTED_WITH_LIMITATIONS"):
        return "SUPPORTED_WITH_LIMITATIONS"
    return "INSUFFICIENT"


def _upsert_verification(finding_id: uuid.UUID, fields: dict, db: Session) -> Verification:
    """Insert a Verification row, or update the existing one in place if this finding
    was already verified before — finding_id is UNIQUE, so re-verifying must never
    create a second row. `created_at` is treated as "last verified at" here (there's
    no separate updated_at column) so it reflects the most recent verification pass."""
    existing = db.query(Verification).filter(Verification.finding_id == finding_id).first()
    if existing is not None:
        for key, value in fields.items():
            setattr(existing, key, value)
        existing.created_at = datetime.now(timezone.utc)
        db.commit()
        db.refresh(existing)
        return existing

    verification = Verification(finding_id=finding_id, **fields)
    db.add(verification)
    db.commit()
    db.refresh(verification)
    return verification


async def verify_finding(finding_id: uuid.UUID, db: Session) -> Verification:
    finding = db.query(Finding).filter(Finding.id == finding_id).first()
    det = deterministic_checks(finding, db)

    if det["hard_fail"]:
        return _upsert_verification(
            finding.id,
            {
                "status": "INSUFFICIENT",
                "reasoning": "No supporting evidence found",
                "source_count": det["source_count"],
                "det_checks_pass": False,
                "llm_verdict": None,
            },
            db,
        )

    evidence_rows = _evidence_for_finding(finding, db)
    evidence_ids = {e.id for e in evidence_rows}
    evidence_texts = [_evidence_text(e) for e in evidence_rows]

    financial_observations = (
        _financial_observations_for_finding(finding, db) if det["financially_grounded"] else None
    )

    contradiction_context = None
    if det["has_contradiction"]:
        contradiction = _find_related_contradiction(finding, evidence_ids, db)
        if contradiction is not None:
            contradiction_context = contradiction.description

    challenge = await llm_challenge(
        finding, evidence_texts, contradiction_context, db, financial_observations=financial_observations
    )
    final_status = combine_verdict(det, challenge)
    det_checks_pass = det["evidence_exists"] and not det["has_contradiction"]

    return _upsert_verification(
        finding.id,
        {
            "status": final_status,
            "reasoning": challenge.reasoning,
            "source_count": det["source_count"],
            "det_checks_pass": det_checks_pass,
            "llm_verdict": challenge.semantic_verdict,
        },
        db,
    )


async def verify_all_findings(session_id: uuid.UUID, db: Session) -> list[Verification]:
    findings = db.query(Finding).filter(Finding.session_id == session_id).all()
    if not findings:
        return []

    already_verified_finding_ids = {
        v.finding_id
        for v in db.query(Verification)
        .filter(Verification.finding_id.in_([f.id for f in findings]))
        .all()
    }

    results = []
    for finding in findings:
        if finding.id in already_verified_finding_ids:
            continue
        results.append(await verify_finding(finding.id, db))
    return results
