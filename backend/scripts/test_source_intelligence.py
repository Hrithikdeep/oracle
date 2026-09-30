import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from agents.source_intelligence import CandidateSource, rank_sources


def check(label: str, condition: bool):
    print(f"{'PASS' if condition else 'FAIL'}: {label}")


def main():
    candidates = [
        CandidateSource(
            url="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany",
            title="SEC EDGAR Filing",
            publisher="SEC",
            snippet="10-K filing for the company",
            published_date="2026-01-01",
        ),
        CandidateSource(
            url="https://investor.apple.com/investor-relations/default.aspx",
            title="Apple Investor Relations",
            publisher="Apple",
            snippet="Q1 earnings release",
            published_date="2026-01-15",
        ),
        CandidateSource(
            url="https://www.reuters.com/technology/apple-ai-strategy",
            title="Apple's AI Strategy",
            publisher="Reuters",
            snippet="Apple ramps up AI investment",
            published_date="2026-02-01",
        ),
        CandidateSource(
            url="https://randomblog.example.com/2026/02/apple-ai-thoughts",
            title="My Thoughts on Apple AI",
            publisher=None,
            snippet="A personal blog post about Apple",
            published_date="2026-02-02",
        ),
        CandidateSource(
            url="https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&utm_source=twitter",
            title="SEC EDGAR Filing (shared on Twitter)",
            publisher="SEC",
            snippet="10-K filing for the company",
            published_date="2026-01-01",
        ),
    ]

    print(f"Input: {len(candidates)} candidates")
    for c in candidates:
        print(f"  - {c.url}")

    result = rank_sources(candidates)

    print(f"\nOutput: {len(result)} ranked sources")
    for r in result:
        print(f"  - tier={r.authority_tier} type={r.source_type:<18} url={r.url}")

    print("\nAssertions:")
    check("exactly 4 results (duplicate removed)", len(result) == 4)
    check(
        "sec.gov result is first",
        len(result) > 0 and result[0].source_type == "REGULATORY_FILING" and "sec.gov" in result[0].url,
    )
    check(
        "blog result is last",
        len(result) > 0 and result[-1].source_type == "WEB" and "randomblog" in result[-1].url,
    )
    sec_result = next((r for r in result if r.source_type == "REGULATORY_FILING"), None)
    check(
        "kept sec.gov entry is the version WITHOUT the tracking param",
        sec_result is not None and "utm_source" not in sec_result.url,
    )


if __name__ == "__main__":
    main()
