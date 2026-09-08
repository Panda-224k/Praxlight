#!/usr/bin/env python3
"""
PraxSight — One-Command Launcher
Starts the FastAPI backend (which also serves the demo pages) and prints
exactly what to do next to load the extension.
Usage: python run.py
"""
import sys
import webbrowser
from pathlib import Path

# Load .env before anything else so OPENROUTER_API_KEY, GOOGLE_AI_API_KEY,
# ANTHROPIC_API_KEY etc. are visible to agent.py when uvicorn imports it.
from dotenv import load_dotenv

BASE_DIR = Path(__file__).parent
load_dotenv(BASE_DIR / ".env")
sys.path.insert(0, str(BASE_DIR / "server"))

PORT = int(__import__("os").environ.get("PORT", 8000))
BACKEND_URL = f"http://localhost:{PORT}"
DEMO_URL = f"{BACKEND_URL}/demo/support-ticket/"


def print_banner():
    print()
    print("  +----------------------------------------------------+")
    print("  |   PraxSight  ·  SIH26171  ·  v0.1.0               |")
    print("  +----------------------------------------------------+")
    print(f"  |  Backend API   -> {BACKEND_URL:<32} |")
    print(f"  |  API docs      -> {BACKEND_URL + '/api/docs':<32} |")
    print(f"  |  Demo page     -> {DEMO_URL:<32} |")
    print("  +----------------------------------------------------+")
    print()
    print("  Next: chrome://extensions -> Developer mode -> Load unpacked")
    print("  -> select the extension/ folder. Then open the demo page above")
    print("  and click the PraxSight toolbar icon.")
    print()


if __name__ == "__main__":
    print_banner()
    try:
        webbrowser.open(DEMO_URL)
    except Exception:
        pass

    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=PORT, log_level="info", app_dir=str(BASE_DIR / "server"))
