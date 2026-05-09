"""Runway avatar conversation transcript client (PR AJ).

After a realtime session ends, the same id Runway returns from
``POST /v1/realtime_sessions`` (the ``sessionId`` AdSpark already
captures) doubles as the ``conversationId`` for transcript /
recording retrieval. See
``docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md`` §7.

This module wraps:
- ``GET /v1/avatar_conversations/{id}`` for the persisted transcript
  + recording URL of a completed session.

Mock mode short-circuits with a deterministic 3-turn transcript
derived from the saved campaign + character + commercial_script so
operators can review the replay UX (and Playwright can verify it)
without ever talking to Runway. Real mode hits the documented
endpoint and normalises the response into the same ``turns`` shape
the frontend renders.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional

import httpx

from ..config import Settings
from ..models import Campaign, TranscriptTurn

logger = logging.getLogger(__name__)


@dataclass
class TranscriptResult:
    """Result of a transcript fetch. ``status`` mirrors the persisted
    enum on the Campaign model so the route can hand the status
    straight to the storage helper.
    """

    status: str  # "ok" | "failed" | "mock" | "empty" | "no_session"
    conversation_id: Optional[str] = None
    turns: list[TranscriptTurn] = field(default_factory=list)
    error: Optional[str] = None
    mock_mode: bool = False
    fetched_at: Optional[datetime] = None


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _now() -> datetime:
    return datetime.now(timezone.utc)


def mock_conversation_id(campaign_id: str) -> str:
    """Deterministic mock conversation id for the given campaign so
    repeated fetches in mock mode return a stable replay handle.
    """
    digest = hashlib.sha256(f"conv:{campaign_id}".encode("utf-8")).hexdigest()[:16]
    return f"mock_conv_{digest}"


def _mock_turns(campaign: Campaign, character: Optional[dict]) -> list[TranscriptTurn]:
    """Build a deterministic 3-turn transcript that mirrors the kind
    of conversation a brand spokesperson session actually produces:
    avatar opens, user asks a campaign question, avatar grounds
    in the brief. Used end-to-end by the mock-mode replay so the UI
    + smoke can verify multi-speaker rendering without keys.
    """
    business = (campaign.business or "this brand").strip() or "this brand"
    product = (campaign.product or "").strip()
    audience = (campaign.audience or "").strip()
    concept = campaign.selected_concept
    hook = (concept.hook if concept else "") or ""
    cta = (concept.cta if concept else "") or ""
    char_name = ((character or {}).get("name") or "").strip()
    speaker = char_name or "Brand Spokesperson"

    opener = (
        f"Hi, I'm {char_name}. " if char_name else "Hi there. "
    ) + f"I'm here to talk about {business}"
    if product:
        opener += f" and {product}"
    opener += "."
    if hook:
        opener += f" {hook.strip().rstrip('.')}."

    user_q = (
        "What makes "
        + (product or business)
        + " different"
        + (f" for {audience}" if audience else "")
        + "?"
    )

    answer_bits: list[str] = []
    if hook:
        answer_bits.append(hook.strip().rstrip("."))
    if campaign.commercial_script:
        # First sentence of the saved script keeps the answer specific.
        first = (campaign.commercial_script or "").split(".")[0].strip()
        if first:
            answer_bits.append(first)
    if cta:
        answer_bits.append(cta.strip().rstrip("."))
    if not answer_bits:
        answer_bits.append("It's built around the brief I have on hand.")
    answer = " ".join(b.rstrip(".") + "." for b in answer_bits[:3])

    return [
        TranscriptTurn(role="avatar", speaker=speaker, text=opener),
        TranscriptTurn(role="user", speaker="Visitor", text=user_q),
        TranscriptTurn(role="avatar", speaker=speaker, text=answer),
    ]


def _normalise_turns(payload: dict) -> list[TranscriptTurn]:
    """Map a Runway transcript payload into our ``TranscriptTurn``
    list. Tolerant of the documented but slightly variable shape:
    Runway returns ``transcript`` either as a list of
    ``{role, text, timestamp}`` dicts or a single string fallback;
    we accept both.
    """
    raw = payload.get("transcript") or payload.get("turns") or []
    out: list[TranscriptTurn] = []
    if isinstance(raw, list):
        for entry in raw:
            if not isinstance(entry, dict):
                continue
            role = (entry.get("role") or entry.get("speaker") or "system").lower()
            if role not in {"avatar", "user", "system"}:
                role = "system"
            text = (entry.get("text") or entry.get("content") or "").strip()
            if not text:
                continue
            out.append(TranscriptTurn(
                role=role,  # type: ignore[arg-type]
                speaker=entry.get("speaker"),
                text=text,
                timestamp=entry.get("timestamp") or entry.get("at"),
            ))
    elif isinstance(raw, str) and raw.strip():
        # Fallback: split on lines so at least *something* renders.
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            out.append(TranscriptTurn(role="system", text=line))
    return out


def fetch_transcript(
    campaign: Campaign,
    settings: Settings,
    *,
    character: Optional[dict] = None,
    conversation_id_override: Optional[str] = None,
    timeout: float = 15.0,
) -> TranscriptResult:
    """Fetch the transcript for the campaign's most recent realtime
    session. ``conversation_id_override`` lets an operator replay a
    session that wasn't created from this AdSpark instance.

    Mock mode: returns a deterministic 3-turn replay built from the
    campaign brief. The conversation id is a stable
    ``mock_conv_<sha-of-campaign-id>`` so re-fetches return the same
    handle; the persisted ``runway_conversation_id`` on the campaign
    is also accepted as the override input when the user supplies it.

    Real mode: ``GET /v1/avatar_conversations/{id}``. Empty / missing
    / non-2xx responses surface as a structured ``TranscriptResult``
    so the route can persist the right error state without raising.
    """
    if settings.runway_mock:
        cid = conversation_id_override or campaign.runway_conversation_id or mock_conversation_id(campaign.id)
        return TranscriptResult(
            status="mock",
            conversation_id=cid,
            turns=_mock_turns(campaign, character),
            mock_mode=True,
            fetched_at=_now(),
        )

    cid = conversation_id_override or campaign.runway_conversation_id
    if not cid:
        return TranscriptResult(
            status="no_session",
            error=(
                "no realtime session has been created for this campaign yet — "
                "start a conversation, then fetch the transcript."
            ),
        )

    url = f"{settings.runway_api_base}/v1/avatar_conversations/{cid}"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=_runway_headers(settings))
    except httpx.HTTPError as exc:
        return TranscriptResult(
            status="failed",
            conversation_id=cid,
            error=f"http error: {exc!s}"[:200],
        )

    if resp.status_code == 404:
        return TranscriptResult(
            status="empty",
            conversation_id=cid,
            error="conversation not yet recorded by Runway",
        )
    if resp.status_code != 200:
        return TranscriptResult(
            status="failed",
            conversation_id=cid,
            error=f"transcript fetch rc={resp.status_code}: {resp.text[:200]}",
        )
    try:
        payload = resp.json()
    except ValueError as exc:
        return TranscriptResult(
            status="failed",
            conversation_id=cid,
            error=f"non-json transcript response: {exc!s}"[:200],
        )

    turns = _normalise_turns(payload)
    if not turns:
        return TranscriptResult(
            status="empty",
            conversation_id=cid,
            error="conversation returned no turns",
            fetched_at=_now(),
        )
    return TranscriptResult(
        status="ok",
        conversation_id=cid,
        turns=turns,
        fetched_at=_now(),
    )
