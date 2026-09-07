# PraxSight

**SIH26171 — On-device Visual Perception for Light-weight Browser Agents**
Organization: ISRO · Category: Software · Theme: Miscellaneous

> See locally. Redact locally. Reason on sanitized context. Act only with a human's OK.

PraxSight is a Manifest V3 browser extension plus a small FastAPI backend. The
extension reads the current page's DOM and text locally, detects PII with
regex + structural rules, replaces it with semantic tokens (`[EMAIL_1]`,