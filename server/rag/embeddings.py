import os
import logging
import httpx
from typing import List

log = logging.getLogger("praxsight.rag.embeddings")

class OllamaEmbeddingFunction:
    """
    ChromaDB compatible embedding function that delegates to a local Ollama instance.
    This guarantees no external downloads or cloud API calls are made for RAG embedding.
    """
    def __init__(self):
        self.endpoint = os.getenv("OLLAMA_ENDPOINT", "http://localhost:11434")
        self.model = os.getenv("OLLAMA_EMBEDDING_MODEL", "nomic-embed-text")

    def __call__(self, input: List[str]) -> List[List[float]]:
        # ChromaDB requires a __call__ method for embedding functions
        if not input:
            return []

        embeddings = []
        try:
            # Note: The 'api/embeddings' endpoint does not support batching officially in older versions,
            # but newer versions support 'api/embed'.
            # We'll use 'api/embed' if it works, or loop if necessary. We'll try the modern 'api/embed'.
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(
                    f"{self.endpoint}/api/embed",
                    json={"model": self.model, "input": input}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    # data['embeddings'] is a list of lists of floats
                    return data.get("embeddings", [])
                
                # Fallback to older 'api/embeddings' which does one at a time
                if resp.status_code == 404:
                    log.warning("Ollama /api/embed not found, falling back to /api/embeddings loop")
                    for text in input:
                        res = client.post(
                            f"{self.endpoint}/api/embeddings",
                            json={"model": self.model, "prompt": text}
                        )
                        res.raise_for_status()
                        embeddings.append(res.json()["embedding"])
                    return embeddings
                    
                resp.raise_for_status()
        except Exception as e:
            log.error("Failed to generate embeddings via Ollama: %s", e)
            # Return empty lists to prevent crashing if the backend goes offline temporarily, 
            # though Chroma might complain if dimensions don't match. 
            # Usually, raising here is better so the caller knows indexing failed.
            raise e

        return embeddings
