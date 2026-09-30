from typing import Optional
from urllib.parse import parse_qsl, urlencode, urlparse, urlunparse

from pydantic import BaseModel

# Lower number = HIGHER authority. REGULATORY_FILING (1) outranks EARNINGS_MATERIAL (2),
# which outranks NEWS (3), which outranks WEB (4, lowest authority). This is the
# opposite of "higher tier = better" — easy to get backwards, hence this comment.
AUTHORITY_TIERS = {
    "REGULATORY_FILING": 1,
    "EARNINGS_MATERIAL": 2,
    "NEWS": 3,
    "WEB": 4,
}

NEWS_ALLOWLIST = {"reuters.com", "bloomberg.com", "wsj.com", "ft.com"}

TRACKING_PARAM_PREFIXES = ("utm_",)
TRACKING_PARAM_EXACT = {"fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "igshid"}


class CandidateSource(BaseModel):
    url: str
    title: str
    publisher: Optional[str] = None
    snippet: Optional[str] = None
    published_date: Optional[str] = None


class RankedSource(BaseModel):
    url: str
    title: str
    publisher: Optional[str] = None
    source_type: str
    authority_tier: int
    snippet: Optional[str] = None
    published_date: Optional[str] = None


def _bare_domain(url: str) -> str:
    domain = urlparse(url).netloc.lower()
    if domain.startswith("www."):
        domain = domain[len("www."):]
    return domain


def classify_source_type(url: str) -> str:
    domain = _bare_domain(url)

    if "sec.gov" in domain:
        return "REGULATORY_FILING"
    if "investor" in domain or "ir." in domain:
        return "EARNINGS_MATERIAL"
    if domain in NEWS_ALLOWLIST:
        return "NEWS"
    return "WEB"


def authority_tier(source_type: str) -> int:
    # Lower number = higher authority. See AUTHORITY_TIERS comment above.
    return AUTHORITY_TIERS[source_type]


def normalize_url(url: str) -> str:
    parsed = urlparse(url)
    netloc = parsed.netloc.lower()
    path = parsed.path.rstrip("/")

    query_pairs = parse_qsl(parsed.query, keep_blank_values=True)
    filtered_pairs = [
        (key, value)
        for key, value in query_pairs
        if not key.lower().startswith(TRACKING_PARAM_PREFIXES)
        and key.lower() not in TRACKING_PARAM_EXACT
    ]
    query = urlencode(filtered_pairs)

    return urlunparse((parsed.scheme, netloc, path, parsed.params, query, ""))


def rank_sources(candidates: list[CandidateSource]) -> list[RankedSource]:
    seen_keys: set[str] = set()
    ranked: list[RankedSource] = []

    for candidate in candidates:
        key = normalize_url(candidate.url)
        if key in seen_keys:
            continue
        seen_keys.add(key)

        source_type = classify_source_type(candidate.url)
        ranked.append(
            RankedSource(
                url=candidate.url,
                title=candidate.title,
                publisher=candidate.publisher,
                source_type=source_type,
                authority_tier=authority_tier(source_type),
                snippet=candidate.snippet,
                published_date=candidate.published_date,
            )
        )

    ranked.sort(key=lambda r: r.authority_tier)
    return ranked
