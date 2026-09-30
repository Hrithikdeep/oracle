import asyncio
import sys
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.risk_contradiction import check_financial_contradictions, run_risk_contradiction_agent
from database import SessionLocal
from models.company import Company
from models.contradiction import Contradiction
from models.evidence import Evidence
from models.financial_observation import FinancialObservation
from models.finding import Finding
from models.session import ResearchSession

# A real session from Phase 2's runs with existing FinancialObservation + Evidence rows.
SESSION_ID = uuid.UUID("406989aa-1d2b-46d8-b4ef-4682a2cedf00")

FORCED_METRIC = "revenue_growth_yoy_forced_test"
FORCED_PERIOD = "FY2025"


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


async def main():
    db = SessionLocal()
    try:
        session_row = db.query(ResearchSession).filter(ResearchSession.id == SESSION_ID).first()
        company = db.query(Company).filter(Company.id == session_row.company_id).first()
        print(f"Using session_id={SESSION_ID} company={company.name!r}\n")

        # --- (a) force a deterministic financial contradiction ---
        print("=== (a) Forcing a deterministic financial contradiction ===")
        fake_a = FinancialObservation(
            session_id=SESSION_ID,
            company_id=company.id,
            metric=FORCED_METRIC,
            value=100.0,
            unit="percent",
            period=FORCED_PERIOD,
            observation_type="REPORTED",
            source="manual_test_a",
        )
        fake_b = FinancialObservation(
            session_id=SESSION_ID,
            company_id=company.id,
            metric=FORCED_METRIC,
            value=125.0,
            unit="percent",
            period=FORCED_PERIOD,
            observation_type="REPORTED",
            source="manual_test_b",
        )
        db.add_all([fake_a, fake_b])
        db.commit()
        print(f"Inserted two FinancialObservation rows: {fake_a.value} vs {fake_b.value} "
              f"({FORCED_METRIC}, {FORCED_PERIOD}) — 20% apart relative to the larger value")

        forced_contradictions = await check_financial_contradictions(SESSION_ID, db)
        matching = [c for c in forced_contradictions if FORCED_METRIC in c.description]
        check("forced contradiction was detected", len(matching) == 1)
        if matching:
            c = matching[0]
            print(f"\nContradiction row created:")
            print(f"  id={c.id}")
            print(f"  session_id={c.session_id}")
            print(f"  evidence_a_id={c.evidence_a_id}  evidence_b_id={c.evidence_b_id}")
            print(f"  materiality={c.materiality} status={c.status}")
            print(f"  description={c.description!r}")

        # --- (b) run the full agent against real accumulated evidence ---
        print("\n=== (b) Running full run_risk_contradiction_agent() ===")
        summary = await run_risk_contradiction_agent(SESSION_ID, company.name, db)
        print(f"Summary: {summary}")

        # --- (c) independent DB verification ---
        print("\n=== (c) Independent DB verification ===")
        risk_findings = (
            db.query(Finding)
            .filter(Finding.session_id == SESSION_ID, Finding.area == "Risks")
            .all()
        )
        print(f"Finding rows with area='Risks': {len(risk_findings)}")
        for f in risk_findings:
            print(f"  id={f.id} materiality={f.materiality} statement={f.statement!r}")

        all_contradictions = (
            db.query(Contradiction).filter(Contradiction.session_id == SESSION_ID).all()
        )
        print(f"\nTotal Contradiction rows for session: {len(all_contradictions)}")

        semantic_ones = [c for c in all_contradictions if c.evidence_a_id is not None]
        print(f"Semantic contradictions (with evidence links): {len(semantic_ones)}")
        for c in semantic_ones:
            ev_a = db.query(Evidence).filter(Evidence.id == c.evidence_a_id).first()
            ev_b = db.query(Evidence).filter(Evidence.id == c.evidence_b_id).first()
            print(f"  id={c.id}")
            print(f"    evidence_a_id={c.evidence_a_id} -> exists={ev_a is not None}")
            print(f"    evidence_b_id={c.evidence_b_id} -> exists={ev_b is not None}")
            print(f"    distinct_ids={c.evidence_a_id != c.evidence_b_id}")
            print(f"    description={c.description!r}")
            check(
                f"contradiction {c.id} references two real, distinct Evidence rows",
                ev_a is not None and ev_b is not None and c.evidence_a_id != c.evidence_b_id,
            )

        deterministic_ones = [c for c in all_contradictions if c.evidence_a_id is None]
        print(f"\nDeterministic (financial) contradictions (no evidence link): {len(deterministic_ones)}")
        for c in deterministic_ones:
            print(f"  id={c.id} description={c.description!r}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
