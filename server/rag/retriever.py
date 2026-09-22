import logging
from typing import List, Dict, Any
from .store import get_collection

log = logging.getLogger("praxsight.rag.retriever")

def retrieve_context(query: str, n_results: int = 3) -> List[Dict[str, Any]]:
    """
    Query the local knowledge base for relevant chunks.
    Returns a list of dicts with 'text', 'source', and 'distance'.
    """
    try:
        collection = get_collection()
        # ChromaDB automatically uses the embedding function we attached to the collection
        results = collection.query(
            query_texts=[query],
            n_results=n_results
        )
        
        contexts = []
        if not results or not results['documents'] or not results['documents'][0]:
            return contexts
            
        docs = results['documents'][0]
        metadatas = results['metadatas'][0] if results.get('metadatas') else [{}] * len(docs)
        distances = results['distances'][0] if results.get('distances') else [0.0] * len(docs)
        
        for doc, meta, dist in zip(docs, metadatas, distances):
            contexts.append({
                "text": doc,
                "source": meta.get("source", "Unknown Source"),
                "distance": dist
            })
            
        return contexts
        
    except Exception as e:
        log.error("RAG retrieval failed: %s", e)
        # Fail gracefully to allow the agent to continue without context if RAG is broken
        return []

def format_retrieved_context(contexts: List[Dict[str, Any]]) -> str:
    """Format retrieved context for inclusion in an LLM prompt."""
    if not contexts:
        return "No local knowledge found."
        
    formatted = "LOCAL KNOWLEDGE RETRIEVED:\n"
    for i, ctx in enumerate(contexts):
        formatted += f"\n--- Source {i+1}: {ctx['source']} ---\n"
        formatted += f"{ctx['text']}\n"
    return formatted
