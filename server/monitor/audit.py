import json
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict
from schemas import AgentActRequest, AgentAction

log = logging.getLogger("praxsight.monitor.audit")

# Use a consistent audit log file in the project root
AUDIT_LOG_FILE = Path(__file__).parent.parent.parent / ".praxsight-audit.log"

class AuditLogger:
    @staticmethod
    def append_event(event_type: str, details: Dict[str, Any]):
        """Append an arbitrary event to the JSONL audit log."""
        event = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event_type,
            "details": details
        }
        
        try:
            with open(AUDIT_LOG_FILE, "a", encoding="utf-8") as f:
                f.write(json.dumps(event) + "\n")
        except Exception as e:
            log.error(f"Failed to write to audit log: {e}")

    @staticmethod
    def log_agent_execution(req: AgentActRequest, action: AgentAction, network_stats: Dict[str, Any]):
        """Logs a completed agent execution pipeline pass."""
        details = {
            "task": req.task,
            "privacy": {
                "detected": req.privacy_manifest.entities_detected,
                "redacted": req.privacy_manifest.entities_redacted
            },
            "action": {
                "type": action.action,
                "risk": action.risk,
                "status": action.status,
                "requires_approval": action.requires_approval
            },
            "network": network_stats
        }
        AuditLogger.append_event("AGENT_PIPELINE_EXECUTED", details)
