import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.orchestrator import OrchestratorInput, orchestrator
from database import SessionLocal
from models.company import Company
from models.session import ResearchSession


async def main():
    db = SessionLocal()
    try:
        output, session_id = await orchestrator(
            OrchestratorInput(raw_question="Analyze Microsoft's AI strategy"), db
        )

        print("OrchestratorOutput:")
        print(f"  company_name: {output.company_name}")
        print(f"  interpreted_objective: {output.interpreted_objective}")
        print(f"  depth: {output.depth}")
        print(f"session_id: {session_id}")

        session = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
        company = db.query(Company).filter(Company.id == session.company_id).first()

        print("\nDB verification:")
        print(f"  ResearchSession row: id={session.id}, question={session.question!r}, "
              f"status={session.status}, company_id={session.company_id}, user_id={session.user_id}")
        print(f"  Company row: id={company.id}, name={company.name!r}, "
              f"ticker={company.ticker}, exchange={company.exchange}, aliases={company.aliases}")
    finally:
        db.close()


if __name__ == "__main__":
    asyncio.run(main())
