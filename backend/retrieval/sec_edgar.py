import re

import httpx

from agents.source_intelligence import CandidateSource

SEC_USER_AGENT = "Oracle Research Project research@example.com"
TICKER_MAP_URL = "https://www.sec.gov/files/company_tickers.json"
SUBMISSIONS_URL_TEMPLATE = "https://data.sec.gov/submissions/CIK{cik}.json"
FILING_URL_TEMPLATE = "https://www.sec.gov/Archives/edgar/data/{cik_no_zeros}/{accession_no_dashes}/{primary_document}"

TARGET_FORMS = ("10-K", "10-Q")

# Legal-form words that differ between how a company is named in a question and
# how SEC files it ("Coca-Cola" vs "COCA COLA CO"). Stripped from the END only.
_LEGAL_FORM_TOKENS = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "companies",
    "ltd", "limited", "plc", "llc", "lp", "llp", "nv", "sa", "ag", "se",
}
# SEC appends a state/re-domicile marker to some titles ("COSTCO WHOLESALE CORP /NEW",
# "AMGEN INC /DE/"). Without stripping it, those companies can never match exactly.
_JURISDICTION_MARKER = re.compile(r"\s*[/\\][a-z]{2,4}[/\\]?\s*$")

# Raw list of {"cik_str": int, "ticker": str, "title": str} entries from SEC's
# public ticker map. Cached in-process since the file is large (~10k entries)
# and changes rarely; both the ticker->CIK lookup and the name->ticker lookup
# below derive from this single cached fetch.
_sec_company_data_cache: list[dict] | None = None


async def _load_sec_company_data(client: httpx.AsyncClient) -> list[dict]:
    global _sec_company_data_cache
    if _sec_company_data_cache is not None:
        return _sec_company_data_cache

    response = await client.get(TICKER_MAP_URL, headers={"User-Agent": SEC_USER_AGENT})
    response.raise_for_status()
    data = response.json()

    _sec_company_data_cache = list(data.values())
    return _sec_company_data_cache


async def _load_ticker_to_cik_map(client: httpx.AsyncClient) -> dict[str, int]:
    entries = await _load_sec_company_data(client)
    return {entry["ticker"].upper(): entry["cik_str"] for entry in entries}


def _normalize_company_name(name: str) -> str:
    normalized = name.lower().strip()
    while _JURISDICTION_MARKER.search(normalized):
        normalized = _JURISDICTION_MARKER.sub("", normalized)
    normalized = normalized.replace("&", " and ")
    normalized = re.sub(r"['\u2019`]", "", normalized)
    tokens = re.sub(r"[^a-z0-9]+", " ", normalized).split()
    if tokens and tokens[0] == "the":
        tokens = tokens[1:]
    while tokens and (tokens[-1] in _LEGAL_FORM_TOKENS or tokens[-1] == "and"):
        tokens.pop()
    return " ".join(tokens)


async def lookup_ticker_by_company_name(company_name: str) -> str | None:
    """Company name -> ticker via SEC's own name field: EXACT match on the
    normalized full name only, no prefix/fuzzy fallback. Returns None on no match,
    on a name shared by several distinct SEC registrants, or on any failure.

    A false null is safe (callers fall back to web-only sources and skip the
    finance engine); a false positive is not — it pulls another company's
    filings and financials into the report (the old prefix match resolved
    "Mars Incorporated" to Marsh & McLennan and "Coca-Cola" to Coca-Cola
    Consolidated). Callers must treat None as "skip gracefully", not an error.
    """
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            entries = await _load_sec_company_data(client)
    except Exception as exc:
        print(f"[lookup_ticker_by_company_name] FAILED to load SEC company data: {exc}")
        return None

    target = _normalize_company_name(company_name)
    if not target:
        return None

    matches = [entry for entry in entries if _normalize_company_name(entry["title"]) == target]
    if not matches:
        return None

    # Several share classes of ONE company (GOOGL/GOOG) share a CIK — take SEC's
    # first-listed. Different CIKs behind one normalized name means we can't tell
    # which company was meant.
    if len({entry["cik_str"] for entry in matches}) > 1:
        print(f"[lookup_ticker_by_company_name] {company_name!r} is ambiguous across SEC registrants — no ticker")
        return None

    return matches[0]["ticker"].upper()


async def get_company_filings(ticker: str) -> list[CandidateSource]:
    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            ticker_to_cik = await _load_ticker_to_cik_map(client)
            cik = ticker_to_cik.get(ticker.upper())
            if cik is None:
                print(f"[get_company_filings] unknown ticker: {ticker!r}")
                return []

            cik_padded = str(cik).zfill(10)
            submissions_url = SUBMISSIONS_URL_TEMPLATE.format(cik=cik_padded)
            response = await client.get(submissions_url, headers={"User-Agent": SEC_USER_AGENT})
            response.raise_for_status()
            data = response.json()

            recent = data["filings"]["recent"]
            forms = recent["form"]

            candidates: list[CandidateSource] = []
            seen_forms: set[str] = set()
            for i, form in enumerate(forms):
                if form not in TARGET_FORMS or form in seen_forms:
                    continue
                seen_forms.add(form)

                accession_no_dashes = recent["accessionNumber"][i].replace("-", "")
                primary_document = recent["primaryDocument"][i]
                filing_date = recent["filingDate"][i]

                url = FILING_URL_TEMPLATE.format(
                    cik_no_zeros=cik,
                    accession_no_dashes=accession_no_dashes,
                    primary_document=primary_document,
                )

                candidates.append(
                    CandidateSource(
                        url=url,
                        title=f"{ticker.upper()} {form} filed {filing_date}",
                        publisher="SEC EDGAR",
                        snippet=None,
                        published_date=filing_date,
                    )
                )

                if set(TARGET_FORMS).issubset(seen_forms):
                    break

            return candidates
    except Exception as exc:
        print(f"[get_company_filings] FAILED for ticker {ticker!r}: {exc}")
        return []
