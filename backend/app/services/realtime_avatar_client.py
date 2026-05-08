"""Runway realtime avatar session broker (PR I).

Three-party broker for the "Talk to your Brand Spokesperson" feature.
Creates a /v1/realtime_sessions session, polls until READY, then
returns ONLY the client-safe payload (session id, session key, expiry)
to the browser.  ``RUNWAY_API_KEY`` never leaves FastAPI.

Mock mode short-circuits with a structured "unavailable" error; the
router maps it to HTTP 503 so the frontend can render a disabled
button instead of attempting WebRTC.

Realtime is **strictly additive** — every other AdSpark flow keeps
working when this surface is unavailable. The broker assumes the
campaign already has a READY Brand Spokesperson Avatar (PR F V2);
the router enforces the gate.

See ``docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md`` for the
locked schema and the rationale behind every choice in this module.
"""
from __future__ import annotations

import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from ..config import Settings
from ..models import Campaign
from .character_host_client import active_avatar_id, active_avatar_status

logger = logging.getLogger(__name__)

_REALTIME_MODEL = "gwm1_avatars"

# Empirical: NOT_READY → READY in ~1.5 s. Allow generous slack for
# upstream variability without blocking the request indefinitely.
_READY_POLL_INTERVAL_S = 0.5
_READY_POLL_TIMEOUT_S = 30.0


@dataclass
class RealtimeSession:
    """Client-safe shape returned by the broker. Mirrors what
    ``@runwayml/avatars-react`` consumes via ``<AvatarCall>``.
    """

    session_id: str
    session_key: str  # JWT-shaped opaque token; safe for the browser
    expires_at: Optional[str] = None
    avatar_id: Optional[str] = None


class RealtimeUnavailableError(RuntimeError):
    """Raised when realtime cannot proceed — mock mode, missing avatar,
    or persistent upstream failure. Router maps to 503 / 409 / 502.
    """


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def create_session(campaign: Campaign, settings: Settings) -> RealtimeSession:
    """Create + poll a Runway realtime session for the campaign's host
    avatar. Returns the client-safe payload.

    Raises ``RealtimeUnavailableError`` on mock mode, missing avatar,
    or any persistent upstream condition.  ``httpx.HTTPStatusError`` /
    other ``httpx.HTTPError`` propagate so the router can map to 502.
    """
    if settings.runway_mock:
        raise RealtimeUnavailableError(
            "Realtime is unavailable in mock mode. Set RUNWAY_API_KEY to enable."
        )
    avatar_id = active_avatar_id(campaign)
    avatar_status = active_avatar_status(campaign)
    if not avatar_id or avatar_status != "ready":
        # Mock avatars and not-yet-ready customs are deliberately
        # excluded — they're not valid Runway resources for realtime.
        raise RealtimeUnavailableError(
            "A ready Runway Avatar is required before starting a "
            "realtime session. Pick one from the avatar list or run "
            "POST /api/campaigns/{id}/avatar."
        )

    body = {
        "model": _REALTIME_MODEL,
        "avatar": {"type": "custom", "avatarId": avatar_id},
    }
    create_url = f"{settings.runway_api_base}/v1/realtime_sessions"
    with httpx.Client(timeout=20.0) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
        if resp.status_code != 200:
            raise RealtimeUnavailableError(
                f"realtime session create failed: {resp.status_code} {resp.text[:300]}"
            )
        created = resp.json()
    session_id = created.get("id")
    if not session_id:
        raise RealtimeUnavailableError(
            f"realtime session create missing id: {created}"
        )

    # Poll until READY (typically <2 s). Don't poll forever — if Runway
    # can't get to READY in 30 s something is wrong upstream.
    detail_url = f"{settings.runway_api_base}/v1/realtime_sessions/{session_id}"
    payload: dict = created
    deadline = time.time() + _READY_POLL_TIMEOUT_S
    with httpx.Client(timeout=10.0) as client:
        while time.time() < deadline:
            r = client.get(detail_url, headers=_runway_headers(settings))
            r.raise_for_status()
            payload = r.json()
            status = (payload.get("status") or "").upper()
            if status == "READY":
                break
            if status in {"FAILED", "CANCELLED"}:
                # Best effort cleanup, then surface
                _safe_delete(session_id, settings)
                raise RealtimeUnavailableError(
                    f"realtime session {status.lower()}: "
                    f"{payload.get('failure') or payload.get('failureCode') or 'unknown'}"
                )
            time.sleep(_READY_POLL_INTERVAL_S)
        else:
            _safe_delete(session_id, settings)
            raise RealtimeUnavailableError(
                "realtime session did not reach READY within "
                f"{int(_READY_POLL_TIMEOUT_S)}s"
            )

    session_key = payload.get("sessionKey")
    if not session_key:
        _safe_delete(session_id, settings)
        raise RealtimeUnavailableError(
            "realtime session READY but no sessionKey in payload"
        )

    return RealtimeSession(
        session_id=session_id,
        session_key=session_key,
        expires_at=payload.get("expiresAt"),
        avatar_id=avatar_id,
    )


def delete_session(session_id: str, settings: Settings) -> bool:
    """Best-effort DELETE for clean teardown. Returns True if Runway
    accepted the cancellation. Mock mode and any failure is non-fatal.
    """
    if settings.runway_mock:
        return False
    try:
        return _safe_delete(session_id, settings)
    except Exception:
        logger.exception("realtime session delete crashed; ignoring")
        return False


def _safe_delete(session_id: str, settings: Settings) -> bool:
    """Internal helper. Never raises."""
    try:
        url = f"{settings.runway_api_base}/v1/realtime_sessions/{session_id}"
        with httpx.Client(timeout=10.0) as client:
            r = client.delete(url, headers=_runway_headers(settings))
        # 204 happy path; 404 means already gone. Both fine.
        return r.status_code in {204, 404}
    except httpx.HTTPError as exc:
        logger.warning("realtime session delete http error: %s", exc)
        return False
    except Exception:
        logger.exception("realtime session delete unexpected")
        return False
