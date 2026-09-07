# PraxSight — Structured Agent Action Protocol

The server never returns arbitrary JavaScript or a free-text plan. It
returns exactly one `AgentAction` (`server/schemas.py`), and that action only
reaches the page after `server/validator.py` has checked it.

## Request: `AgentActRequest`
