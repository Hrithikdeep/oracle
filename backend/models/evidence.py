import uuid

from sqlalchemy import Column, DateTime, Float, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Evidence(Base):
    __tablename__ = "evidence"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    task_id = Column(UUID(as_uuid=True), ForeignKey("research_tasks.id"), nullable=False)
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    observation = Column(Text, nullable=False)
    # The exact source text the observation was drawn from, as validated by
    # evidence_agent._quote_in_chunk. NULL for rows created before it was stored.
    verbatim_quote = Column(Text, nullable=True)
    # valid values: DOCUMENT, FINANCIAL, NEWS
    evidence_type = Column(String, nullable=False)
    location = Column(String, nullable=False)  # e.g. page number
    confidence = Column(Float, nullable=True)
    # valid values: ACCEPTED, ...
    status = Column(String, nullable=False, default="ACCEPTED", server_default="ACCEPTED")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("ResearchSession", back_populates="evidence")
