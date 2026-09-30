import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.orchestrator import OrchestratorInput, orchestrator
from database import SessionLocal
from models.session import ResearchSession
from services.finance_engine import run_finance_engine

TICKER = "AAPL"


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


def find_metric(observations, metric: str, period: str):
    return next((o for o in observations if o.metric == metric and o.period == period), None)


async def run_once(db, label: str):
    _, session_id = await orchestrator(
        OrchestratorInput(raw_question=f"Finance engine test run {label}", company_hint="Apple"), db
    )
    session_row = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
    company_id = session_row.company_id

    observations = await run_finance_engine(TICKER, session_id, company_id, db)
    print(f"Run {label}: session_id={session_id}, {len(observations)} observations persisted")
    return observations


async def main():
    db = SessionLocal()
    try:
        run1 = await run_once(db, "1")
        run2 = await run_once(db, "2")

        growth_periods_1 = {o.period for o in run1 if o.metric == "revenue_growth_yoy"}
        growth_periods_2 = {o.period for o in run2 if o.metric == "revenue_growth_yoy"}
        common_periods = growth_periods_1 & growth_periods_2
        if not common_periods:
            print("FAIL: no common revenue_growth_yoy period found between the two runs")
            return
        target_period = max(common_periods)
        print(f"\nComparing period: {target_period}\n")

        g1 = find_metric(run1, "revenue_growth_yoy", target_period)
        g2 = find_metric(run2, "revenue_growth_yoy", target_period)
        m1 = find_metric(run1, "operating_margin", target_period)
        m2 = find_metric(run2, "operating_margin", target_period)

        print("=== Side-by-side comparison ===")
        print(f"revenue_growth_yoy  run1={g1.value if g1 else None}  run2={g2.value if g2 else None}")
        print(f"operating_margin    run1={m1.value if m1 else None}  run2={m2.value if m2 else None}")

        print("\n=== Determinism assertions ===")
        check("revenue_growth_yoy values are both present", g1 is not None and g2 is not None)
        check("revenue_growth_yoy values are EXACTLY equal", g1 is not None and g2 is not None and g1.value == g2.value)
        check("operating_margin values are both present", m1 is not None and m2 is not None)
        check("operating_margin values are EXACTLY equal", m1 is not None and m2 is not None and m1.value == m2.value)

        print(f"\n=== calc_inputs for manual verification (revenue_growth_yoy, period={target_period}) ===")
        print(json.dumps(g1.calc_inputs, indent=2))
        prior = g1.calc_inputs["prior_value_musd"]
        current = g1.calc_inputs["current_value_musd"]
        expected = round((current - prior) / prior * 100, 2)
        print(f"Manual check: ({current} - {prior}) / {prior} * 100 = {expected}")
        check("stored value matches manual recomputation", g1.value == expected)

        print(f"\n=== calc_inputs for manual verification (operating_margin, period={target_period}) ===")
        print(json.dumps(m1.calc_inputs, indent=2))
        op_income = m1.calc_inputs["operating_income_musd"]
        revenue = m1.calc_inputs["revenue_musd"]
        expected_margin = round(op_income / revenue * 100, 2)
        print(f"Manual check: {op_income} / {revenue} * 100 = {expected_margin}")
        check("stored value matches manual recomputation", m1.value == expected_margin)
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
