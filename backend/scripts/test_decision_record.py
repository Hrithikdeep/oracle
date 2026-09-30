import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from models.decision_record import DecisionRecord
from models.financial_observation import FinancialObservation
from models.finding import Finding
from services.decision_record import snapshot_session

SESSION_ID = uuid.UUID("406989aa-1d2b-46d8-b4ef-4682a2cedf00")


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


def main():
    db = SessionLocal()
    try:
        baseline_count = (
            db.query(DecisionRecord).filter(DecisionRecord.session_id == SESSION_ID).count()
        )
        print(f"Baseline DecisionRecord rows for this session (e.g. from the wired "
              f"test_synthesis.py call): {baseline_count}\n")

        # === (a) Call snapshot_session() ===
        print("=== (a) snapshot_session() ===")
        record = snapshot_session(SESSION_ID, db)
        print(f"DecisionRecord id: {record.id}")

        # === (b) print structure — keys and counts, not the raw dump ===
        print("\n=== (b) Snapshot structure ===")
        snapshot = record.snapshot
        print(f"Top-level keys: {list(snapshot.keys())}")
        print(f"findings captured: {len(snapshot['findings'])}")
        status_counts: dict[str, int] = {}
        for f in snapshot["findings"]:
            v = f["verification"]
            status = v["status"] if v else "NOT_VERIFIED"
            status_counts[status] = status_counts.get(status, 0) + 1
        print(f"  by verification status: {status_counts}")
        print(f"financial_observations captured: {len(snapshot['financial_observations'])}")
        print(f"report present: {snapshot['report'] is not None}")
        if snapshot["report"]:
            print(f"  executive_summary length: {len(snapshot['report']['executive_summary'])} chars")
            print(f"  recommendation present: {snapshot['report']['recommendation'] is not None}")

        # === (c) independent DB spot-checks ===
        print("\n=== (c) Independent DB verification ===")
        db_record = db.query(DecisionRecord).filter(DecisionRecord.id == record.id).first()
        check("DecisionRecord row exists in DB", db_record is not None)
        check("DecisionRecord.session_id matches", db_record.session_id == SESSION_ID)

        spot_finding_data = snapshot["findings"][0]
        live_finding = db.query(Finding).filter(Finding.id == uuid.UUID(spot_finding_data["id"])).first()
        check(
            f"spot-check: finding {live_finding.id} statement matches live DB row",
            spot_finding_data["statement"] == live_finding.statement,
        )
        check(
            f"spot-check: finding {live_finding.id} area matches live DB row",
            spot_finding_data["area"] == live_finding.area,
        )

        spot_fo_data = snapshot["financial_observations"][0]
        live_fo = (
            db.query(FinancialObservation)
            .filter(
                FinancialObservation.session_id == SESSION_ID,
                FinancialObservation.metric == spot_fo_data["metric"],
                FinancialObservation.period == spot_fo_data["period"],
            )
            .first()
        )
        check(
            f"spot-check: financial observation {spot_fo_data['metric']}/{spot_fo_data['period']} "
            f"value matches live DB row",
            live_fo is not None and spot_fo_data["value"] == live_fo.value,
        )

        # === (d) call snapshot_session() again, confirm two rows coexist ===
        print("\n=== (d) Second snapshot (time has passed) ===")
        record_2 = snapshot_session(SESSION_ID, db)
        print(f"Second DecisionRecord id: {record_2.id}")
        check("second snapshot got a different id from the first", record_2.id != record.id)

        all_records = db.query(DecisionRecord).filter(DecisionRecord.session_id == SESSION_ID).all()
        print(f"Total DecisionRecord rows for this session now: {len(all_records)} "
              f"(baseline was {baseline_count})")
        check(
            "exactly two NEW DecisionRecord rows were added by this script's two calls",
            len(all_records) == baseline_count + 2,
        )
        check(
            "both new rows are distinct, real DecisionRecord ids",
            record.id in {r.id for r in all_records} and record_2.id in {r.id for r in all_records},
        )
    finally:
        db.close()


if __name__ == "__main__":
    main()
