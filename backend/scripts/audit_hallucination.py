"""Hallucination audit: sample recent findings across sessions and check each one three ways.

  1. GROUNDING   every linked evidence row's verbatim_quote appears in its source document's
                 raw_text (same exact-content check as evidence_agent._quote_in_chunk). Rows
                 created before verbatim_quote existed only have a paraphrased observation; that
                 is checked too but can't be expected to match verbatim, so it is reported as
                 UNVERIFIABLE, not as a failure.
  2. OVERREACH   an LLM judge (gpt-4o by default, temperature 0, majority of 3 votes) reads the
                 statement against the evidence (quote preferred, observation as fallback), any
                 linked Finance Engine rows, and the linked-source passages containing each
                 figure the statement cites. It says whether the statement follows strictly,
                 adds unsupported inference, or contradicts. Only contradictions and MATERIAL
                 unsupported claims (a specific number, date, entity or causal fact the evidence
                 doesn't contain) fail.
  2b. FIGURES    deterministic: every figure the statement cites must appear in a linked
                 source's raw_text / stored quote (allowing "$269.9 billion" == "269,912"), match
                 a linked Finance Engine value, or be simple growth arithmetic between two traced
                 figures in the same statement. Catches invented numbers an LLM judge waves
                 through.
  3. FINANCIAL   for findings linked to FinancialObservation rows: every id resolves to a real
                 row of the same session, and every figure the statement quotes that looks like
                 one of the linked metrics matches a linked value (after rounding).

Read-only: never writes to the DB.

Usage:
    python scripts/audit_hallucination.py [--n 20] [--session <uuid>] [--judge-model gpt-4o-mini] [--json out.json]
"""
import argparse
import asyncio
import json
import re
import sys
import uuid
from pathlib import Path
from typing import Literal

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from openai import RateLimitError
from pydantic import BaseModel
from sqlalchemy import text

from agents.evidence_agent import _quote_in_chunk
from agents.verification import _evidence_for_finding
from database import SessionLocal
from models.document import Document
from models.financial_observation import FinancialObservation
from models.finding import Finding

JUDGE_SYSTEM_PROMPT = (
    "You audit a research finding for hallucination. You are given the finding's statement "
    "and ALL the evidence it is based on. Decide strictly from that evidence:\n"
    "- STRICT: every factual claim in the statement is stated in, or directly follows from, "
    "the evidence.\n"
    "- UNSUPPORTED_INFERENCE: the statement adds claims the evidence does not contain.\n"
    "- CONTRADICTS: the statement conflicts with the evidence (wrong number, wrong period, "
    "reversed direction, wrong entity).\n"
    "List each unsupported or contradicted claim. Rate severity MATERIAL if any listed claim "
    "is a specific fact a reader would rely on (a number, percentage, date/period, named "
    "company/product/place, or a causal claim presented as fact); MINOR if the additions are "
    "only generic framing, hedged speculation ('could', 'may') or evaluative adjectives; "
    "NONE if nothing is listed. A statement that only says evidence is missing makes no "
    "factual claim and is STRICT. Be precise: do not flag a claim that the evidence supports "
    "in different words."
)


class JudgeVerdict(BaseModel):
    verdict: Literal["STRICT", "UNSUPPORTED_INFERENCE", "CONTRADICTS"]
    severity: Literal["NONE", "MINOR", "MATERIAL"]
    unsupported_claims: list[str]
    reason: str


# ---------- sampling ----------

def sample_findings(db, n: int, session_id: str | None) -> list[Finding]:
    """Newest findings, round-robin across sessions (newest session first) so one big
    session can't fill the whole sample, and within a session round-robin across areas —
    the risk agent writes its findings last, so plain newest-first would sample only Risks."""

    def area_interleaved(sid, offset=0):
        rows = db.query(Finding).filter(Finding.session_id == sid).order_by(Finding.created_at.desc()).all()
        by_area: dict[str, list[Finding]] = {}
        for f in rows:
            by_area.setdefault(f.area, []).append(f)
        # each session starts its area rotation at a different area, otherwise the first
        # pick of every session is its newest area (always Risks)
        lists = sorted(by_area.values(), key=lambda lst: lst[0].area)
        lists = lists[offset % len(lists):] + lists[: offset % len(lists)] if lists else lists
        out, i = [], 0
        while len(out) < len(rows):
            out += [lst[i] for lst in lists if i < len(lst)]
            i += 1
        return out

    if session_id:
        return area_interleaved(uuid.UUID(session_id))[:n]
    session_ids = [r[0] for r in db.execute(text(
        "SELECT session_id FROM findings GROUP BY session_id ORDER BY max(created_at) DESC"))]
    per_session = {sid: area_interleaved(sid, k) for k, sid in enumerate(session_ids)}
    picked, depth = [], 0
    while len(picked) < n and any(len(v) > depth for v in per_session.values()):
        for sid in session_ids:
            if depth < len(per_session[sid]) and len(picked) < n:
                picked.append(per_session[sid][depth])
        depth += 1
    return picked


# ---------- check 1: grounding ----------

def check_grounding(evidence_rows, db) -> dict:
    if not evidence_rows:
        return {"result": "N/A", "reason": "no evidence linked", "checked": 0, "legacy": 0, "failed": []}
    failed, legacy, checked = [], 0, 0
    for e in evidence_rows:
        raws = [d.raw_text for d in db.query(Document).filter(Document.source_id == e.source_id).all()]
        if e.verbatim_quote:
            checked += 1
            if not any(_quote_in_chunk(e.verbatim_quote, raw) for raw in raws):
                failed.append(f"evidence {str(e.id)[:8]}: quote not in source raw_text: {e.verbatim_quote[:90]!r}")
        else:
            # Pre-quote row: all we have is the paraphrase. Checked as asked, but a paraphrase
            # is not supposed to be verbatim, so a miss here is not evidence of hallucination.
            legacy += 1
            if any(_quote_in_chunk(e.observation, raw) for raw in raws):
                checked += 1
    if failed:
        return {"result": "FAIL", "reason": "; ".join(failed), "checked": checked, "legacy": legacy, "failed": failed}
    if checked == 0:
        return {"result": "UNVERIFIABLE", "reason": f"{legacy} legacy row(s) with no stored quote",
                "checked": 0, "legacy": legacy, "failed": []}
    note = f"{checked}/{len(evidence_rows)} verbatim in source" + (f", {legacy} legacy (no quote)" if legacy else "")
    return {"result": "PASS", "reason": note, "checked": checked, "legacy": legacy, "failed": []}


# ---------- check 2: overreach ----------

def _source_excerpts(finding, evidence_rows, fos, db, width=160, cap=6) -> list[str]:
    """For every figure the statement cites, the passage of a LINKED source document that
    contains it. Legacy evidence rows only kept a paraphrase that usually drops the numbers,
    so without this the judge would call real figures unsupported (seen in practice). Uses the
    same boundary/unit-aware patterns as check_figures — a plain substring search once handed
    the judge "$ 12.8 billion" as the source of "-2.8%"."""
    raws = [re.sub(r"\s+", " ", d.raw_text) for sid in {e.source_id for e in evidence_rows}
            for d in db.query(Document).filter(Document.source_id == sid).all()]
    excerpts = []
    for raw_fig, raw_num, value, unit in _statement_figures(finding.statement):
        if _matches_fo(value, unit, fos):
            continue  # already shown to the judge as a Finance Engine row
        for raw in raws:
            m = next((m for p in _figure_patterns(raw_num, value, unit) if (m := re.search(p, raw))), None)
            if m:
                snippet = raw[max(0, m.start() - width): m.end() + width]
                excerpts.append(f"- '{raw_fig}' appears in a linked source: \"...{snippet}...\"")
                break
        if len(excerpts) >= cap:
            break
    return excerpts


def _evidence_block(evidence_rows, fos, excerpts) -> str:
    lines = []
    for e in evidence_rows:
        if e.verbatim_quote:
            lines.append(f'- Source quote (verified verbatim): "{e.verbatim_quote}"\n  Summary: {e.observation}')
        else:
            lines.append(f"- Summary of source (no verbatim quote stored): {e.observation}")
    for fo in fos:
        lines.append(f"- Finance Engine ({fo.observation_type}, {fo.source}): {fo.metric} {fo.period} = {fo.value} {fo.unit}")
    if excerpts:
        lines.append("Source passages containing figures cited in the statement (mechanically located in the "
                     "linked source documents; check the figure's period/label against them too):")
        lines += excerpts
    return "\n".join(lines) or "(no evidence)"


JUDGE_VOTES = 3  # gpt-4o-mini isn't stable even at temperature 0; fail only on a majority
# gpt-4o, not mini: on the first 20-finding sample mini flagged 5 findings of which 3 were
# false positives (it called figures quoted verbatim in the evidence "unsupported"); gpt-4o
# flagged 1. Pass --judge-model gpt-4o-mini for a cheaper, noisier run.
JUDGE_MODEL = "gpt-4o"


async def check_overreach(finding, evidence_rows, fos, sem, db) -> dict:
    statement = finding.statement + (f"\nInterpretation: {finding.interpretation}" if finding.interpretation else "")
    excerpts = _source_excerpts(finding, evidence_rows, fos, db)
    content = f"Finding statement:\n{statement}\n\nEvidence:\n{_evidence_block(evidence_rows, fos, excerpts)}"

    async def one_vote() -> JudgeVerdict:
        async with sem:
            llm = ChatOpenAI(model=JUDGE_MODEL, temperature=0).with_structured_output(JudgeVerdict)
            # gpt-4o on this account is capped at 30k tokens/min, and the limit window is a
            # full minute, so back off in seconds rather than the client's sub-second retries
            for attempt in range(8):
                try:
                    return await llm.ainvoke([SystemMessage(content=JUDGE_SYSTEM_PROMPT), HumanMessage(content=content)])
                except RateLimitError:
                    if attempt == 7:
                        raise
                    await asyncio.sleep(min(2 ** attempt * 2, 30))

    votes = await asyncio.gather(*[one_vote() for _ in range(JUDGE_VOTES)])
    is_fail = [v.verdict == "CONTRADICTS" or (v.verdict == "UNSUPPORTED_INFERENCE" and v.severity == "MATERIAL") for v in votes]
    fail = sum(is_fail) * 2 > len(votes)
    # report the reasoning of a vote that agrees with the majority
    v = next(v for v, f in zip(votes, is_fail) if f == fail)
    tally = f"{sum(is_fail)}/{len(votes)} votes fail"
    return {
        "result": "FAIL" if fail else "PASS",
        "verdict": v.verdict, "severity": v.severity, "votes": tally,
        "unsupported_claims": v.unsupported_claims,
        "reason": f"[{tally}] " + (v.reason if fail else (f"{v.verdict}/{v.severity}" + (f": {'; '.join(v.unsupported_claims)}" if v.unsupported_claims else ""))),
    }


# ---------- check 2b: figure traceability (deterministic) ----------
#
# Added after the first runs: an LLM judge (either model) can wave through a statement whose
# figures come from nowhere in its evidence — a Costco finding cited "$269,912 million in
# 2025" when its linked source was the FY2021 10-K, and gpt-4o passed it. A number either is
# in the linked sources or it isn't, so this is checked mechanically.

_FIGURE_RE = re.compile(r"(-?\$?\s?)(\d[\d,]*(?:\.\d+)?)\s*(%|percent|billion|million|trillion)?", re.I)


def _statement_figures(statement: str) -> list[tuple[str, str, float, str]]:
    """(as written, number text, value, unit) for every figure the statement cites."""
    out = []
    for m in _FIGURE_RE.finditer(statement):
        num, unit = m.group(2).rstrip(".,"), (m.group(3) or "").lower()
        digits = num.replace(",", "").replace(".", "")
        if not unit and (re.fullmatch(r"(19|20)\d\d", num) or len(digits) < 2):
            continue  # years, and bare single digits ("3 fiscal years", "Q4")
        out.append((m.group(0).strip(), num, float(num.replace(",", "")), unit))
    return out


def _figure_patterns(raw_num: str, value: float, unit: str) -> list[str]:
    patterns = [re.escape(raw_num)]
    if unit in ("%", "percent"):
        # a percentage must appear AS a percentage, not just as any occurrence of the digits
        patterns = [re.escape(raw_num) + r"\s?(?:%|percent)"]
    elif unit in ("billion", "trillion"):
        # "$269.9 billion" is "269,912" in a filing reported in millions
        scale = 1000 if unit == "billion" else 1_000_000
        millions = value * scale
        whole, _, frac = raw_num.replace(",", "").partition(".")
        if len(frac) >= 3:
            patterns.append(re.escape(f"{round(millions):,}"))
        else:
            lead = f"{int(millions):,}"[: len(f"{int(value):,}") + 1 + len(frac)]
            patterns.append(re.escape(lead) + r"\d*")
    return [rf"(?<![\d.,]){p}(?![\d])" for p in patterns]


def _found_in(text_: str, raw_num: str, value: float, unit: str) -> bool:
    return any(re.search(p, text_) for p in _figure_patterns(raw_num, value, unit))


def _matches_fo(value: float, unit: str, fos) -> bool:
    millions = value * {"billion": 1000, "trillion": 1_000_000}.get(unit, 1)
    return any(abs(abs(fo.value) - abs(x)) <= max(0.051, abs(fo.value) * 0.005) for fo in fos for x in (value, millions))


def check_figures(finding, evidence_rows, fos, db) -> dict:
    figures = _statement_figures(finding.statement)
    if not figures:
        return {"result": "N/A", "reason": "statement cites no figures"}
    sources = [re.sub(r"\s+", " ", d.raw_text) for sid in {e.source_id for e in evidence_rows}
               for d in db.query(Document).filter(Document.source_id == sid).all()]
    sources += [e.verbatim_quote for e in evidence_rows if e.verbatim_quote]
    paraphrases = " ".join(e.observation for e in evidence_rows)

    status = {}
    for raw, raw_num, value, unit in figures:
        if any(_found_in(s, raw_num, value, unit) for s in sources) or _matches_fo(value, unit, fos):
            status[raw] = "traced"
        elif _found_in(paraphrases, raw_num, value, unit):
            status[raw] = "paraphrase-only"
        else:
            status[raw] = "untraced"

    # a percentage the statement derives from two of its own traced figures (e.g. "a 4%
    # increase from $201,183 million to $209,586 million") is arithmetic, not invention
    traced_vals = [v for (r, _, v, u) in figures if status[r] == "traced" and u not in ("%", "percent")]
    for raw, _, value, unit in figures:
        if status[raw] != "traced" and unit in ("%", "percent"):
            if any(a and abs((b / a - 1) * 100 - abs(value)) <= 0.6 for a in traced_vals for b in traced_vals if a != b):
                status[raw] = "traced"

    # "paraphrase-only" is a failure too: the full raw_text of every linked source was
    # searched, so a figure that exists only in an LLM-written observation was put there by
    # the model, not taken from the source (the $269,912M case above).
    untraced = [r for r, s in status.items() if s == "untraced"]
    para_only = [r for r, s in status.items() if s == "paraphrase-only"]
    if untraced or para_only:
        parts = []
        if para_only:
            parts.append(f"only in an LLM-written observation, not in any linked source text: {para_only}")
        if untraced:
            parts.append(f"in no linked source, quote, observation or Finance Engine row: {untraced}")
        return {"result": "FAIL", "reason": "; ".join(parts)}
    n = len(status)
    return {"result": "PASS", "reason": f"all {n} figure(s) traced to a linked source or Finance Engine row"}


# ---------- check 3: financial linkage ----------

_METRIC_WORDS = {
    "total_revenue": r"revenue|net sales|sales",
    "operating_income": r"operating income",
    "net_income": r"net income|earnings|profit",
    "revenue_growth_yoy": r"growth|grew|increase|decrease|decline",
    "operating_margin": r"operating margin|margin",
}


def check_financial(finding, db) -> tuple[dict, list[FinancialObservation]]:
    ids = finding.financial_observation_ids or []
    if not ids:
        return {"result": "N/A", "reason": "no financial observations linked"}, []
    fos = db.query(FinancialObservation).filter(
        FinancialObservation.id.in_([uuid.UUID(str(i)) for i in ids])).all()
    problems = []
    if len(fos) != len(ids):
        problems.append(f"{len(ids) - len(fos)} linked id(s) don't resolve to a real row")
    foreign = [fo for fo in fos if fo.session_id != finding.session_id]
    if foreign:
        problems.append(f"{len(foreign)} linked row(s) belong to a different session")
    # every percentage / figure in the statement that sits next to a linked metric's wording
    # must equal (after rounding) one of the linked values
    linked_vals = [fo.value for fo in fos]
    for fo in fos:
        words = _METRIC_WORDS.get(fo.metric)
        if not words:
            continue
        for m in re.finditer(rf"(?:{words})[^.;]{{0,80}}?(-?\d[\d,]*(?:\.\d+)?)\s*(%|percent|billion|million)?",
                             finding.statement, re.I):
            num = float(m.group(1).replace(",", ""))
            unit = (m.group(2) or "").lower()
            if 1900 <= num <= 2100 and not unit:
                continue  # a year, not a figure
            candidates = [num, num * 1000 if unit == "billion" else num]
            # direction is often carried by words ("a decline of 2.8%" for -2.8), so compare
            # magnitudes — the question here is whether the figure is real, not its phrasing
            if not any(abs(abs(c) - abs(v)) <= max(0.051, abs(v) * 0.005) for c in candidates for v in linked_vals):
                problems.append(f"statement figure {m.group(0)[-40:]!r} matches no linked value {sorted(set(linked_vals))}")
    if problems:
        return {"result": "FAIL", "reason": "; ".join(dict.fromkeys(problems))}, fos
    desc = ", ".join(f"{fo.metric} {fo.period}={fo.value:g}" for fo in fos)
    return {"result": "PASS", "reason": f"{len(fos)} real row(s): {desc}"}, fos


# ---------- driver ----------

async def audit(n: int, session_id: str | None) -> list[dict]:
    db = SessionLocal()
    sem = asyncio.Semaphore(8 if JUDGE_MODEL.endswith("mini") else 1)
    findings = sample_findings(db, n, session_id)
    prepared = []
    for f in findings:
        evidence_rows = _evidence_for_finding(f, db)
        fin, fos = check_financial(f, db)
        prepared.append((f, evidence_rows, check_grounding(evidence_rows, db), fin, fos,
                         check_figures(f, evidence_rows, fos, db)))
    judged = await asyncio.gather(*[check_overreach(f, ev, fos, sem, db) for f, ev, _, _, fos, _ in prepared])
    rows = []
    for (f, ev, grounding, fin, _, figures), over in zip(prepared, judged):
        company = db.execute(text("SELECT c.name FROM research_sessions s JOIN companies c ON c.id=s.company_id WHERE s.id=:s"),
                             {"s": f.session_id}).scalar()
        status = f.verification.status if f.verification else "NOT_VERIFIED"
        rows.append({
            "finding_id": str(f.id), "session_id": str(f.session_id), "company": company, "area": f.area,
            "verification": status, "statement": f.statement, "evidence_count": len(ev),
            "grounding": grounding, "overreach": over, "figures": figures, "financial": fin,
            "issue": any(c["result"] == "FAIL" for c in (grounding, over, figures, fin)),
        })
    db.close()
    return rows


def print_table(rows: list[dict]) -> None:
    print(f"{'#':>2}  {'finding':8} {'company':14} {'area':12} {'verified as':26} {'ev':>2} | {'GROUND':12} {'OVERREACH':9} {'FIGURES':7} {'FINANCIAL':9} | ISSUE")
    for i, r in enumerate(rows, 1):
        print(f"{i:>2}  {r['finding_id'][:8]} {(r['company'] or '?')[:14]:14} {r['area'][:12]:12} {r['verification'][:26]:26} "
              f"{r['evidence_count']:>2} | {r['grounding']['result']:12} {r['overreach']['result']:9} {r['figures']['result']:7} {r['financial']['result']:9} | "
              f"{'YES' if r['issue'] else ''}")
    print("\nReasons for failures:")
    any_fail = False
    for i, r in enumerate(rows, 1):
        for check in ("grounding", "overreach", "figures", "financial"):
            if r[check]["result"] == "FAIL":
                any_fail = True
                print(f"  #{i} {r['finding_id'][:8]} {check.upper()}: {r[check]['reason']}")
    if not any_fail:
        print("  (none)")
    issues = sum(r["issue"] for r in rows)
    unverifiable = sum(r["grounding"]["result"] == "UNVERIFIABLE" for r in rows)
    print(f"\nOverall hallucination rate: {issues}/{len(rows)} findings = {100 * issues / max(len(rows), 1):.0f}% "
          f"have at least one real issue")
    print(f"(grounding UNVERIFIABLE for {unverifiable} finding(s): evidence predates stored quotes)")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--n", type=int, default=20)
    parser.add_argument("--session", default=None, help="limit to one session id")
    parser.add_argument("--json", default=None, help="also write full per-finding results here")
    parser.add_argument("--judge-model", default=JUDGE_MODEL, help="LLM for the overreach judge (default %(default)s)")
    args = parser.parse_args()
    globals()["JUDGE_MODEL"] = args.judge_model
    rows = asyncio.run(audit(args.n, args.session))
    print_table(rows)
    if args.json:
        Path(args.json).write_text(json.dumps(rows, indent=1))


if __name__ == "__main__":
    main()
