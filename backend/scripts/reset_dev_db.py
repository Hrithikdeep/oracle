"""One-off dev-database reset: wipes every research-session-derived table for
a clean end-to-end test pass. NOT a migration — does not touch alembic_version
or the schema itself, only row data.

Deletes in FK-dependency order (children before parents) rather than relying
on CASCADE, so a stray FK this script's author didn't know about would raise
an IntegrityError instead of silently cascading through something unintended.

Keeps: users (the single placeholder system@oracle.local row) and projects
(the lightweight Chat "project folder" grouping — populated by its own
explicit createProject() flow, not by research sessions, so it's out of
scope for a "clear research data" reset).

Clears: companies too, despite not being explicitly listed in the original
table list — every Company row today exists only because some research
session's orchestrator_node resolved/created it, and companies get recreated
fresh on the next research call regardless. Keeping stale Company rows with
zero research sessions pointing at them would leave orphaned, misleading
data behind after an otherwise-clean wipe.

Usage: python scripts/reset_dev_db.py [--yes]
  --yes  skip the interactive confirmation prompt.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from database import SessionLocal
from models.chunk import DocumentChunk
from models.company import Company
from models.contradiction import Contradiction
from models.decision_record import DecisionRecord
from models.document import Document
from models.evidence import Evidence
from models.financial_observation import FinancialObservation
from models.finding import Finding
from models.plan import ResearchPlan
from models.report import Report
from models.session import ResearchSession
from models.source import Source
from models.task import ResearchTask
from models.verification import Verification

# Children before parents — see module docstring.
TABLES_IN_DELETE_ORDER = [
    Verification,
    Contradiction,
    DocumentChunk,
    Evidence,
    Document,
    FinancialObservation,
    Finding,
    Report,
    DecisionRecord,
    Source,
    ResearchTask,
    ResearchPlan,
    ResearchSession,
    Company,
]


def print_counts(db, label: str) -> dict:
    counts = {}
    print(f"\n{label}")
    print("-" * len(label))
    for model in TABLES_IN_DELETE_ORDER:
        count = db.query(model).count()
        counts[model.__tablename__] = count
        print(f"  {model.__tablename__:<24} {count}")
    return counts


def main():
    skip_confirm = "--yes" in sys.argv

    db = SessionLocal()
    try:
        before = print_counts(db, "BEFORE wipe")

        total_before = sum(before.values())
        if total_before == 0:
            print("\nNothing to delete — every table is already empty.")
            return

        if not skip_confirm:
            answer = input(
                f"\nAbout to delete {total_before} row(s) across "
                f"{len(TABLES_IN_DELETE_ORDER)} tables from the dev database. "
                f"Type 'yes' to continue: "
            )
            if answer.strip().lower() != "yes":
                print("Aborted — no rows deleted.")
                return

        print("\nDeleting...")
        for model in TABLES_IN_DELETE_ORDER:
            deleted = db.query(model).delete(synchronize_session=False)
            print(f"  {model.__tablename__:<24} deleted {deleted}")
        db.commit()

        after = print_counts(db, "AFTER wipe")

        total_after = sum(after.values())
        if total_after == 0:
            print("\nAll clear — every listed table is now at 0 rows.")
        else:
            print(
                f"\nWARNING: {total_after} row(s) remain — reset did not fully succeed."
            )
    except Exception:
        db.rollback()
        raise
    finally:
        db.close()


if __name__ == "__main__":
    main()
