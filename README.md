# Oracle — Private AI for Financial Intelligence

**A multi-agent financial research platform that auto-discovers sources, extracts evidence with provenance validation, computes real financial metrics deterministically, detects contradictions across sources, and verifies every finding before it reaches a report.**

🔗 **[Live Demo](https://oracle-drab-phi.vercel.app)** — demo credentials are shown on the login page.

---

## What Oracle Does

Ask a question like *"Analyze Apple's financial risks and recent performance"* and Oracle:

1. Resolves the company and decomposes the question into 5 research areas (Business, Financial, Competitive, Risks, Recent Developments)
2. Auto-discovers sources — SEC filings, earnings materials, news — via SEC EDGAR and web search, ranked by authority
3. Extracts evidence with **provenance validation**: every quote is mechanically confirmed to be a real, exact substring of the source document before it's trusted
4. Computes financial metrics deterministically from real market data (yfinance + pandas — no LLM does arithmetic)
5. Detects contradictions across sources, both deterministically (conflicting numeric claims) and via LLM-assisted semantic analysis
6. Independently **re-verifies every finding** before synthesis — a finding an LLM generated is never trusted at face value
7. Synthesizes a report from only the findings that survived verification; anything that didn't gets an honest "insufficient evidence" limitation instead of being silently dropped

This is a **portfolio project, not a startup** — the startup version was shelved after September 2026 competitive research showed the "AI financial research with citations" space fully saturated by OpenAI, Anthropic, Google, Bloomberg, and a dozen funded startups. It now exists purely to demonstrate agentic-system depth: real multi-agent orchestration, real deterministic/probabilistic separation, and a level of end-to-end verification most portfolio projects don't attempt.

---

## Architecture

Built on **LangGraph's `StateGraph`** — 7 LLM-driven reasoning agents and 3 deterministic services, not a single prompt-chaining loop.

```
orchestrator_node → planner_node → finance_node → evidence_node (×5, sequential fan-out)
  → risk_node → verification_node → synthesis_node → decision_record_node → END
```

### 7 Reasoning Agents

| Agent | What it does |
|---|---|
| **Orchestrator** | Resolves/creates the company record, starts the session |
| **Research Planner** | Decomposes the question into 5 canonical research areas |
| **Source Intelligence** | Ranks sources by authority (SEC filing > earnings material > news > web) — deterministic classification, no LLM |
| **Evidence Agent** | Auto-discovers sources, chunks and embeds text, hybrid (keyword + vector) retrieval, extracts evidence with provenance validation |
| **Risk & Contradiction Agent** | Deterministic numeric-contradiction check + LLM-assisted semantic contradiction detection and risk identification, with every model-stated ID re-verified against the real database |
| **Synthesis Agent** | Writes the narrative report from *only* verified findings; unverified findings become explicit limitations, never silently dropped |
| **Verification Engine** | Deterministic checks + LLM challenge with model-tier separation (a smaller model generates, a larger model independently challenges) |

### 3 Deterministic Services (zero LLM involvement)

| Service | What it does |
|---|---|
| **Finance Engine** | Real financial metrics from yfinance + pandas — proven deterministic and sign-correct (catches real declines, not just growth) |
| **Re-check Service** | Diffs current session state against the last snapshot to surface what's genuinely changed |
| **Decision Record** | Immutable snapshot of findings, observations, and the report for later comparison |

---

## The Engineering Thesis: Deterministic vs. Probabilistic Separation

Anywhere a fact can be established by real math or a real database lookup, it is — never asked of an LLM. LLMs are used only for genuinely unstructured reasoning: summarizing evidence into narrative, judging whether two statements semantically conflict.

**This was stress-tested, not just claimed:**
- A deliberately weak, unsourced finding was confirmed to correctly fail verification rather than being waved through
- A real financial-observation contradiction was confirmed to force a `CONFLICTING` status even when the LLM's own challenge step was inclined to be charitable
- Every extracted quote is checked against the source document's raw text before being trusted as evidence — an LLM cannot fabricate a citation that passes this check
- Model-stated IDs (which finding, which evidence row a contradiction involves) are never trusted directly — every one is re-matched against the real database

---

## Notable Engineering Work

**Sequential fan-out, investigated before implemented.** The pipeline originally ran only 1 of 5 planned research areas per session. Before writing any code, a full investigation confirmed 4 of the 5 downstream nodes (risk, verification, synthesis, decision-record) already operated on the whole session rather than a single task — meaning they'd correctly aggregate across all 5 areas with zero logic changes once fan-out shipped. A deliberate scope decision was made to ship safe sequential fan-out rather than a riskier fully-parallel LangGraph `Send`-based version, prioritizing demonstrable correctness over wall-clock speed for a portfolio piece.

**A cross-contamination bug the fan-out change revealed.** Once multiple research areas shared one session's document pool, evidence retrieval could surface one area's irrelevant sources for another area's findings — invisible when only one area ever ran. Fixed by scoping source retrieval per-task, with a deliberate exception for user-uploaded documents (relevant to every area equally, verified two independent ways rather than assumed).

**A hallucination class found and fixed via evidence persistence.** Evidence rows originally stored only an LLM's paraphrase of a quote, discarding the verbatim (and mechanically-verified) text. This meant the verification step was blind to the real source wording — proven to cause both false negatives (real, correctly-sourced numbers marked "insufficient evidence") and a missed hallucination (a paraphrase that silently swapped one fiscal year's figures for another's, which the verifier only caught once it could see the real quote).

**A real root-cause dependency gap in retrieval.** Hybrid search's keyword half required every term in a query to match, so any multi-word research objective returned zero keyword hits — retrieval was silently vector-only. Traced to the exact query-construction bug, fixed by matching on any meaningful term (with instruction words like "analyze" filtered out) rather than papering over it by re-weighting scores.

---

## Tech Stack

| | |
|---|---|
| **Backend** | FastAPI, LangGraph, SQLAlchemy + Alembic |
| **Database** | PostgreSQL + pgvector (hybrid keyword/vector retrieval) |
| **LLM** | OpenAI (model-tier separation: smaller model generates, larger model verifies) |
| **Search & data** | Tavily, SEC EDGAR, yfinance |
| **Frontend** | Next.js 16 (App Router), TypeScript, Tailwind, shadcn/ui, Recharts |
| **Auth** | Custom JWT (PyJWT + bcrypt) |
| **Deploy** | Railway (backend + Postgres), Vercel (frontend) |

---

## Design Principle: No Fabricated Data, Anywhere

Every page was built against the real backend's actual capabilities — not against what a UI mockup implied. Where the backend genuinely can't produce something (EBITDA, Free Cash Flow, and several other metrics the Finance Engine doesn't compute; a multi-user team management system that doesn't exist; a background monitoring job that isn't built), the UI says so honestly — "No data," a disabled action with an explanation, or a smaller-but-real feature — rather than displaying a plausible-looking placeholder number. This was verified repeatedly by reading the actual model fields and agent code before building each page, not assumed from the reference design.

---

## Running Locally

```bash
# Backend
cd backend
python -m venv venv && source venv/bin/activate
pip install -r requirements.txt --break-system-packages
docker compose up -d          # Postgres + pgvector
alembic upgrade head
uvicorn main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

Required environment variables (see `.env.example` in each directory):

**Backend:** `DATABASE_URL`, `JWT_SECRET`, `OPENAI_API_KEY`, `TAVILY_API_KEY`
**Frontend:** `NEXT_PUBLIC_API_BASE_URL`

---

## Known, Documented Limitations

- **Single-provider verification** (model-tier separation within one provider) rather than true cross-provider verification — a clear, scoped upgrade path, not an oversight
- **Synchronous pipeline** — a research request blocks for the full multi-minute run rather than returning immediately with progress updates via a job queue
- **Single-user auth** — a demo-appropriate scope decision, not a partial multi-tenant system
- **Sequential, not parallel, fan-out** — correctness-first, with the parallel path fully designed but deliberately not built for this phase

---

## License

MIT
