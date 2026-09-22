import os
import chromadb
from chromadb.config import Settings
from .embeddings import OllamaEmbeddingFunction

# In a real app, you might want this to persist to disk.
# For demo/hackathon purposes, persistent storage is good to show data survives restarts.
DB_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), ".chroma_db")

def get_chroma_client():
    """Get or create the ChromaDB client."""
    return chromadb.PersistentClient(
        path=DB_DIR,
        settings=Settings(anonymized_telemetry=False)
    )

def get_collection():
    """Get or create the default collection for PraxLight RAG."""
    client = get_chroma_client()
    embedding_func = OllamaEmbeddingFunction()
    return client.get_or_create_collection(
        name="praxlight_knowledge",
        embedding_function=embedding_func
    )
