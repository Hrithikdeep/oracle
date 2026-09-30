import uuid

from pgvector.sqlalchemy import Vector
from sqlalchemy import Column, ForeignKey, Index, Integer, String, Text
from sqlalchemy import text as sql_text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func

from database import Base


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    document_id = Column(UUID(as_uuid=True), ForeignKey("documents.id"), nullable=False)
    source_id = Column(UUID(as_uuid=True), ForeignKey("sources.id"), nullable=False)
    sequence = Column(Integer, nullable=False)
    text = Column(Text, nullable=False)
    heading = Column(String, nullable=True)
    page = Column(Integer, nullable=True)
    metadata_ = Column("metadata", JSONB, nullable=False, default=dict, server_default="{}")
    # dimension matches text-embedding-3-small; nullable because chunks are
    # persisted before the embedding step runs (Phase 2 retrieval work, not yet built)
    embedding = Column(Vector(1536), nullable=True)

    document = relationship("Document", back_populates="chunks")

    __table_args__ = (
        Index(
            "ix_document_chunks_embedding_ivfflat",
            "embedding",
            postgresql_using="ivfflat",
            postgresql_ops={"embedding": "vector_cosine_ops"},
            postgresql_with={"lists": "100"},
        ),
        Index(
            "ix_document_chunks_text_fts",
            sql_text("to_tsvector('english', text)"),
            postgresql_using="gin",
        ),
    )
