from langchain_openai import OpenAIEmbeddings
from sqlalchemy.orm import Session

from models.chunk import DocumentChunk

EMBEDDING_MODEL = "text-embedding-3-small"


async def get_embedding(text: str) -> list[float]:
    embeddings_client = OpenAIEmbeddings(model=EMBEDDING_MODEL)
    return await embeddings_client.aembed_query(text)


async def embed_chunks(chunks: list[DocumentChunk], db: Session, batch_size: int = 20) -> None:
    embeddings_client = OpenAIEmbeddings(model=EMBEDDING_MODEL)

    for i in range(0, len(chunks), batch_size):
        batch = chunks[i : i + batch_size]
        texts = [chunk.text for chunk in batch]
        # One API call per batch, not one per chunk.
        vectors = await embeddings_client.aembed_documents(texts)
        for chunk, vector in zip(batch, vectors):
            chunk.embedding = vector
        db.commit()
