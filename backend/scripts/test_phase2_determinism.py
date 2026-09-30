import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from workflows.oracle_workflow import run_oracle_workflow

QUESTION = "Analyze Apple's recent iPhone revenue performance"
COMPANY_HINT = "Apple"


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


async def main():
    db = SessionLocal()
    try:
        state1 = await run_oracle_workflow(question=QUESTION, company_hint=COMPANY_HINT, db=db)
        state2 = await run_oracle_workflow(question=QUESTION, company_hint=COMPANY_HINT, db=db)

        print(f"Run 1 session_id: {state1.session_id}")
        print(f"Run 2 session_id: {state2.session_id}")

        set1 = {(o["metric"], o["period"], o["value"]) for o in state1.financial_observations}
        set2 = {(o["metric"], o["period"], o["value"]) for o in state2.financial_observations}

        print(f"\nRun 1: {len(set1)} financial observations")
        print(f"Run 2: {len(set2)} financial observations")

        print("\n=== Side-by-side (metric, period) -> value ===")
        for metric, period, value in sorted(set1):
            match = (metric, period, value) in set2
            print(f"  {metric:<20} {period:<8} run1={value:<10} match_in_run2={match}")

        print("\n=== Determinism assertions ===")
        check("financial_observations sets are EXACTLY equal", set1 == set2)
        check(
            "evidence_answer text differs between runs (expected — live LLM output)",
            state1.evidence_answer != state2.evidence_answer,
        )
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
