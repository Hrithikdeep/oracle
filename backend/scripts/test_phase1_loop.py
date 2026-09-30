import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from models.company import Company
from models.evidence import Evidence
from models.financial_observation import FinancialObservation
from models.finding import Finding
from models.plan import ResearchPlan
from models.session import ResearchSession
from models.source import Source
from models.task import ResearchTask
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

        plans = db.query(ResearchPlan).filter(ResearchPlan.session_id == session_id).all()
        tasks = db.query(ResearchTask).filter(ResearchTask.session_id == session_id).all()
        financial_task = next(t for t in tasks if t.area == "Financial")
        sources = db.query(Source).filter(Source.session_id == session_id).all()
        evidence_rows = db.query(Evidence).filter(Evidence.task_id == financial_task.id).all()
        findings = (
            db.query(Finding)
            .filter(Finding.session_id == session_id, Finding.area == "Financial")
            .all()
        )
        session_row = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
        company = db.query(Company).filter(Company.id == session_row.company_id).first()
        financial_observations = (
            db.query(FinancialObservation)
            .filter(FinancialObservation.session_id == session_id)
            .all()
        )

        print("\nDB verification:")
        print(f"  ResearchSession status: {session_row.status}, started_at: {session_row.started_at}")
        print(f"  Company: name={company.name!r} ticker={company.ticker!r}")

        print(f"  ResearchPlan rows for session: {len(plans)}")
        for p in plans:
            print(f"    id={p.id} areas={p.areas} rationale={p.rationale!r}")

        print(f"  ResearchTask rows for session: {len(tasks)}")
        for t in tasks:
            print(
                f"    id={t.id} plan_id={t.plan_id} area={t.area!r} "
                f"objective={t.objective!r} origin={t.origin} status={t.status}"
            )

        print(f"  Source rows for session: {len(sources)}")
        for s in sources:
            print(
                f"    id={s.id} title={s.title!r} source_type={s.source_type} "
                f"status={s.status} task_id={s.task_id} retrieved_at={s.retrieved_at}"
            )

        print(f"  Evidence rows for financial task: {len(evidence_rows)}")
        for ev in evidence_rows:
            print(
                f"    id={ev.id} source_id={ev.source_id} location={ev.location} "
                f"confidence={ev.confidence} status={ev.status}\n"
                f"      observation={ev.observation!r}"
            )

        print(f"  Finding rows for Financial area: {len(findings)}")
        for f in findings:
            print(
                f"    id={f.id} materiality={f.materiality} status={f.status}\n"
                f"      statement={f.statement!r}"
            )

        print(f"  FinancialObservation rows for session: {len(financial_observations)}")
        for fo in financial_observations:
            print(
                f"    id={fo.id} metric={fo.metric} value={fo.value} unit={fo.unit} "
                f"period={fo.period} observation_type={fo.observation_type}"
            )

        state_metrics = {(m["metric"], m["period"]) for m in final_state.financial_observations}
        db_metrics = {(fo.metric, fo.period) for fo in financial_observations}
        print(
            f"\n  state.financial_observations matches DB rows exactly: "
            f"{state_metrics == db_metrics} ({len(state_metrics)} vs {len(db_metrics)})"
        )
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
