import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.orchestrator import OrchestratorInput, orchestrator
from database import SessionLocal
from models.financial_observation import FinancialObservation
from models.session import ResearchSession
from services.decision_record import snapshot_session
from services.recheck import compute_diff

SESSION_ID = uuid.UUID("406989aa-1d2b-46d8-b4ef-4682a2cedf00")


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


async def main():
    db = SessionLocal()
    try:
        # === (a) no-change case: snapshot NOW, then diff immediately ===
        print("=== (a) No-change case ===")
        fresh_snapshot = snapshot_session(SESSION_ID, db)
        print(f"Took a fresh snapshot: {fresh_snapshot.id}")

        diff_a = compute_diff(SESSION_ID, db)
        print(f"summary: {diff_a['summary']}")
        print(f"new_findings: {len(diff_a['new_findings'])}")
        print(f"changed_findings: {len(diff_a['changed_findings'])}")
        print(f"new_financial_observations: {len(diff_a['new_financial_observations'])}")
        print(f"changed_financial_observations: {len(diff_a['changed_financial_observations'])}")
        print(f"recommendation_changed: {diff_a['recommendation_changed']}")

        check("has_decision_record is True", diff_a["has_decision_record"] is True)
        check("no new findings detected", len(diff_a["new_findings"]) == 0)
        check("no changed findings detected", len(diff_a["changed_findings"]) == 0)
        check("no new financial observations detected", len(diff_a["new_financial_observations"]) == 0)
        check("no changed financial observations detected", len(diff_a["changed_financial_observations"]) == 0)
        check("recommendation not changed", diff_a["recommendation_changed"] is False)

        # === (b) real, meaningful change: add ONE new FinancialObservation ===
        print("\n=== (b) Real change: add one new FinancialObservation ===")
        session_row = db.query(ResearchSession).filter(ResearchSession.id == SESSION_ID).first()
        new_fo = FinancialObservation(
            session_id=SESSION_ID,
            company_id=session_row.company_id,
            metric="gross_margin",
            value=46.5,
            unit="percent",
            period="FY2025",
            observation_type="CALCULATED",
            source="manual_recheck_test",
        )
        db.add(new_fo)
        db.commit()
        db.refresh(new_fo)
        print(f"Added new FinancialObservation: metric={new_fo.metric} period={new_fo.period} value={new_fo.value}")

        diff_b = compute_diff(SESSION_ID, db)
        print(f"\nsummary: {diff_b['summary']}")
        print(f"new_financial_observations: {diff_b['new_financial_observations']}")
        print(f"changed_financial_observations: {diff_b['changed_financial_observations']}")
        print(f"new_findings: {len(diff_b['new_findings'])}")
        print(f"changed_findings: {len(diff_b['changed_findings'])}")

        check(
            "the new financial observation appears in new_financial_observations",
            any(
                fo["metric"] == "gross_margin" and fo["period"] == "FY2025" and fo["value"] == 46.5
                for fo in diff_b["new_financial_observations"]
            ),
        )
        check(
            "exactly one new financial observation detected (not more)",
            len(diff_b["new_financial_observations"]) == 1,
        )
        check("no financial observations incorrectly flagged as changed", len(diff_b["changed_financial_observations"]) == 0)
        check("no findings incorrectly flagged as new/changed", len(diff_b["new_findings"]) == 0 and len(diff_b["changed_findings"]) == 0)

        # === (c) no decision record yet: fresh, never-snapshotted session ===
        print("\n=== (c) No DecisionRecord yet: fresh session ===")
        _, fresh_session_id = await orchestrator(
            OrchestratorInput(raw_question="Test recheck on a fresh session", company_hint="Apple"), db
        )
        print(f"Fresh session_id (never snapshotted): {fresh_session_id}")

        diff_c = compute_diff(fresh_session_id, db)
        print(f"has_decision_record: {diff_c['has_decision_record']}")
        print(f"summary: {diff_c['summary']}")
        check("has_decision_record is False", diff_c["has_decision_record"] is False)
        check("snapshot_taken_at is None", diff_c["snapshot_taken_at"] is None)
        check(
            "every list is empty",
            all(
                len(diff_c[key]) == 0
                for key in (
                    "new_findings",
                    "changed_findings",
                    "new_financial_observations",
                    "changed_financial_observations",
                )
            ),
        )
        check("recommendation_changed is False", diff_c["recommendation_changed"] is False)
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
