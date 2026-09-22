import pytest
from server.privacy.engine import sanitize_text

def test_sanitize_text_email():
    raw = "My email is secret@example.com."
    safe, audit = sanitize_text(raw)
    
    assert "secret@example.com" not in safe
    assert "[EMAIL_1]" in safe
    assert audit.detections_count == 1
    assert "email" in audit.entities_detected

def test_sanitize_text_phone():
    raw = "Call me at +91 9876543210"
    safe, audit = sanitize_text(raw)
    
    assert "9876543210" not in safe
    assert "[PHONE_1]" in safe
    assert audit.detections_count == 1

def test_sanitize_text_card():
    # A generic test luhn-valid number: 4111 1111 1111 1111 is commonly used in testing
    raw = "My card is 4111 1111 1111 1111 please charge it."
    safe, audit = sanitize_text(raw)
    
    assert "4111 1111 1111 1111" not in safe
    assert "[CARD_REDACTED]" in safe
    assert audit.detections_count == 2
    assert "card_number" in audit.entities_detected
    assert "gov_id_like" in audit.entities_detected

def test_sanitize_text_multiple():
    raw = "Customer John (john@test.com) called from 9876543210. His alternate email is john@test.com."
    safe, audit = sanitize_text(raw)
    
    assert "john@test.com" not in safe
    assert "9876543210" not in safe
    assert safe == "Customer John ([EMAIL_1]) called from [PHONE_1]. His alternate email is [EMAIL_1]."
    assert audit.detections_count == 3  # 2 emails, 1 phone
    assert audit.redactions_count == 2  # email is deduplicated in token map
