"""
PraxLight — Model Router (Phase 2 Offline Engine)

Supports four backends in priority order:
  1. OpenRouter  — if OPENROUTER_API_KEY is present
  2. Google AI   — if GOOGLE_AI_API_KEY is present
  3. Ollama      — Local inference fallback
  4. Deterministic offline reasoner — always available

Whatever backend answers, it only ever sees `AgentActRequest` — the already-
sanitized payload. There is no code path that can reach raw page content.

Mirrors the provider-adapter pattern from the sibling Prax AI project.
"""
from llm import router

__all__ = ["router"]
