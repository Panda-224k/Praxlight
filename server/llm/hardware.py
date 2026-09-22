import psutil
import logging
from enum import Enum

log = logging.getLogger("praxsight.llm.hardware")

class HardwareTier(Enum):
    HIGH = "high"       # > 12GB RAM available: Safe for 8B models
    MEDIUM = "medium"   # > 6GB RAM available: Safe for 3B models
    LOW = "low"         # < 6GB RAM available: Fallback to rules

def get_hardware_tier() -> HardwareTier:
    """Determine the current hardware capabilities based on available system memory."""
    try:
        mem = psutil.virtual_memory()
        available_gb = mem.available / (1024 ** 3)
        
        log.info(f"Hardware check: {available_gb:.1f}GB RAM available")
        
        if available_gb >= 12.0:
            return HardwareTier.HIGH
        elif available_gb >= 6.0:
            return HardwareTier.MEDIUM
        else:
            return HardwareTier.LOW
    except Exception as e:
        log.warning(f"Failed to check hardware memory: {e}. Defaulting to LOW tier.")
        return HardwareTier.LOW

def resolve_model(requested_model: str, tier: HardwareTier) -> str:
    """Downgrade a requested model based on the hardware tier."""
    if tier == HardwareTier.LOW:
        # For LOW tier, the adapter itself should mark as unavailable and let the router fall back
        # to DeterministicAdapter. But if forced, it should use a tiny model or fail safely.
        return None
        
    if requested_model.startswith("llama3"):
        if tier == HardwareTier.MEDIUM:
            log.warning("Downgrading from llama3 to phi3 due to medium hardware tier (RAM < 12GB)")
            return "phi3"
            
    return requested_model
