import uuid
from datetime import datetime, timezone

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy.orm import Session

from models.plan import ResearchPlan
from models.session import ResearchSession
from models.task import ResearchTask

CANONICAL_AREAS = ["Business", "Financial", "Competitive", "Risks", "Recent Developments"]

SYSTEM_PROMPT = (
    "You are a research planner. Given a company and a research objective, produce a plan "
    "covering exactly these 5 canonical areas: Business, Financial, Competitive, Risks, "
    "Recent Developments. For each area, write exactly one concrete, specific research "
    "objective adapted to the given company and question — not generic boilerplate. "
    "Also include a short rationale for the plan as a whole. The `areas` field must list "
    "exactly these 5 area names, and `tasks` must contain exactly one task per area."
)


class PlannerInput(BaseModel):
    session_id: uuid.UUID
    company_name: str
    interpreted_objective: str


class PlannerTaskItem(BaseModel):
    area: str
    objective: str


class PlannerOutput(BaseModel):
    areas: list[str]
    tasks: list[PlannerTaskItem]
    rationale: str


def _missing_areas(tasks: list[PlannerTaskItem]) -> list[str]:
    covered = {t.area.strip().lower() for t in tasks}
    return [area for area in CANONICAL_AREAS if area.lower() not in covered]


async def research_planner(input: PlannerInput, db: Session) -> PlannerOutput:
    llm = ChatOpenAI(model="gpt-4o-mini")
    structured_llm = llm.with_structured_output(PlannerOutput)

    user_content = (
        f"Company: {input.company_name}\nResearch objective: {input.interpreted_objective}"
    )
    messages = [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]

    output: PlannerOutput = await structured_llm.ainvoke(messages)

    missing = _missing_areas(output.tasks)
    if missing:
        corrective = HumanMessage(
            content=(
                f"Your plan was missing these required areas: {', '.join(missing)}. "
                f"Redo the full plan so that `tasks` contains exactly one task for each "
                f"of these 5 areas: {', '.join(CANONICAL_AREAS)}."
            )
        )
        output = await structured_llm.ainvoke(messages + [corrective])
        missing = _missing_areas(output.tasks)

    if missing:
        for area in missing:
            if area.lower() not in {a.strip().lower() for a in output.areas}:
                output.areas.append(area)
            output.tasks.append(
                PlannerTaskItem(
                    area=area,
                    objective=f"Assess {area} factors relevant to {input.company_name}",
                )
            )

    plan = ResearchPlan(
        session_id=input.session_id,
        areas=output.areas,
        rationale=output.rationale,
    )
    db.add(plan)
    db.commit()
    db.refresh(plan)

    for task in output.tasks:
        db.add(
            ResearchTask(
                session_id=input.session_id,
                plan_id=plan.id,
                area=task.area,
                objective=task.objective,
                origin="INITIAL_PLAN",
                status="PENDING",
            )
        )
    db.commit()

    session = db.query(ResearchSession).filter(ResearchSession.id == input.session_id).first()
    session.status = "RESEARCHING"
    if session.started_at is None:
        session.started_at = datetime.now(timezone.utc)
    db.commit()

    return output
