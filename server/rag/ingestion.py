import os
import uuid
import logging
from typing import List, Dict
from .store import get_collection

log = logging.getLogger("praxsight.rag.ingestion")

def chunk_text(text: str, chunk_size: int = 1000, overlap: int = 200) -> List[str]:
    """Basic recursive character text splitter."""
    chunks = []
    start = 0
    text_len = len(text)
    
    while start < text_len:
        end = min(start + chunk_size, text_len)
        
        # If we are not at the end, try to find a natural break (newline or space)
        if end < text_len:
            # Try to find a newline within the last 100 chars of the chunk
            search_start = max(start, end - 100)
            break_idx = text.rfind('\n', search_start, end)
            if break_idx == -1:
                # Fallback to space
                break_idx = text.rfind(' ', search_start, end)
                
            if break_idx != -1:
                end = break_idx + 1 # Include the break char

        chunks.append(text[start:end].strip())
        
        if end >= text_len:
            break
            
        start = max(start + 1, end - overlap)
        
    return [c for c in chunks if c] # Filter empty

def ingest_document(file_path: str, source_name: str = None) -> int:
    """Read a document, chunk it, and store it in ChromaDB."""
    if not os.path.exists(file_path):
        raise FileNotFoundError(f"Cannot find document at {file_path}")
        
    if not source_name:
        source_name = os.path.basename(file_path)
        
    try:
        with open(file_path, "r", encoding="utf-8") as f:
            text = f.read()
            
        chunks = chunk_text(text)
        if not chunks:
            log.warning(f"No text extracted from {source_name}")
            return 0
            
        collection = get_collection()
        
        ids = [f"{source_name}_{uuid.uuid4().hex[:8]}" for _ in chunks]
        metadatas = [{"source": source_name, "chunk_index": i} for i in range(len(chunks))]
        
        collection.add(
            documents=chunks,
            metadatas=metadatas,
            ids=ids
        )
        log.info(f"Ingested {len(chunks)} chunks from {source_name}")
        return len(chunks)
        
    except Exception as e:
        log.error(f"Failed to ingest document {source_name}: {e}")
        raise e
