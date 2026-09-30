import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Finding(Base):
    __tablename__ = "findings"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    area = Column(String, nullable=False)
    statement = Column(Text, nullable=False)
    interpretation = Column(Text, nullable=True)
    # valid values: HIGH, MEDIUM, LOW
    materiality = Column(String, nullable=False, default="MEDIUM", server_default="MEDIUM")
    # valid values: DRAFT, ...
    status = Column(String, nullable=False, default="DRAFT", server_default="DRAFT")
    # list of Evidence.id strings this finding was drawn from, when not area-native
    # (e.g. Risk findings synthesized from evidence gathered under a different task's
    # area). Empty for findings that ARE area-native — deterministic_checks() falls
    # back to the session+area join for those, same as before this field existed.
    evidence_ids = Column(JSONB, nullable=False, default=list, server_default="[]")
    # list of FinancialObservation.id strings this finding is grounded in, for
    # findings derived from deterministic Finance Engine data rather than
    # LLM-extracted evidence text (e.g. Risk findings synthesized purely from
    # revenue/margin trends). See verification.deterministic_checks() for why
    # this is treated as a distinct, equally-valid kind of "well-sourced."
    financial_observation_ids = Column(JSONB, nullable=False, default=list, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("ResearchSession", back_populates="findings")
    verification = relationship("Verification", back_populates="finding", uselist=False)
