from datetime import datetime, timezone

from langgraph.graph import END, StateGraph
from sqlalchemy.orm import Session

from agents.evidence_agent import evidence_agent
from agents.orchestrator import OrchestratorInput, orchestrator
from agents.research_planner import PlannerInput, research_planner
from agents.risk_contradiction import run_risk_contradiction_agent
from agents.synthesis import run_synthesis
from agents.verification import verify_all_findings
from models.company import Company
from models.session import ResearchSession
from models.task import ResearchTask
from retrieval.sec_edgar import lookup_ticker_by_company_name
from services.company_ticker import get_company_ticker
from services.decision_record import snapshot_session
from services.finance_engine import run_finance_engine
from workflows.state import OracleState


def build_oracle_graph(db: Session):
    async def orchestrator_node(state: OracleState) -> dict:
        try:
            output, session_id = await orchestrator(
                OrchestratorInput(raw_question=state.question, company_hint=state.company_hint),
                db,
            )
        except Exception as exc:
            return {"error": str(exc), "status": "FAILED"}

        ticker = None
        try:
            ticker = await lookup_ticker_by_company_name(output.company_name)
        except Exception as exc:
            print(f"[orchestrator_node] ticker lookup failed for {output.company_name!r}: {exc}")

        if ticker:
            print(f"[orchestrator_node] resolved ticker {ticker!r} for {output.company_name!r}")
            session_row = db.query(ResearchSession).filter(ResearchSession.id == session_id).first()
            company = db.query(Company).filter(Company.id == session_row.company_id).first()
            if company is not None and not company.ticker:
                company.ticker = ticker
                db.commit()
        else:
            print(
                f"[orchestrator_node] no ticker resolution for {output.company_name!r} "
                f"(best-effort only) — continuing without one"
            )

        return {
            "session_id": session_id,
            "company_name": output.company_name,
            "interpreted_objective": output.interpreted_objective,
            "status": "RESEARCHING",
        }

    async def planner_node(state: OracleState) -> dict:
        if state.error:
            return {}

        try:
            output = await research_planner(
                PlannerInput(
                    session_id=state.session_id,
                    company_name=state.company_name,
                    interpreted_objective=state.interpreted_objective,
                ),
                db,
            )
        except Exception as exc:
            return {"error": str(exc), "status": "FAILED"}

        task_rows = (
            db.query(ResearchTask).filter(ResearchTask.session_id == state.session_id).all()
        )
        tasks = [{"id": str(t.id), "area": t.area, "objective": t.objective} for t in task_rows]
        plan = {"areas": output.areas, "rationale": output.rationale}

        # All 5 canonical-area tasks are eligible to run — evidence_node loops
        # over every ResearchTask row for this session itself, sequentially.
        # No single-task selection here anymore (target_area is no longer
        # consulted).
        return {"plan": plan, "tasks": tasks}

    async def finance_node(state: OracleState) -> dict:
        if state.error:
            return {}

        # Company.ticker, not this run's lookup result: the same source evidence_agent
        # uses, so the two steps can never disagree about which company this is.
        ticker = get_company_ticker(state.session_id, db)
        if not ticker:
            print(
                f"[finance_node] Company.ticker is null for {state.company_name!r} — "
                f"skipping finance engine for this run"
            )
            return {}

        try:
            session_row = (
                db.query(ResearchSession).filter(ResearchSession.id == state.session_id).first()
            )
            observations = await run_finance_engine(
                ticker, state.session_id, session_row.company_id, db
            )
        except Exception as exc:
            # Finance data is supplementary company-level enrichment, not required
            # for the pipeline to succeed — a failure here should not fail the task.
            print(f"[finance_node] FAILED for ticker {ticker!r}: {exc}")
            return {}

        financial_observations = [
            {
                "metric": o.metric,
                "value": o.value,
                "unit": o.unit,
                "period": o.period,
                "observation_type": o.observation_type,
            }
            for o in observations
        ]
        print(f"[finance_node] Company.ticker={ticker!r}: {len(financial_observations)} financial observation(s) persisted")

        return {"financial_observations": financial_observations}

    async def evidence_node(state: OracleState) -> dict:
        if state.error:
            return {}

        task_rows = (
            db.query(ResearchTask).filter(ResearchTask.session_id == state.session_id).all()
        )

        answers: list[str] = []
        any_evidence = False
        for i, task in enumerate(task_rows):
            try:
                output = await evidence_agent(
                    task_id=task.id,
                    company_name=state.company_name,
                    session_id=state.session_id,
                    db=db,
                    # Only parse the uploaded PDF once, on the first task —
                    # hybrid_retrieve() is already session-wide (not
                    # task-scoped, confirmed by reading retrieval/
                    # hybrid_retrieval.py's SQL), so every later task's
                    # retrieval already sees the same chunks without
                    # re-parsing and re-embedding the same file 5 times.
                    pdf_path=state.pdf_path if i == 0 else None,
                )
            except Exception as exc:
                # One area's evidence gathering failing should not abort the
                # other 4 — isolate the failure to this task's own row and
                # keep going, same non-fatal philosophy already used for
                # risk_node/verification_node/synthesis_node below.
                print(f"[evidence_node] FAILED for task {task.id} (area={task.area!r}): {exc}")
                task.status = "FAILED"
                db.commit()
                continue

            answers.append(f"{task.area}: {output.answer}")
            if len(output.evidence_items) > 0:
                any_evidence = True

        final_status = "COMPLETED" if any_evidence else "COMPLETED_WITH_LIMITATIONS"

        session = db.query(ResearchSession).filter(ResearchSession.id == state.session_id).first()
        session.status = final_status
        session.completed_at = datetime.now(timezone.utc)
        db.commit()

        return {"evidence_answer": "\n\n".join(answers), "status": final_status}

    async def risk_node(state: OracleState) -> dict:
        if state.error:
            return {}

        try:
            summary = await run_risk_contradiction_agent(state.session_id, state.company_name, db)
        except Exception as exc:
            # Risk/contradiction analysis is an enrichment layer on top of already-
            # persisted evidence — a failure here shouldn't retroactively fail a
            # session whose core research already succeeded.
            print(f"[risk_node] FAILED: {exc}")
            return {}

        print(
            f"[risk_node] risks_found={summary['risks_found']} "
            f"contradictions_found={summary['contradictions_found']}"
        )
        return {
            "risks_found": summary["risks_found"],
            "contradictions_found": summary["contradictions_found"],
        }

    async def verification_node(state: OracleState) -> dict:
        if state.error:
            return {}

        try:
            verifications = await verify_all_findings(state.session_id, db)
        except Exception as exc:
            print(f"[verification_node] FAILED: {exc}")
            return {}

        # verify_all_findings() only verifies findings that don't already have a
        # Verification row, so this summary reflects NEWLY verified findings in
        # this run, not necessarily every finding ever verified for the session.
        status_counts: dict[str, int] = {}
        for v in verifications:
            status_counts[v.status] = status_counts.get(v.status, 0) + 1
        print(f"[verification_node] verified {len(verifications)} new finding(s): {status_counts}")

        return {"verification_summary": status_counts}

    async def synthesis_node(state: OracleState) -> dict:
        if state.error:
            return {}

        try:
            await run_synthesis(state.session_id, state.company_name, db)
        except Exception as exc:
            print(f"[synthesis_node] FAILED: {exc}")
            return {"report_ready": False}

        print("[synthesis_node] report generated")
        return {"report_ready": True}

    async def decision_record_node(state: OracleState) -> dict:
        if state.error:
            return {}

        try:
            snapshot_session(state.session_id, db)
        except Exception as exc:
            print(f"[decision_record_node] FAILED: {exc}")
            return {"decision_record_created": False}

        print("[decision_record_node] snapshot taken")
        return {"decision_record_created": True}

    graph = StateGraph(OracleState)
    graph.add_node("orchestrator_node", orchestrator_node)
    graph.add_node("planner_node", planner_node)
    graph.add_node("finance_node", finance_node)
    graph.add_node("evidence_node", evidence_node)
    graph.add_node("risk_node", risk_node)
    graph.add_node("verification_node", verification_node)
    graph.add_node("synthesis_node", synthesis_node)
    graph.add_node("decision_record_node", decision_record_node)
    graph.set_entry_point("orchestrator_node")
    graph.add_edge("orchestrator_node", "planner_node")
    graph.add_edge("planner_node", "finance_node")
    graph.add_edge("finance_node", "evidence_node")
    graph.add_edge("evidence_node", "risk_node")
    graph.add_edge("risk_node", "verification_node")
    graph.add_edge("verification_node", "synthesis_node")
    graph.add_edge("synthesis_node", "decision_record_node")
    graph.add_edge("decision_record_node", END)

    return graph.compile()


async def run_oracle_workflow(
    question: str,
    db: Session,
    pdf_path: str | None = None,
    company_hint: str | None = None,
    target_area: str = "Financial",
) -> OracleState:
    graph = build_oracle_graph(db)
    initial_state = OracleState(
        question=question,
        pdf_path=pdf_path,
        company_hint=company_hint,
        target_area=target_area,
    )
    result = await graph.ainvoke(initial_state.model_dump())
    return OracleState(**result)
