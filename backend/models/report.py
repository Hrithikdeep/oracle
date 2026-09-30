import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Report(Base):
    __tablename__ = "reports"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    executive_summary = Column(Text, nullable=False)
    # keys like "business", "financial", "competitive", "risks", "recent_developments"
    sections = Column(JSONB, nullable=False)
    recommendation = Column(String, nullable=True)
    # one string per CONFLICTING/INSUFFICIENT/not-yet-verified finding, built in code
    # (never by the LLM) so unverified content is explicitly surfaced, not dropped
    limitations = Column(JSONB, nullable=False, default=list, server_default="[]")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    session = relationship("ResearchSession", back_populates="reports")
