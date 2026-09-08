#!/usr/bin/env python3
"""
PraxSight — Server-side Reasoning + Structured Action API
SIH26171

This process receives ONLY sanitized, redacted context from the browser
extension's privacy gate (extension/background.js). It never sees raw PII
by design — see docs/PRIVACY_MODEL.md for the full data-flow diagram.
"""
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Load .env so OPENROUTER_API_KEY etc. are available when agent.py initialises
# ModelRouter. This is safe to call even when the file is absent.
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent.parent
load_dotenv(BASE_DIR / ".env")

sys.path.insert(0, str(Path(__file__).parent))

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from schemas import AgentAction, AgentActRequest
from validator import ValidationError, validate_action
from agent import router as model_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
log = logging.getLogger("praxsight")

DEMO_DIR = BASE_DIR / "demo"
DASHBOARD_DIR = BASE_DIR / "dashboard"
latest_session = {"updated_at": None, "scan": None, "action": None, "network": None}

app = FastAPI(title="PraxSight Agent API", version="0.1.0", docs_url="/api/docs", redoc_url=None)

# Dev-only: unrestricted CORS so the unpacked extension can call in from any
# extension ID during development. Scope this to chrome-extension://<id> and
# drop the wildcard before shipping anywhere real.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)

if DEMO_DIR.exists():
    app.mount("/demo", StaticFiles(directory=str(DEMO_DIR), html=True), name="demo")
if DASHBOARD_DIR.exists():
    app.mount("/dashboard", StaticFiles(directory=str(DASHBOARD_DIR), html=True), name="dashboard")


@app.get("/")
async def dashboard_index():
    return {"service": "praxsight-agent-api", "dashboard": "/dashboard/", "demo": "/demo/support-ticket/"}


@app.get("/api/health")
async def health():
    return {"status": "ok", "service": "praxsight-agent-api", "version": "0.1.0"}


@app.get("/api/session/latest")
async def latest_session_state():
    return latest_session


@app.post("/api/session/latest")
async def update_session_state(event: dict):
    latest_session.update({key: event[key] for key in ("scan", "action", "network") if key in event})
    latest_session["updated_at"] = datetime.now(timezone.utc).isoformat()
    return {"ok": True, "updated_at": latest_session["updated_at"]}


@app.post("/api/agent/act", response_model=AgentAction)
async def agent_act(req: AgentActRequest):
    # ── Server-side privacy gate: defense-in-depth pass #3 ──────────────────
    # Passes #1 and #2 already ran client-side (content-script.js's residual
    # scan, then background.js's gate check) before this request was even
    # sent. This is not redundant paranoia — a compromised or modified
    # extension build could skip its own checks, so the server independently
    # refuses to reason over a payload that doesn't declare sanitization.
    if not req.privacy_manifest.performed:
        raise HTTPException(400, "Payload does not declare a completed privacy scan — refusing to process.")

    log.info(
        "agent_act task=%r entities_detected=%d entities_redacted=%d page=%s",
        req.task,
        req.privacy_manifest.entities_detected,
        req.privacy_manifest.entities_redacted,
        req.page_url,
    )

    action = await model_router.reason(req)

    try:
        action = validate_action(action, req.elements)
    except ValidationError as e:
        log.warning("agent_act validation rejected action: %s", e)
        raise HTTPException(422, str(e))

    latest_session.update({
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "scan": {
            "entitiesDetected": req.privacy_manifest.entities_detected,
            "entitiesRedacted": req.privacy_manifest.entities_redacted,
            "sanitized": True,
        },
        "action": action.model_dump(),
        "network": {"status": "ALLOWED"},
    })

    return action


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
