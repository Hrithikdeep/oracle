import uuid

from sqlalchemy.orm import Session

from models.decision_record import DecisionRecord
from services.decision_record import (
    gather_current_financial_observations,
    gather_current_findings,
    gather_current_report,
)

# Ordering used to judge whether a status change is an "improvement" or a
# "regression" — not a real-world confidence scale, just a deterministic
# ranking for building the summary string. Anything not listed (INSUFFICIENT,
# CONFLICTING, None/not-yet-verified) ranks at 0.
_STATUS_RANK = {"SUPPORTED": 2, "SUPPORTED_WITH_LIMITATIONS": 1}


def get_latest_decision_record(session_id: uuid.UUID, db: Session) -> DecisionRecord | None:
    return (
        db.query(DecisionRecord)
        .filter(DecisionRecord.session_id == session_id)
        .order_by(DecisionRecord.created_at.desc())
        .first()
    )


def _status_rank(status: str | None) -> int:
    return _STATUS_RANK.get(status, 0)


def _dedup_financial_observations(rows: list[dict]) -> dict[tuple[str, str], dict]:
    """finance_engine.py doesn't currently upsert, so re-running it for the same
    session (or leftover test/manual rows, as happened once already — see Section
    7 follow-up) can leave multiple FinancialObservation rows sharing the same
    (metric, period). Comparing every such row against a single dict slot would
    silently let insertion order decide the "true" value and spuriously flag the
    other row(s) as changed. Instead, deterministically keep only the most
    recently created row per (metric, period) — same "most recent wins" pattern
    used for the Verification duplicate cleanup in Section 4/5. Falls back to
    last-in-list-wins only when created_at isn't present (older snapshot JSONB
    captured before this field existed)."""
    deduped: dict[tuple[str, str], dict] = {}
    for row in rows:
        key = (row["metric"], row["period"])
        existing = deduped.get(key)
        if existing is None:
            deduped[key] = row
            continue
        existing_created_at = existing.get("created_at")
        row_created_at = row.get("created_at")
        if row_created_at is not None and (existing_created_at is None or row_created_at > existing_created_at):
            deduped[key] = row
    return deduped


def _empty_diff(summary: str, has_decision_record: bool = False, snapshot_taken_at: str | None = None) -> dict:
    return {
        "has_decision_record": has_decision_record,
        "snapshot_taken_at": snapshot_taken_at,
        "new_findings": [],
        "changed_findings": [],
        "new_financial_observations": [],
        "changed_financial_observations": [],
        "recommendation_changed": False,
        "summary": summary,
    }


def _build_summary(
    unchanged_findings_count: int,
    new_findings: list[dict],
    changed_findings: list[dict],
    unchanged_fo_count: int,
    new_fo: list[dict],
    changed_fo: list[dict],
    recommendation_changed: bool,
) -> str:
    segments = []

    if unchanged_findings_count:
        segments.append(f"{unchanged_findings_count} finding(s) unchanged")

    for cf in changed_findings:
        old_rank, new_rank = _status_rank(cf["old_status"]), _status_rank(cf["new_status"])
        direction = "improved" if new_rank > old_rank else ("regressed" if new_rank < old_rank else "changed")
        segments.append(f"1 finding {direction} ({cf['area']}: {cf['old_status']} -> {cf['new_status']})")

    if new_findings:
        segments.append(f"{len(new_findings)} new finding(s) added")

    if unchanged_fo_count:
        segments.append(f"{unchanged_fo_count} financial observation(s) unchanged")

    if new_fo:
        segments.append(f"{len(new_fo)} new financial observation(s) added")

    if changed_fo:
        segments.append(f"{len(changed_fo)} financial observation(s) changed")

    if recommendation_changed:
        segments.append("recommendation text changed")

    if not segments:
        return "No changes detected since last snapshot."

    return ", ".join(segments) + " since last snapshot."


def compute_diff(session_id: uuid.UUID, db: Session) -> dict:
    """Deterministic diff between the most recent DecisionRecord snapshot and the
    session's CURRENT live state. No LLM call — Re-check is a service, not an
    agent. Reads only; never creates a new DecisionRecord."""
    latest = get_latest_decision_record(session_id, db)
    if latest is None:
        return _empty_diff("No decision record snapshot exists yet for this session — nothing to compare against.")

    snapshot = latest.snapshot
    snapshot_findings_by_id = {f["id"]: f for f in snapshot.get("findings", [])}
    snapshot_fo_by_key = _dedup_financial_observations(snapshot.get("financial_observations", []))
    snapshot_report = snapshot.get("report")

    current_findings = gather_current_findings(session_id, db)
    current_fo = gather_current_financial_observations(session_id, db)
    current_report = gather_current_report(session_id, db)

    new_findings: list[dict] = []
    changed_findings: list[dict] = []
    unchanged_findings_count = 0

    for cf in current_findings:
        old = snapshot_findings_by_id.get(cf["id"])
        new_status = cf["verification"]["status"] if cf["verification"] else None

        if old is None:
            new_findings.append(
                {"id": cf["id"], "area": cf["area"], "statement": cf["statement"], "status": new_status}
            )
            continue

        old_status = old["verification"]["status"] if old["verification"] else None
        if old_status != new_status:
            changed_findings.append(
                {"id": cf["id"], "area": cf["area"], "old_status": old_status, "new_status": new_status}
            )
        else:
            unchanged_findings_count += 1

    new_fo: list[dict] = []
    changed_fo: list[dict] = []
    unchanged_fo_count = 0

    current_fo_by_key = _dedup_financial_observations(current_fo)

    for key, cfo in current_fo_by_key.items():
        old = snapshot_fo_by_key.get(key)

        if old is None:
            new_fo.append({"metric": cfo["metric"], "period": cfo["period"], "value": cfo["value"]})
            continue

        if old["value"] != cfo["value"]:
            changed_fo.append(
                {
                    "metric": cfo["metric"],
                    "period": cfo["period"],
                    "old_value": old["value"],
                    "new_value": cfo["value"],
                }
            )
        else:
            unchanged_fo_count += 1

    old_recommendation = snapshot_report["recommendation"] if snapshot_report else None
    new_recommendation = current_report["recommendation"] if current_report else None
    recommendation_changed = old_recommendation != new_recommendation

    summary = _build_summary(
        unchanged_findings_count,
        new_findings,
        changed_findings,
        unchanged_fo_count,
        new_fo,
        changed_fo,
        recommendation_changed,
    )

    return {
        "has_decision_record": True,
        "snapshot_taken_at": latest.created_at.isoformat(),
        "new_findings": new_findings,
        "changed_findings": changed_findings,
        "new_financial_observations": new_fo,
        "changed_financial_observations": changed_fo,
        "recommendation_changed": recommendation_changed,
        "summary": summary,
    }
