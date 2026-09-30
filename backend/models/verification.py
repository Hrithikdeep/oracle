import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Verification(Base):
    __tablename__ = "verifications"
    __table_args__ = (
        # Enforces the one-to-one relationship with Finding that the ORM already
        # declared (uselist=False) but the DB never actually guaranteed until now.
        UniqueConstraint("finding_id", name="uq_verifications_finding_id"),
    )

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    finding_id = Column(UUID(as_uuid=True), ForeignKey("findings.id"), nullable=False)
    # valid values: SUPPORTED, SUPPORTED_WITH_LIMITATIONS, CONFLICTING, INSUFFICIENT
    status = Column(String, nullable=False)
    reasoning = Column(Text, nullable=False)
    source_count = Column(Integer, nullable=False)
    det_checks_pass = Column(Boolean, nullable=False)
    # nullable: the hard_fail path (no evidence at all) skips the LLM call entirely,
    # so there is no verdict to record — never a fake/forced value.
    llm_verdict = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    finding = relationship("Finding", back_populates="verification", uselist=False)
