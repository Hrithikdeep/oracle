import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class ResearchSession(Base):
    __tablename__ = "research_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    company_id = Column(UUID(as_uuid=True), ForeignKey("companies.id"), nullable=False)
    # nullable: "All projects" (no scope selected) is a valid, common case
    project_id = Column(
        UUID(as_uuid=True),
        ForeignKey("projects.id", name="fk_research_sessions_project_id"),
        nullable=True,
    )
    question = Column(Text, nullable=False)
    # valid values: CREATED, PLANNING, RESEARCHING, ANALYZING, VERIFYING,
    # ASSESSING, SYNTHESIZING, COMPLETED, COMPLETED_WITH_LIMITATIONS, FAILED, CANCELLED
    status = Column(String, nullable=False, default="CREATED", server_default="CREATED")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    project = relationship("Project", back_populates="sessions")
    plan = relationship("ResearchPlan", back_populates="session")
    tasks = relationship("ResearchTask", back_populates="session")
    sources = relationship("Source", back_populates="session")
    evidence = relationship("Evidence", back_populates="session")
    findings = relationship("Finding", back_populates="session")
    contradictions = relationship("Contradiction", back_populates="session")
    reports = relationship("Report", back_populates="session")
    decision_records = relationship("DecisionRecord", back_populates="session")
