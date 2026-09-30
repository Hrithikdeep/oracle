import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Contradiction(Base):
    __tablename__ = "contradictions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    finding_id = Column(UUID(as_uuid=True), ForeignKey("findings.id"), nullable=True)
    # nullable: a purely deterministic financial-data contradiction (two conflicting
    # FinancialObservation values) has no Evidence rows to link — the conflict is
    # described in `description` instead of forcing a fake Evidence reference.
    evidence_a_id = Column(UUID(as_uuid=True), ForeignKey("evidence.id"), nullable=True)
    evidence_b_id = Column(UUID(as_uuid=True), ForeignKey("evidence.id"), nullable=True)
    description = Column(Text, nullable=False)
    # valid values: HIGH, MEDIUM, LOW
    materiality = Column(String, nullable=False, default="MEDIUM", server_default="MEDIUM")
    # valid values: OPEN, RESOLVED, UNRESOLVED
    status = Column(String, nullable=False, default="OPEN", server_default="OPEN")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("ResearchSession", back_populates="contradictions")
