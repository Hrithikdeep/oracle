"""seed demo user

Revision ID: a7c3e91f4d20
Revises: 85a0d1edcd88
Create Date: 2026-09-24 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from auth import DEMO_USER_EMAIL, DEMO_USER_PASSWORD, hash_password

# revision identifiers, used by Alembic.
revision: str = 'a7c3e91f4d20'
down_revision: Union[str, Sequence[str], None] = '85a0d1edcd88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Ensure the single demo login exists.

    The demo user was originally created by hand on the dev DB, so a fresh
    database had no way to log in at all: every data route needs a token, and
    the only other code that creates this row (the fallbacks in
    agents/orchestrator.py and api/projects.py) sits behind those routes.

    Idempotent: inserts the row if missing, sets a password only if the
    existing row has none, and never overwrites an existing hash.
    """
    op.get_bind().execute(
        sa.text(
            "INSERT INTO users (email, name, password_hash) "
            "VALUES (:email, 'System', :password_hash) "
            "ON CONFLICT (email) DO UPDATE "
            "SET password_hash = EXCLUDED.password_hash "
            "WHERE users.password_hash IS NULL"
        ),
        {"email": DEMO_USER_EMAIL, "password_hash": hash_password(DEMO_USER_PASSWORD)},
    )


def downgrade() -> None:
    """Intentionally a no-op: research sessions and projects reference this
    user row, so deleting it on downgrade would orphan or break them."""
    pass
