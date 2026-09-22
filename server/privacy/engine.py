from typing import Tuple, Dict, Any, List
from .detectors import detect_in_text
from .redaction import build_token_map, redact_text

class AuditLog:
    """A sanitized record of the Safe-Context pipeline execution."""
    def __init__(self):
        self.detections_count = 0
        self.redactions_count = 0
        self.entities_detected = []
        
    def to_dict(self):
        return {
            "detections_count": self.detections_count,
            "redactions_count": self.redactions_count,
            "entities_detected": self.entities_detected
        }

def sanitize_text(raw_text: str, source_id: str = "backend") -> Tuple[str, AuditLog]:
    """
    The core PraxLight Safe-Context Engine.
    Executes: RAW -> DETECT -> REDACT -> SAFE
    """
    audit = AuditLog()
    if not raw_text:
        return "", audit
        
    # 1. DETECT
    detections = detect_in_text(raw_text, ps_id=source_id)
    audit.detections_count = len(detections)
    
    # 2. CLASSIFY & TOKENIZE
    token_map = build_token_map(detections)
    audit.redactions_count = len(token_map)
    audit.entities_detected = [d.get("type") for d in detections]
    
    # 3. REDACT
    safe_text = redact_text(raw_text, token_map)
    
    return safe_text, audit
