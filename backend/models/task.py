import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class ResearchTask(Base):
    __tablename__ = "research_tasks"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    plan_id = Column(UUID(as_uuid=True), ForeignKey("research_plans.id"), nullable=False)
    area = Column(String, nullable=False)
    objective = Column(Text, nullable=False)
    # valid values: INITIAL_PLAN, RESEARCH_GAP, CONTRADICTION, FOLLOW_UP
    origin = Column(String, nullable=False, default="INITIAL_PLAN", server_default="INITIAL_PLAN")
    # valid values: PENDING, RUNNING, COMPLETED, COMPLETED_WITH_LIMITATIONS, FAILED, CANCELLED
    status = Column(String, nullable=False, default="PENDING", server_default="PENDING")
    attempt_count = Column(Integer, nullable=False, default=0, server_default="0")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    started_at = Column(DateTime(timezone=True), nullable=True)
    completed_at = Column(DateTime(timezone=True), nullable=True)

    session = relationship("ResearchSession", back_populates="tasks")
