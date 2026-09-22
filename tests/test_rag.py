import pytest
import os
import uuid
from unittest.mock import patch, MagicMock, AsyncMock

from server.rag.ingestion import chunk_text, ingest_document
from server.rag.retriever import retrieve_context, format_retrieved_context

def test_chunk_text():
    text = "A" * 1500
    chunks = chunk_text(text, chunk_size=1000, overlap=200)
    assert len(chunks) == 2
    assert len(chunks[0]) == 1000
    assert len(chunks[1]) == 700  # 1500 - (1000 - 200) = 700

@patch("server.rag.ingestion.get_collection")
def test_ingest_document(mock_get_collection, tmp_path):
    mock_collection = MagicMock()
    mock_get_collection.return_value = mock_collection
    
    test_file = tmp_path / "test.txt"
    test_file.write_text("This is a test document that should be chunked and stored.")
    
    num_chunks = ingest_document(str(test_file))
    
    assert num_chunks == 1
    mock_collection.add.assert_called_once()
    args, kwargs = mock_collection.add.call_args
    assert "documents" in kwargs
    assert kwargs["documents"][0] == "This is a test document that should be chunked and stored."

@patch("server.rag.retriever.get_collection")
def test_retrieve_context(mock_get_collection):
    mock_collection = MagicMock()
    mock_get_collection.return_value = mock_collection
    
    mock_collection.query.return_value = {
        "documents": [["Test context chunk"]],
        "metadatas": [[{"source": "test.txt"}]],
        "distances": [[0.123]]
    }
    
    contexts = retrieve_context("test query")
    
    assert len(contexts) == 1
    assert contexts[0]["text"] == "Test context chunk"
    assert contexts[0]["source"] == "test.txt"

def test_format_retrieved_context():
    contexts = [
        {"text": "Test chunk 1", "source": "test1.txt", "distance": 0.1},
        {"text": "Test chunk 2", "source": "test2.txt", "distance": 0.2}
    ]
    
    formatted = format_retrieved_context(contexts)
    assert "LOCAL KNOWLEDGE RETRIEVED" in formatted
    assert "Source 1: test1.txt" in formatted
    assert "Test chunk 1" in formatted
    assert "Source 2: test2.txt" in formatted
