import uuid
from datetime import datetime

from sqlalchemy import Column, DateTime, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func

from database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    email = Column(String, unique=True, nullable=False)
    name = Column(String, nullable=False)
    # nullable: pre-auth User rows (and the two defensive fallback-creation
    # sites in agents/orchestrator.py and api/projects.py, in case this row
    # ever needs re-provisioning) may not have one set. A null hash can never
    # verify — auth.verify_password is never called against it as "match".
    password_hash = Column(String, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
