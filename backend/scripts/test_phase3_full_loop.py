import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from models.decision_record import DecisionRecord
from models.finding import Finding
from models.report import Report
from models.verification import Verification
from workflows.oracle_workflow import run_oracle_workflow


async def main():
    db = SessionLocal()
    try:
        final_state = await run_oracle_workflow(
            question="Analyze Apple's recent iPhone revenue performance",
            company_hint="Apple",
            db=db,
        )

        print("Final OracleState:")
        for field, value in final_state.model_dump().items():
            print(f"  {field}: {value}")

        session_id = final_state.session_id
        print(f"\n=== Independent DB verification for session {session_id} ===")

        findings = db.query(Finding).filter(Finding.session_id == session_id).all()
        print(f"\nFinding rows: {len(findings)}")
        for f in findings:
            print(f"  area={f.area!r} evidence_ids={f.evidence_ids} statement={f.statement[:70]!r}...")

        risks_with_evidence = [f for f in findings if f.area == "Risks" and len(f.evidence_ids) > 0]
        print(
            f"\nRisks-area findings with non-empty evidence_ids (Section 4's fix): "
            f"{len(risks_with_evidence)}"
        )
        for f in risks_with_evidence:
            print(f"  id={f.id} evidence_ids={f.evidence_ids}")

        finding_ids = [f.id for f in findings]
        verifications = (
            db.query(Verification).filter(Verification.finding_id.in_(finding_ids)).all()
            if finding_ids
            else []
        )
        print(f"\nVerification rows: {len(verifications)} (for {len(findings)} findings)")
        verified_finding_ids = {v.finding_id for v in verifications}
        print(f"  every finding has a Verification row: {verified_finding_ids == set(finding_ids)}")
        for v in verifications:
            print(f"  finding_id={v.finding_id} status={v.status} source_count={v.source_count}")

        reports = db.query(Report).filter(Report.session_id == session_id).all()
        print(f"\nReport rows: {len(reports)}")
        for r in reports:
            print(f"  id={r.id} executive_summary={r.executive_summary[:80]!r}...")
            print(f"  limitations count={len(r.limitations)}")

        decision_records = (
            db.query(DecisionRecord).filter(DecisionRecord.session_id == session_id).all()
        )
        print(f"\nDecisionRecord rows: {len(decision_records)}")
        for dr in decision_records:
            print(
                f"  id={dr.id} findings_captured={len(dr.snapshot['findings'])} "
                f"financial_observations_captured={len(dr.snapshot['financial_observations'])} "
                f"report_captured={dr.snapshot['report'] is not None}"
            )
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
