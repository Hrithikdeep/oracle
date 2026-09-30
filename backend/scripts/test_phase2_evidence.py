import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.evidence_agent import evidence_agent
from agents.orchestrator import OrchestratorInput, orchestrator
from agents.research_planner import PlannerInput, research_planner
from database import SessionLocal
from models.evidence import Evidence
from models.finding import Finding
from models.source import Source
from models.task import ResearchTask

COMPANY_NAME = "Apple"
QUESTION = "Analyze Apple's recent iPhone revenue performance"


async def main():
    db = SessionLocal()
    try:
        orchestrator_output, session_id = await orchestrator(
            OrchestratorInput(raw_question=QUESTION, company_hint=COMPANY_NAME), db
        )
        print(f"session_id: {session_id}")
        print(f"company_name: {orchestrator_output.company_name}")

        planner_output = await research_planner(
            PlannerInput(
                session_id=session_id,
                company_name=orchestrator_output.company_name,
                interpreted_objective=orchestrator_output.interpreted_objective,
            ),
            db,
        )
        print(f"planned areas: {planner_output.areas}\n")

        financial_task = (
            db.query(ResearchTask)
            .filter(ResearchTask.session_id == session_id, ResearchTask.area == "Financial")
            .first()
        )
        print(f"Financial task objective: {financial_task.objective}\n")

        print("=== running evidence_agent() with the real retrieval pipeline ===")
        output = await evidence_agent(
            task_id=financial_task.id,
            company_name=orchestrator_output.company_name,
            session_id=session_id,
            db=db,
        )

        print(f"\nFinal validated evidence count: {len(output.evidence_items)}")
        for item in output.evidence_items:
            print(f"  chunk_id={item.chunk_id} confidence={item.confidence}")
            print(f"    observation: {item.observation}")
            print(f"    quote: {item.quote!r}")

        print(f"\nAssembled answer:\n{output.answer}")

        print("\n=== Independent DB verification ===")
        sources = db.query(Source).filter(Source.session_id == session_id).all()
        print(f"Source rows for session: {len(sources)}")
        for s in sources:
            print(f"  id={s.id} status={s.status} url={s.url}")

        evidence_rows = db.query(Evidence).filter(Evidence.task_id == financial_task.id).all()
        print(f"\nEvidence rows for Financial task: {len(evidence_rows)}")
        source_by_id = {s.id: s for s in sources}
        for ev in evidence_rows:
            src = source_by_id.get(ev.source_id)
            print(
                f"  evidence_id={ev.id} -> source_id={ev.source_id} "
                f"(source_url={src.url if src else 'UNKNOWN'}) location={ev.location}"
            )

        findings = (
            db.query(Finding)
            .filter(Finding.session_id == session_id, Finding.area == "Financial")
            .all()
        )
        print(f"\nFinding rows for Financial area: {len(findings)}")
        for f in findings:
            print(f"  id={f.id} statement={f.statement!r}")

        refreshed_task = (
            db.query(ResearchTask).filter(ResearchTask.id == financial_task.id).first()
        )
        print(f"\nFinancial task status after evidence_agent: {refreshed_task.status}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
