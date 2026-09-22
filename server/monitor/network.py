import os
import httpx
import logging
from urllib.parse import urlparse
from contextlib import asynccontextmanager

log = logging.getLogger("praxsight.monitor.network")

class NetworkMonitor:
    def __init__(self):
        self.requests_attempted = 0
        self.requests_blocked = 0
        self.bytes_transmitted = 0
        self.bytes_received = 0
        
        # Strict offline mode explicitly blocks non-localhost domains.
        # This is for the "Zero-Network Proof" demo.
        self.strict_offline = os.getenv("PRAXLIGHT_STRICT_OFFLINE", "False").lower() in ("true", "1", "yes")

    def to_dict(self):
        return {
            "requests_attempted": self.requests_attempted,
            "requests_blocked": self.requests_blocked,
            "bytes_transmitted": self.bytes_transmitted,
            "bytes_received": self.bytes_received,
            "strict_offline": self.strict_offline,
            "network_state": "DISCONNECTED" if self.strict_offline else "CONNECTED"
        }

    async def log_request(self, request: httpx.Request):
        url = request.url
        host = url.host
        
        self.requests_attempted += 1
        
        # Enforce strict offline isolation
        if self.strict_offline and host not in ("localhost", "127.0.0.1", "::1"):
            self.requests_blocked += 1
            log.warning(f"Offline Monitor BLOCKED request to external host: {host}")
            raise httpx.ConnectError(f"Network Guard: Blocked external request to {host} due to PRAXLIGHT_STRICT_OFFLINE")
            
        # Estimate bytes
        body = await request.aread()
        self.bytes_transmitted += len(body) + len(str(request.headers))
        log.info(f"Network Guard allowed request to {host} ({len(body)} bytes)")

    async def log_response(self, response: httpx.Response):
        # Estimate bytes received
        try:
            body = await response.aread()
            self.bytes_received += len(body) + len(str(response.headers))
        except Exception:
            pass

# Global monitor instance
monitor = NetworkMonitor()

@asynccontextmanager
async def instrumented_client(timeout: float = 30.0) -> httpx.AsyncClient:
    """
    Yields an httpx.AsyncClient wrapped with PraxLight's Network Guard hooks.
    This guarantees that all AI calls pass through the offline monitor.
    """
    async with httpx.AsyncClient(
        timeout=timeout,
        event_hooks={
            "request": [monitor.log_request],
            "response": [monitor.log_response]
        }
    ) as client:
        yield client
