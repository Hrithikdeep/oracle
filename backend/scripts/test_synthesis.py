import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.synthesis import run_synthesis
from agents.verification import verify_finding
from database import SessionLocal
from models.finding import Finding
from models.report import Report
from models.verification import Verification
from services.decision_record import snapshot_session

SESSION_ID = uuid.UUID("406989aa-1d2b-46d8-b4ef-4682a2cedf00")
COMPANY_NAME = "Apple"

# Two real, non-contradicted Evidence rows from different sources in this session
# (deliberately NOT the pair involved in the Section 3 borderline contradiction),
# used to construct one additional genuinely-evidenced Finding so this real session
# has a full mix of all 4 verification statuses to synthesize from.
CLEAN_EVIDENCE_IDS = [
    "08d1065e-e3a9-488b-aff0-5fb268b0a95a",  # source 53636d23...
    "a4a2a87b-8e66-4d75-ad73-bf9e28d4e050",  # source 7c0dc256...
]


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


def _contains_near_verbatim(needle: str, haystacks: list[str], min_words: int = 8) -> bool:
    needle_words = needle.lower().split()
    haystacks_lower = [h.lower() for h in haystacks]
    if len(needle_words) < min_words:
        needle_norm = " ".join(needle_words)
        return any(needle_norm in h for h in haystacks_lower)
    for i in range(len(needle_words) - min_words + 1):
        window = " ".join(needle_words[i : i + min_words])
        if any(window in h for h in haystacks_lower):
            return True
    return False


async def main():
    db = SessionLocal()
    try:
        print(f"=== Setup: ensure session {SESSION_ID} has a full status mix ===")
        existing_statuses = {
            v.status
            for v in db.query(Verification)
            .join(Finding, Finding.id == Verification.finding_id)
            .filter(Finding.session_id == SESSION_ID)
            .all()
        }
        print(f"Existing verification statuses in this session: {existing_statuses}")

        clean_finding = Finding(
            session_id=SESSION_ID,
            area="Financial",
            statement=(
                "iPhone sales grew 7% in 2022 over 2021, and the iPhone segment "
                "contributed approximately 50-52% of Apple's total revenue in 2023, "
                "underscoring its central role in Apple's overall business."
            ),
            materiality="MEDIUM",
            status="DRAFT",
            evidence_ids=CLEAN_EVIDENCE_IDS,
        )
        db.add(clean_finding)
        db.commit()
        db.refresh(clean_finding)
        print(f"Added a genuinely-evidenced control Finding: {clean_finding.statement!r}")

        clean_verification = await verify_finding(clean_finding.id, db)
        print(
            f"Its real verification result: status={clean_verification.status} "
            f"source_count={clean_verification.source_count}\n"
        )

        # === Run the actual synthesis ===
        print("=== Running run_synthesis() ===")
        output = await run_synthesis(SESSION_ID, COMPANY_NAME, db)

        print("\nFull SynthesisOutput:")
        print(f"\nexecutive_summary:\n{output.executive_summary}")
        print("\nsections:")
        for s in output.sections:
            print(f"  [{s.area}]\n  {s.narrative}\n")
        print(f"recommendation:\n{output.recommendation}")
        print("\nlimitations:")
        for line in output.limitations:
            print(f"  - {line}")

        # === Independent verification ===
        print("\n=== Independent checks ===")

        all_findings = db.query(Finding).filter(Finding.session_id == SESSION_ID).all()
        unverified_findings = []
        for f in all_findings:
            v = f.verification
            if v is None or v.status in ("CONFLICTING", "INSUFFICIENT"):
                unverified_findings.append((f, v))

        print(f"Total unverified (CONFLICTING/INSUFFICIENT/not-verified) findings: {len(unverified_findings)}")

        # (a) no unverified statement text leaks into the confident sections
        summary_and_narratives = [output.executive_summary] + [s.narrative for s in output.sections]
        leaks = []
        for finding, v in unverified_findings:
            if _contains_near_verbatim(finding.statement, summary_and_narratives):
                leaks.append(finding.id)
        check(
            "(a) NO unverified finding's statement leaks verbatim/near-verbatim into "
            "executive_summary or section narratives",
            len(leaks) == 0,
        )
        if leaks:
            print(f"  LEAKED finding ids: {leaks}")

        # (b) every unverified finding is represented in limitations
        missing_from_limitations = []
        for finding, v in unverified_findings:
            status_label = v.status if v is not None else "NOT_VERIFIED"
            represented = any(
                finding.area in line
                and (
                    (status_label == "CONFLICTING" and "conflicting" in line.lower())
                    or (status_label == "INSUFFICIENT" and "insufficient" in line.lower())
                    or (status_label == "NOT_VERIFIED" and "not yet verified" in line.lower())
                )
                for line in output.limitations
            )
            if not represented:
                missing_from_limitations.append((finding.id, finding.area, status_label))
        check(
            "(b) every CONFLICTING/INSUFFICIENT finding is represented in limitations",
            len(missing_from_limitations) == 0,
        )
        if missing_from_limitations:
            print(f"  MISSING from limitations: {missing_from_limitations}")
        check(
            "(b) limitations count matches unverified findings count exactly",
            len(output.limitations) == len(unverified_findings),
        )

        # (c) Report row persisted correctly
        report_row = (
            db.query(Report)
            .filter(Report.session_id == SESSION_ID)
            .order_by(Report.created_at.desc())
            .first()
        )
        print(f"\n(c) Persisted Report row: id={report_row.id}")
        check("(c) Report.executive_summary matches returned output", report_row.executive_summary == output.executive_summary)
        check(
            "(c) Report.sections matches returned output",
            report_row.sections == {s.area: s.narrative for s in output.sections},
        )
        check("(c) Report.recommendation matches returned output", report_row.recommendation == output.recommendation)
        check("(c) Report.limitations matches returned output", report_row.limitations == output.limitations)

        # === Wire in the Decision Record snapshot right after synthesis ===
        print("\n=== snapshot_session() after synthesis ===")
        decision_record = snapshot_session(SESSION_ID, db)
        print(f"DecisionRecord persisted: id={decision_record.id}")
        print(f"  findings captured: {len(decision_record.snapshot['findings'])}")
        print(f"  financial_observations captured: {len(decision_record.snapshot['financial_observations'])}")
        print(f"  report captured: {decision_record.snapshot['report'] is not None}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
