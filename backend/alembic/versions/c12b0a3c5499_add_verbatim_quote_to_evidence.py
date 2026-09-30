"""add verbatim_quote to evidence

Revision ID: c12b0a3c5499
Revises: a7c3e91f4d20
Create Date: 2026-09-27 12:46:42.943133

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c12b0a3c5499'
down_revision: Union[str, Sequence[str], None] = 'a7c3e91f4d20'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Store the source-verified verbatim quote alongside the paraphrased observation.

    Nullable and not backfilled: rows created before this migration never kept their
    quote (it was validated, then discarded), so they stay NULL and consumers fall
    back to `observation`.
    """
    op.add_column('evidence', sa.Column('verbatim_quote', sa.Text(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('evidence', 'verbatim_quote')
