import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from schemas import AgentActRequest, ElementsPayload, PrivacyManifest, ToolPermissions, AgentAction
from agent_engine import AgentPipeline

@pytest.fixture
def mock_req():
    return AgentActRequest(
        task="Test task",
        page_url="http://test.com",
        elements=ElementsPayload(inputs=[], interactive=[]),
        privacy_manifest=PrivacyManifest(
            performed=True, version="1.0", generated_at="2026-09-15T00:00:00Z"
        ),
        tool_permissions=ToolPermissions(allow_rag=True, allow_browser=True)
    )

@pytest.mark.asyncio
async def test_agent_pipeline_reason_success(mock_req):
    mock_router = MagicMock()
    mock_router.reason = AsyncMock(return_value=AgentAction(
        action="read", reason="I need to read.", risk="low"
    ))
    
    pipeline = AgentPipeline(mock_router)
    
    with patch("agent_engine.validate_action") as mock_validate:
        mock_validate.return_value = AgentAction(
            action="read", reason="I need to read.", risk="low", validated=True, status="VALIDATED"
        )
        
        # Test without RAG for simplicity
        mock_req.tool_permissions.allow_rag = False
        action = await pipeline.execute(mock_req)
        
        assert action.validated is True
        assert action.status == "VALIDATED"
        mock_router.reason.assert_called_once_with(mock_req)
        mock_validate.assert_called_once()

@pytest.mark.asyncio
@patch("agent_engine.validate_action")
async def test_agent_pipeline_high_risk_approval(mock_validate, mock_req):
    mock_router = MagicMock()
    mock_router.reason = AsyncMock(return_value=AgentAction(
        action="click", reason="Submitting transfer.", risk="high", target={"type": "element_id", "id": "123"}
    ))
    
    pipeline = AgentPipeline(mock_router)
    
    mock_validate.return_value = AgentAction(
        action="click", reason="Submitting transfer.", risk="high", requires_approval=True, validated=True, status="PENDING_APPROVAL"
    )
    
    mock_req.tool_permissions.allow_rag = False
    action = await pipeline.execute(mock_req)
    
    assert action.status == "PENDING_APPROVAL"
    assert action.requires_approval is True

@pytest.mark.asyncio
@patch("rag.retriever.retrieve_context")
async def test_agent_pipeline_rag_injection(mock_retrieve, mock_req):
    mock_retrieve.return_value = [{"text": "Test RAG doc", "source": "test.txt", "distance": 0.1}]
    
    mock_router = MagicMock()
    mock_router.reason = AsyncMock(return_value=AgentAction(
        action="read", reason="Test", risk="low"
    ))
    
    pipeline = AgentPipeline(mock_router)
    
    mock_req.tool_permissions.allow_rag = True
    
    with patch("agent_engine.validate_action", return_value=AgentAction(action="read", reason="Test")):
        await pipeline.execute(mock_req)
        
    mock_retrieve.assert_called_once_with(mock_req.task)
    # Ensure context was injected
    assert len(mock_req.text_context) == 1
    assert mock_req.text_context[0].psId == "RAG_CONTEXT"
    assert "Test RAG doc" in mock_req.text_context[0].text
