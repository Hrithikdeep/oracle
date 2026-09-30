import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Source(Base):
    __tablename__ = "sources"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    task_id = Column(UUID(as_uuid=True), ForeignKey("research_tasks.id"), nullable=True)
    title = Column(String, nullable=False)
    # normalized URL (see agents.source_intelligence.normalize_url); null for
    # Phase 1 manually-uploaded PDFs which have no URL. Used to dedupe re-discovery.
    url = Column(String, nullable=True)
    # from CandidateSource.publisher (derived from domain at discovery time);
    # null for Phase 1 UPLOAD sources, which have no publisher concept.
    publisher = Column(String, nullable=True)
    # valid values: REGULATORY_FILING, EARNINGS_MATERIAL, NEWS, WEB, UPLOAD
    source_type = Column(String, nullable=False)
    retrieved_at = Column(DateTime(timezone=True), nullable=True)
    # valid values: DISCOVERED, RETRIEVED, FAILED, UNSUPPORTED
    status = Column(String, nullable=False, default="RETRIEVED", server_default="RETRIEVED")

    session = relationship("ResearchSession", back_populates="sources")
    document = relationship("Document", back_populates="source", uselist=False)
