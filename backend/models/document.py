import uuid

from sqlalchemy import Column, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class Document(Base):
    __tablename__ = "documents"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("research_sessions.id"), nullable=False)
    # valid values: PDF, HTML
    doc_type = Column(String, nullable=False)
    raw_text = Column(Text, nullable=False)
    title = Column(String, nullable=True)
    content_hash = Column(String, nullable=True)
    parsing_status = Column(String, nullable=False, default="PARSED", server_default="PARSED")
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)

    source = relationship("Source", back_populates="document", uselist=False)
    chunks = relationship("DocumentChunk", back_populates="document")
