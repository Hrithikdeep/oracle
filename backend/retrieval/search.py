import asyncio
from urllib.parse import urlparse

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_openai import ChatOpenAI
from pydantic import BaseModel
from tavily import TavilyClient

from agents.source_intelligence import CandidateSource, RankedSource, rank_sources
from config import TAVILY_API_KEY

QUERY_SYSTEM_PROMPT = (
    "You generate real web search queries for investment research. Given a company name "
    "and a research task's objective, produce 2 to 4 targeted search queries a human "
    "analyst would actually type into a search engine to find relevant information. "
    "Queries must be specific and searchable (include the company name, relevant "
    "keywords, timeframes, or metrics as appropriate) — not vague phrases like "
    "'company information' or 'company overview'."
)


class SearchQueries(BaseModel):
    queries: list[str]


async def generate_search_queries(company_name: str, task_objective: str) -> list[str]:
    llm = ChatOpenAI(model="gpt-4o-mini").with_structured_output(SearchQueries)
    user_content = f"Company: {company_name}\nResearch objective: {task_objective}"

    output: SearchQueries = await llm.ainvoke(
        [SystemMessage(content=QUERY_SYSTEM_PROMPT), HumanMessage(content=user_content)]
    ) # type: ignore
    return output.queries


def _derive_publisher(url: str) -> str | None:
    domain = urlparse(url).netloc.lower()
    if domain.startswith("www."):
        domain = domain[len("www."):]
    return domain or None


async def tavily_search(query: str, max_results: int = 8) -> list[CandidateSource]:
    try:
        client = TavilyClient(api_key=TAVILY_API_KEY)
        response = await asyncio.to_thread(client.search, query=query, max_results=max_results)
    except Exception as exc:
        print(f"[tavily_search] FAILED for query {query!r}: {exc}")
        return []

    candidates = []
    for result in response.get("results", []):
        url = result.get("url")
        if not url:
            continue
        candidates.append(
            CandidateSource(
                url=url,
                title=result.get("title") or url,
                publisher=result.get("publisher") or _derive_publisher(url),
                snippet=result.get("content"),
                published_date=result.get("published_date"),
            )
        )
    return candidates


async def discover_sources(company_name: str, task_objective: str) -> list[RankedSource]:
    queries = await generate_search_queries(company_name, task_objective)

    results = await asyncio.gather(*(tavily_search(query) for query in queries))

    all_candidates: list[CandidateSource] = []
    for candidate_list in results:
        all_candidates.extend(candidate_list)

    return rank_sources(all_candidates)
