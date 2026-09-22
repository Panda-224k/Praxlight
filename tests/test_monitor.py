import pytest
import httpx
from server.monitor.network import NetworkMonitor, instrumented_client
import os
import json

@pytest.mark.asyncio
async def test_network_monitor_allows_localhost():
    monitor = NetworkMonitor()
    monitor.strict_offline = True
    
    request = httpx.Request("GET", "http://localhost:11434/api/tags")
    await monitor.log_request(request)
    
    assert monitor.requests_attempted == 1
    assert monitor.requests_blocked == 0

@pytest.mark.asyncio
async def test_network_monitor_blocks_external_in_strict_mode():
    monitor = NetworkMonitor()
    monitor.strict_offline = True
    
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat")
    
    with pytest.raises(httpx.ConnectError) as exc:
        await monitor.log_request(request)
        
    assert "Blocked external request" in str(exc.value)
    assert monitor.requests_attempted == 1
    assert monitor.requests_blocked == 1

@pytest.mark.asyncio
async def test_network_monitor_allows_external_if_not_strict():
    monitor = NetworkMonitor()
    monitor.strict_offline = False
    
    request = httpx.Request("POST", "https://openrouter.ai/api/v1/chat")
    await monitor.log_request(request)
    
    assert monitor.requests_attempted == 1
    assert monitor.requests_blocked == 0

def test_audit_logger(tmp_path):
    from server.monitor.audit import AuditLogger
    
    # Override log file path for test
    import server.monitor.audit as audit_module
    audit_module.AUDIT_LOG_FILE = tmp_path / "test-audit.log"
    
    details = {"test": 123}
    AuditLogger.append_event("TEST_EVENT", details)
    
    content = audit_module.AUDIT_LOG_FILE.read_text(encoding="utf-8")
    lines = content.strip().split("\n")
    assert len(lines) == 1
    
    event = json.loads(lines[0])
    assert event["event"] == "TEST_EVENT"
    assert event["details"]["test"] == 123
