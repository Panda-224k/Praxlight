import re
from typing import List, Dict, Any

class PATTERNS:
    EMAIL = re.compile(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}')
    # +91 or starting with 6-9 and 10 digits
    PHONE_IN = re.compile(r'(?:\+91[\s-]?)?[6-9]\d{9}\b')
    # 13 to 19 digits, possibly with spaces or dashes
    CARD = re.compile(r'\b(?:\d[ -]?){13,19}\b')
    # 5 letters, 4 digits, 1 letter
    PAN = re.compile(r'\b[A-Z]{5}\d{4}[A-Z]\b')
    # 12 digits, often formatted as 4 4 4
    AADHAAR_LIKE = re.compile(r'\b\d{4}\s?\d{4}\s?\d{4}\b')

def luhn_valid(num_str: str) -> bool:
    """Validate a credit card number using the Luhn algorithm."""
    digits = re.sub(r'\D', '', num_str)
    if len(digits) < 12 or len(digits) > 19:
        return False
        
    total = 0
    alt = False
    for i in range(len(digits) - 1, -1, -1):
        n = int(digits[i])
        if alt:
            n *= 2
            if n > 9:
                n -= 9
        total += n
        alt = not alt
    return (total % 10) == 0

def detect_in_text(text: str, ps_id: str = "backend", bbox: dict = None) -> List[Dict[str, Any]]:
    """
    Scan raw text for PII using regex and checksums.
    Returns a list of Detection objects represented as dicts.
    """
    found = []
    
    def push(dtype, value, confidence, severity):
        found.append({
            "type": dtype,
            "value": value,
            "psId": ps_id,
            "bbox": bbox,
            "source": ["rules-text"],
            "confidence": confidence,
            "severity": severity
        })

    for m in PATTERNS.EMAIL.finditer(text):
        push("email", m.group(0), 0.97, "high")

    for m in PATTERNS.CARD.finditer(text):
        if luhn_valid(m.group(0)):
            push("card_number", m.group(0), 0.95, "critical")

    for m in PATTERNS.PAN.finditer(text):
        push("gov_id_pan", m.group(0), 0.9, "high")

    for m in PATTERNS.AADHAAR_LIKE.finditer(text):
        push("gov_id_like", m.group(0), 0.5, "high")

    for m in PATTERNS.PHONE_IN.finditer(text):
        push("phone", m.group(0), 0.85, "medium")

    return found
