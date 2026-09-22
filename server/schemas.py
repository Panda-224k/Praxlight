"""
PraxSight — API schemas (Phase 7: Structured Agent Action Protocol)

The server never accepts raw page content and never returns arbitrary code.
AgentActRequest is what the extension's privacy gate is allowed to send;
AgentAction is the *only* shape the server is allowed to return — see
validator.py for what's enforced on top of this.
"""
from __future__ import annotations

from typing import Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class SanitizedInput(BaseModel):
    psId: str
    tag: str
    type: str = "text"
    label: str = ""
    value: str = ""
    bbox: Dict[str, float] = Field(default_factory=dict)


class SanitizedInteractive(BaseModel):
    psId: str
    tag: str
    role: str = "button"
    text: str = ""
    bbox: Dict[str, float] = Field(default_factory=dict)


class SanitizedTextNode(BaseModel):
    psId: str
    text: str = ""
    bbox: Dict[str, float] = Field(default_factory=dict)


class PrivacyManifest(BaseModel):
    performed: bool
    version: str
    detectors: List[str] = Field(default_factory=list)
    entities_detected: int = 0
    entities_redacted: int = 0
    by_type: Dict[str, int] = Field(default_factory=dict)
    generated_at: str


class ElementsPayload(BaseModel):
    inputs: List[SanitizedInput] = Field(default_factory=list)
    interactive: List[SanitizedInteractive] = Field(default_factory=list)


class ToolPermissions(BaseModel):
    allow_rag: bool = True
    allow_browser: bool = True
    allow_calculator: bool = False
    allow_file_reader: bool = False

class AgentActRequest(BaseModel):
    task: str = Field(..., min_length=1, max_length=2000)
    page_url: str
    elements: ElementsPayload
    text_context: List[SanitizedTextNode] = Field(default_factory=list)
    privacy_manifest: PrivacyManifest
    tool_permissions: ToolPermissions = Field(default_factory=ToolPermissions)


class ActionTarget(BaseModel):
    type: Literal["element_id"] = "element_id"
    id: str


ActionName = Literal["click", "focus", "scroll", "select", "navigate", "read", "wait", "type"]


class AgentAction(BaseModel):
    action: ActionName
    target: Optional[ActionTarget] = None
    value_policy: Optional[Literal["user-provided"]] = None
    reason: str
    risk: Literal["low", "medium", "high"] = "low"
    requires_approval: bool = False
    validated: bool = False
    status: Literal["DRAFT", "VALIDATED", "PENDING_APPROVAL", "APPROVED", "EXECUTED"] = "DRAFT"
