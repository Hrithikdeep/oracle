import uuid

from sqlalchemy import Column, String
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import func

from database import Base


class Company(Base):
    __tablename__ = "companies"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    name = Column(String, nullable=False)
    ticker = Column(String, nullable=True)
    exchange = Column(String, nullable=True)
    aliases = Column(JSONB, nullable=False, default=list, server_default="[]")
