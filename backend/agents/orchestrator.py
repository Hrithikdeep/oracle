import uuid
from typing import Literal, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from auth import DEMO_USER_PASSWORD, hash_password
from models.company import Company
from models.session import ResearchSession
from models.user import User

SYSTEM_USER_EMAIL = "system@oracle.local"

SYSTEM_PROMPT = (
    "You extract structured research intent from a user's question about a company. "
    "Identify the company being asked about: if a company hint is given, use it as-is; "
    "otherwise infer the company name from the question. Restate the question as a "
    "clear, one-sentence research objective. Depth is always 'standard' for now."
)


class OrchestratorInput(BaseModel):
    raw_question: str
    company_hint: Optional[str] = None


class OrchestratorOutput(BaseModel):
    company_name: str
    interpreted_objective: str
    depth: Literal["standard"] = "standard"


async def orchestrator(input: OrchestratorInput, db: Session) -> tuple[OrchestratorOutput, uuid.UUID]:
    llm = ChatOpenAI(model="gpt-4o-mini")
    structured_llm = llm.with_structured_output(OrchestratorOutput)

    user_content = f"Question: {input.raw_question}"
    if input.company_hint:
        user_content += f"\nCompany hint: {input.company_hint}"

    output: OrchestratorOutput = await structured_llm.ainvoke(
        [SystemMessage(content=SYSTEM_PROMPT), HumanMessage(content=user_content)]
    )

    company = (
        db.query(Company)
        .filter(func.lower(Company.name) == output.company_name.strip().lower())
        .first()
    )
    if company is None:
        company = Company(name=output.company_name, ticker=None, exchange=None, aliases=[])
        db.add(company)
        db.flush()

    user = db.query(User).filter(User.email == SYSTEM_USER_EMAIL).first()
    if user is None:
        # Defensive: this fallback path only runs if the seeded row is ever
        # missing (e.g. after a manual DB reset) — set the same demo password
        # so login keeps working without a separate re-seed step.
        user = User(email=SYSTEM_USER_EMAIL, name="System", password_hash=hash_password(DEMO_USER_PASSWORD))
        db.add(user)
        db.flush()

    session = ResearchSession(
        question=input.raw_question,
        company_id=company.id,
        user_id=user.id,
        status="CREATED",
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return output, session.id
