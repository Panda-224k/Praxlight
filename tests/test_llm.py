import pytest
from unittest.mock import AsyncMock, patch, PropertyMock
import httpx
from schemas import AgentActRequest, ElementsPayload
from server.llm.ollama_adapter import OllamaAdapter
from server.llm.router import ModelRouter

@pytest.fixture
def mock_req():
    return AgentActRequest(
        task="Test task",
        page_url="http://test.com",
        elements=ElementsPayload(interactive=[], inputs=[], textNodes=[]),
        text_context=[],
        privacy_manifest={
            "performed": True,
            "version": "1.0",
            "detectors": [],
            "policies": {},
            "generated_at": "2026-09-15T00:00:00Z"
        }
    )

@pytest.mark.asyncio
async def test_ollama_adapter_success(mock_req):
    adapter = OllamaAdapter()
    
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.return_value = httpx.Response(
            status_code=200, 
            json={"message": {"content": '{"action": "read", "reason": "Testing", "risk": "low"}'}},
            request=httpx.Request("POST", "http://localhost")
        )
        
        result = await adapter.reason(mock_req)
        
        assert result is not None
        assert result.action == "read"
        assert result.reason == "Testing"

@pytest.mark.asyncio
async def test_ollama_adapter_connection_error(mock_req):
    adapter = OllamaAdapter()
    
    with patch("httpx.AsyncClient.post", new_callable=AsyncMock) as mock_post:
        mock_post.side_effect = httpx.ConnectError("Connection failed")
        
        result = await adapter.reason(mock_req)
        
        assert result is None  # Should return None on failure, enabling fallback

@pytest.mark.asyncio
async def test_router_fallback(mock_req):
    router = ModelRouter()
    
    with patch("server.llm.remote_adapters.OpenRouterAdapter.available", new_callable=PropertyMock, return_value=True), \
         patch("server.llm.remote_adapters.GoogleAIAdapter.available", new_callable=PropertyMock, return_value=True), \
         patch("server.llm.remote_adapters.OpenRouterAdapter.reason", new_callable=AsyncMock) as mock_openrouter, \
         patch("server.llm.remote_adapters.GoogleAIAdapter.reason", new_callable=AsyncMock) as mock_google, \
         patch("server.llm.ollama_adapter.OllamaAdapter.reason", new_callable=AsyncMock) as mock_ollama:
         
         mock_openrouter.return_value = None
         mock_google.return_value = None
         mock_ollama.return_value = None # Fall all the way through to deterministic
         
         result = await router.reason(mock_req)
         
         # Deterministic should always return an action (read fallback for "Test task")
         assert result is not None
         assert result.action == "read"
         assert "No unambiguous matching control" in result.reason
