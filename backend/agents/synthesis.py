import uuid
from typing import Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.finding import Finding
from models.report import Report

VERIFIED_STATUSES = ("SUPPORTED", "SUPPORTED_WITH_LIMITATIONS")
UNVERIFIED_STATUSES = ("CONFLICTING", "INSUFFICIENT")

SYNTHESIS_SYSTEM_PROMPT = (
    "You write an investment research report synthesis based ONLY on the verified "
    "findings provided below, grouped by area. You have NOT been shown any unverified, "
    "conflicting, or insufficient-evidence content — do not reference, speculate about, "
    "or imply the existence of anything beyond what's given here.\n\n"
    "For each area with verified findings, write a clear narrative section (area + "
    "narrative). Write an executive summary that ties the verified findings together. "
    "If you give a recommendation, it MUST be honestly hedged when the verified evidence "
    "is thin — e.g. if only one or two areas have verified findings, or an area's "
    "findings are limited in number, say so explicitly rather than sounding more "
    "confident than the evidence actually supports.\n\n"
    "Numbers and time periods — restate every figure with exactly the period the findings "
    "give it, and never re-attach it to a different period:\n"
    "- A change stated for one period (e.g. 'rose 8.1% in fiscal 2025', 'a 16% rise in "
    "2022') is a single-period change. Never describe it as growth 'over the past N years', "
    "'since <year>', 'annually', 'per year', or as a cumulative, average or compound rate.\n"
    "- When a finding pairs a multi-year trend description with single-period figures (e.g. "
    "'net sales trended upward over the past five years, with an 8.1% increase to $269.9 "
    "billion in fiscal 2025'), keep them in separate clauses so each figure stays tied to "
    "its own period: 'Net sales have trended upward over five years; in fiscal 2025 they "
    "rose 8.1% to $269.9 billion.' — NOT 'an 8.1% increase over the past five years'.\n"
    "- Do not compute, combine or derive new figures (no summing, averaging, annualizing, "
    "or turning two figures into a new rate). Only restate figures as given.\n"
    "- If a finding's own period for a figure conflicts with its verification note (e.g. "
    "the finding says '2022 to 2024' but the verification says 2023 to 2024), use the "
    "verification note's period. If a figure's period is unclear, state the figure without "
    "assigning it a period rather than guessing."
)


class ReportSection(BaseModel):
    area: str
    narrative: str


class SynthesisOutput(BaseModel):
    executive_summary: str
    sections: list[ReportSection]
    recommendation: Optional[str] = None
    limitations: list[str]


class _SynthesisLLMOutput(BaseModel):
    """What we actually ask the LLM for — deliberately excludes `limitations`,
    which is built in code from findings the model is never shown (see run_synthesis)."""

    executive_summary: str
    sections: list[ReportSection]
    recommendation: Optional[str] = None


def gather_verified_findings(session_id: uuid.UUID, db: Session) -> dict:
    findings = db.query(Finding).filter(Finding.session_id == session_id).all()

    verified_by_area: dict[str, list[dict]] = {}
    unverified: list[dict] = []

    for finding in findings:
        verification = finding.verification

        if verification is not None and verification.status in VERIFIED_STATUSES:
            verified_by_area.setdefault(finding.area, []).append(
                {
                    "statement": finding.statement,
                    "verification_status": verification.status,
                    "verification_reasoning": verification.reasoning,
                }
            )
        else:
            unverified.append(
                {
                    "finding_id": str(finding.id),
                    "area": finding.area,
                    "statement": finding.statement,
                    "status": verification.status if verification is not None else "NOT_VERIFIED",
                    "reasoning": verification.reasoning if verification is not None else None,
                }
            )

    return {"verified_by_area": verified_by_area, "unverified": unverified}


def _build_limitations(unverified: list[dict]) -> list[str]:
    # One unverified Finding row per line, so an area with several INSUFFICIENT
    # (or several un-verified) findings produces that many identical-text
    # lines — e.g. two separate Risks findings both landing on INSUFFICIENT
    # gives "Risks: insufficient evidence" twice. That's a real duplicate in
    # this stored array (every consumer sees it — the Report tab is just
    # rendering it 1:1), not a display-layer bug, so it's deduped here at the
    # source rather than downstream. Dedup by the exact rendered line, not by
    # area alone: CONFLICTING lines carry per-finding `reasoning`, and two
    # conflicting findings in the same area with genuinely different
    # reasoning are two distinct, real limitations worth keeping — only an
    # exact repeat (same area, same status, same reasoning) is noise.
    lines = []
    for item in unverified:
        if item["status"] == "CONFLICTING":
            lines.append(f"{item['area']}: conflicting evidence — {item['reasoning'] or 'see verification record'}")
        elif item["status"] == "INSUFFICIENT":
            lines.append(f"{item['area']}: insufficient evidence")
        else:
            lines.append(f"{item['area']}: not yet verified")
    return list(dict.fromkeys(lines))


def _format_verified_text(verified_by_area: dict[str, list[dict]]) -> str:
    if not verified_by_area:
        return "(no verified findings available for this session)"

    parts = []
    for area, items in verified_by_area.items():
        area_lines = "\n".join(
            f"  - Finding: {item['statement']}\n"
            f"    Verification ({item['verification_status']}): {item['verification_reasoning']}"
            for item in items
        )
        parts.append(f"{area}:\n{area_lines}")
    return "\n\n".join(parts)


async def run_synthesis(session_id: uuid.UUID, company_name: str, db: Session) -> SynthesisOutput:
    gathered = gather_verified_findings(session_id, db)
    verified_by_area = gathered["verified_by_area"]
    unverified = gathered["unverified"]

    verified_text = _format_verified_text(verified_by_area)
    user_content = f"Company: {company_name}\n\nVerified findings by area:\n{verified_text}"

    llm = ChatOpenAI(model="gpt-4o-mini").with_structured_output(_SynthesisLLMOutput)
    llm_output: _SynthesisLLMOutput = await llm.ainvoke(
        [SystemMessage(content=SYNTHESIS_SYSTEM_PROMPT), HumanMessage(content=user_content)]
    )

    limitations = _build_limitations(unverified)

    output = SynthesisOutput(
        executive_summary=llm_output.executive_summary,
        sections=llm_output.sections,
        recommendation=llm_output.recommendation,
        limitations=limitations,
    )

    report = Report(
        session_id=session_id,
        executive_summary=output.executive_summary,
        sections={section.area: section.narrative for section in output.sections},
        recommendation=output.recommendation,
        limitations=output.limitations,
    )
    db.add(report)
    db.commit()
    db.refresh(report)

    return output
