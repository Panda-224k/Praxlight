import pytest
from unittest.mock import patch
from server.llm.hardware import get_hardware_tier, HardwareTier, resolve_model

@patch("psutil.virtual_memory")
def test_hardware_tier_high(mock_vm):
    # Mock 16GB available
    class MockMem:
        available = 16.0 * (1024 ** 3)
    mock_vm.return_value = MockMem()
    
    assert get_hardware_tier() == HardwareTier.HIGH

@patch("psutil.virtual_memory")
def test_hardware_tier_medium(mock_vm):
    # Mock 8GB available
    class MockMem:
        available = 8.0 * (1024 ** 3)
    mock_vm.return_value = MockMem()
    
    assert get_hardware_tier() == HardwareTier.MEDIUM

@patch("psutil.virtual_memory")
def test_hardware_tier_low(mock_vm):
    # Mock 4GB available
    class MockMem:
        available = 4.0 * (1024 ** 3)
    mock_vm.return_value = MockMem()
    
    assert get_hardware_tier() == HardwareTier.LOW

def test_resolve_model():
    # Should keep llama3 if HIGH
    assert resolve_model("llama3", HardwareTier.HIGH) == "llama3"
    
    # Should downgrade to phi3 if MEDIUM
    assert resolve_model("llama3", HardwareTier.MEDIUM) == "phi3"
    
    # Should return None if LOW
    assert resolve_model("llama3", HardwareTier.LOW) is None
