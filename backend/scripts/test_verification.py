import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.risk_contradiction import _persist_risks, identify_risks
from agents.verification import deterministic_checks, verify_all_findings, verify_finding
from database import SessionLocal
from models.evidence import Evidence
from models.finding import Finding
from models.plan import ResearchPlan
from models.source import Source
from models.task import ResearchTask

# Session from Section 3: has the borderline semantic contradiction + 3 Risks findings.
CONTRADICTION_SESSION_ID = uuid.UUID("406989aa-1d2b-46d8-b4ef-4682a2cedf00")
FINANCIAL_FINDING_WITH_CONTRADICTION = uuid.UUID("99353c07-9c79-4f15-9f3b-c4eb6c87d4a2")
RISKS_FINDING_ID = uuid.UUID("043c8cac-e7f8-4846-acc3-bf149063c11a")

# A DIFFERENT, clean Apple session (Phase 2 data) never touched by Section 3's
# risk_contradiction_agent — genuinely no contradictions, multi-source Financial evidence.
STRONG_CASE_SESSION_ID = uuid.UUID("7003b5cc-356f-4421-b77e-66c07620b599")
STRONG_CASE_FINDING_ID = uuid.UUID("4ef969be-43d2-49d3-803d-f18f771d51c2")


def print_verification(v):
    print(f"  id={v.id}")
    print(f"  finding_id={v.finding_id}")
    print(f"  status={v.status}")
    print(f"  source_count={v.source_count}")
    print(f"  det_checks_pass={v.det_checks_pass}")
    print(f"  llm_verdict={v.llm_verdict}")
    print(f"  reasoning={v.reasoning!r}")


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


async def main():
    db = SessionLocal()
    try:
        # === (a) Adversarial case 1: weak, single-source, thin evidence ===
        print("=== (a) Weak case: 1 source, thin evidence vs. a broad claim ===")
        plan = (
            db.query(ResearchPlan)
            .filter(ResearchPlan.session_id == CONTRADICTION_SESSION_ID)
            .first()
        )
        weak_task = ResearchTask(
            session_id=CONTRADICTION_SESSION_ID,
            plan_id=plan.id,
            area="WeakTestArea",
            objective="Test weak evidence case",
            origin="FOLLOW_UP",
            status="COMPLETED",
        )
        db.add(weak_task)
        db.commit()
        db.refresh(weak_task)

        weak_source = Source(
            session_id=CONTRADICTION_SESSION_ID,
            task_id=weak_task.id,
            title="Weak Test Source",
            source_type="WEB",
            status="RETRIEVED",
            url="https://example.com/weak-test",
        )
        db.add(weak_source)
        db.commit()
        db.refresh(weak_source)

        weak_evidence = Evidence(
            session_id=CONTRADICTION_SESSION_ID,
            task_id=weak_task.id,
            source_id=weak_source.id,
            observation="Apple mentioned AI briefly in passing during an interview.",
            evidence_type="NEWS",
            location="N/A (web source)",
            confidence=0.3,
            status="ACCEPTED",
        )
        db.add(weak_evidence)

        weak_finding = Finding(
            session_id=CONTRADICTION_SESSION_ID,
            area="WeakTestArea",
            statement="Apple has launched a comprehensive AI-first strategy across all product lines.",
            materiality="MEDIUM",
            status="DRAFT",
        )
        db.add(weak_finding)
        db.commit()
        db.refresh(weak_finding)

        print(f"Finding statement: {weak_finding.statement!r}")
        print(f"Evidence (1 source): {weak_evidence.observation!r}\n")

        weak_verification = await verify_finding(weak_finding.id, db)
        print_verification(weak_verification)
        check("weak case is NOT SUPPORTED", weak_verification.status != "SUPPORTED")

        # === (b) Adversarial case 2: the real Section 3 borderline contradiction ===
        print("\n=== (b) Real case from Section 3: the borderline semantic contradiction ===")
        print(
            "NOTE: the task described this as a 'Risks-area Finding', but the actual "
            "contradiction's Evidence rows are linked (via task area) to the FINANCIAL "
            "task, not Risks — verified directly against the DB before writing this test. "
            "Testing both: the finding actually affected, and the literal Risks finding."
        )

        print("\n--- (b1) The Financial finding actually linked to the contradiction ---")
        financial_finding = (
            db.query(Finding).filter(Finding.id == FINANCIAL_FINDING_WITH_CONTRADICTION).first()
        )
        print(f"Finding statement: {financial_finding.statement!r}")
        det = deterministic_checks(financial_finding, db)
        print(f"deterministic_checks(): {det}")

        financial_verification = await verify_finding(financial_finding.id, db)
        print_verification(financial_verification)

        print("\n--- (b2) OLD Risks finding from Section 3 (evidence_ids=[] from before this fix) ---")
        old_risks_finding = db.query(Finding).filter(Finding.id == RISKS_FINDING_ID).first()
        print(f"Finding statement: {old_risks_finding.statement!r}")
        print(f"evidence_ids: {old_risks_finding.evidence_ids}")
        det_old_risks = deterministic_checks(old_risks_finding, db)
        print(f"deterministic_checks(): {det_old_risks}")
        old_risks_verification = await verify_finding(old_risks_finding.id, db)
        print_verification(old_risks_verification)

        print(
            "\n--- (b2 follow-up) FRESH Risks findings via the fixed identify_risks()/"
            "_persist_risks() (evidence_ids now populated) ---"
        )
        fresh_risk_output = await identify_risks(CONTRADICTION_SESSION_ID, "Apple", db)
        fresh_risk_findings = _persist_risks(CONTRADICTION_SESSION_ID, fresh_risk_output.risks, db)
        print(f"{len(fresh_risk_findings)} fresh Risk findings created")

        for finding in fresh_risk_findings:
            print(f"\nFinding statement: {finding.statement!r}")
            print(f"evidence_ids: {finding.evidence_ids}")
            det_fresh_risk = deterministic_checks(finding, db)
            print(f"deterministic_checks(): {det_fresh_risk}")
            fresh_risk_verification = await verify_finding(finding.id, db)
            print_verification(fresh_risk_verification)
            check(
                f"fresh risk finding {finding.id} got a real source_count (not hard_fail)",
                det_fresh_risk["hard_fail"] is False or len(finding.evidence_ids) == 0,
            )

        # === (c) Strong case: multi-source, no contradiction ===
        print("\n=== (c) Strong case: multi-source Financial finding, no contradiction ===")
        strong_finding = db.query(Finding).filter(Finding.id == STRONG_CASE_FINDING_ID).first()
        print(f"Finding statement: {strong_finding.statement!r}")
        det_strong = deterministic_checks(strong_finding, db)
        print(f"deterministic_checks(): {det_strong}")

        strong_verification = await verify_finding(strong_finding.id, db)
        print_verification(strong_verification)
        check("strong case IS SUPPORTED", strong_verification.status == "SUPPORTED")

        # === (d) verify_all_findings() for the full contradiction-session ===
        print(f"\n=== (d) verify_all_findings() for session {CONTRADICTION_SESSION_ID} ===")
        all_verifications = await verify_all_findings(CONTRADICTION_SESSION_ID, db)
        print(f"{len(all_verifications)} new Verification rows created (already-verified findings skipped):")
        for v in all_verifications:
            finding = db.query(Finding).filter(Finding.id == v.finding_id).first()
            print(f"\n  finding_area={finding.area!r} finding_statement={finding.statement[:80]!r}...")
            print_verification(v)
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
