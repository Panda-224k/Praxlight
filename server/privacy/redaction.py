from typing import List, Dict, Any, Tuple

COUNTERLESS_TYPES = {
    "password",
    "otp",
    "secret_key",
    "card_number",
    "account_number",
    "gov_id_pan",
    "gov_id_like",
}

TOKEN_LABELS = {
    "email": "EMAIL",
    "person_name": "PERSON",
    "phone": "PHONE",
    "address": "ADDRESS",
    "card_number": "CARD",
    "account_number": "ACCOUNT",
    "gov_id_pan": "GOVID",
    "gov_id_like": "GOVID",
    "date_of_birth": "DOB",
    "otp": "OTP",
    "password": "PASSWORD",
    "secret_key": "SECRET",
}

def dedupe(detections: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    seen = {}
    for d in detections:
        key = f"{d['type']}:{d['value']}"
        prior = seen.get(key)
        if not prior or prior['confidence'] < d['confidence']:
            seen[key] = d
    return list(seen.values())

def build_token_map(detections: List[Dict[str, Any]]) -> Dict[str, str]:
    counters = {}
    token_map = {}
    
    for d in dedupe(detections):
        raw_val = d.get('value')
        if not raw_val:
            continue
            
        dtype = d.get('type')
        label = TOKEN_LABELS.get(dtype, dtype.upper())
        
        if raw_val in token_map:
            continue
            
        if dtype in COUNTERLESS_TYPES:
            token_map[raw_val] = f"[{label}_REDACTED]"
        else:
            counters[label] = counters.get(label, 0) + 1
            token_map[raw_val] = f"[{label}_{counters[label]}]"
            
    return token_map

def redact_text(text: str, token_map: Dict[str, str]) -> str:
    if not text:
        return text or ""
    
    out = text
    for raw, token in token_map.items():
        if raw:
            out = out.replace(raw, token)
    return out
