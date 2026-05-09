"""Custom voice cloning client (PR AN).

Wraps Runway's ``POST /v1/voices`` with ``from.type=audio`` so a brand
can clone a founder / mascot / spokesperson voice from a 30-second
sample. The result is a Runway voice id that AdSpark persists on the
Character record and prefers over the runway-live-preset binding when
new avatars are created (see ``character_studio_client._create_avatar_real``).

Why a separate module:
``audio_client.py`` already owns the design-brand-voice flow
(``from.type=text-design``). The audio-clone path is sibling-shaped
but its own ``from`` shape, error vocabulary, and persistence target
(Character vs Campaign), so a small dedicated module keeps the call
graph readable. Both modules stay under the same `/v1/voices` umbrella.

Mock mode short-circuits with a deterministic
``mock_voice_<sha256(name + audio_bytes)>[:16]`` id so a reupload of
the same sample is idempotent and a fresh sample yields a new id —
the same pattern PR AI / PR AJ used for documents + transcripts.

Per ``docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md`` §6 the sample
must be 10 s – 5 min, ≤ 10 MB. We enforce a generous client-side cap
(15 MB) so an oversized upload fails before hitting the wire; Runway
remains the authoritative validator.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)

# Runway documented cap is 10 MB; we accept up to 15 MB locally so the
# end user sees a friendly 422 instead of a wire-truncation surprise.
MAX_AUDIO_BYTES = 15 * 1024 * 1024

# Allowed mimetypes — keep the surface small and easy to reason about.
SUPPORTED_AUDIO_MIMES = {
    "audio/mpeg": "mp3",
    "audio/mp3": "mp3",
    "audio/wav": "wav",
    "audio/x-wav": "wav",
    "audio/wave": "wav",
    "audio/m4a": "m4a",
    "audio/mp4": "m4a",
    "audio/x-m4a": "m4a",
    "audio/aac": "m4a",
    "audio/webm": "webm",
    "audio/ogg": "ogg",
}


@dataclass
class VoiceCloneResult:
    """Mirrors the persisted enum on the Character record so the route
    can hand the status straight to the storage helper.
    """

    status: str  # "ready" | "failed" | "mock"
    voice_id: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False
    # PR AR — previewUrl from the Runway voice resource (READY poll
    # response). ``None`` in mock mode (no playable URL) and when the
    # real-mode poll didn't surface one before timeout. Caller treats
    # missing preview as non-fatal.
    preview_url: Optional[str] = None


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def mock_voice_id(name: str, audio_bytes: bytes) -> str:
    """Deterministic mock id keyed off ``name + audio_bytes`` so the
    same upload returns the same id and a re-clone with new audio
    yields a new id. Hash truncated to 16 chars — same shape as
    PR AI's ``mock_doc_<sha>``.
    """
    digest = hashlib.sha256(name.encode("utf-8") + b"::" + audio_bytes).hexdigest()[:16]
    return f"mock_voice_{digest}"


def _data_uri(audio_bytes: bytes, mime: str) -> str:
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _extract_preview_url(payload: Optional[dict]) -> Optional[str]:
    """PR AR — Runway has shipped both ``previewUrl`` and ``preview_url``
    casings in different docs. Tolerate both (and the stripped form)
    so a future server-side rename doesn't silently drop the preview.
    """
    if not isinstance(payload, dict):
        return None
    for key in ("previewUrl", "preview_url", "preview"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _create_voice_real(
    name: str,
    audio_bytes: bytes,
    mime: str,
    settings: Settings,
    *,
    timeout: float = 60.0,
    poll_seconds: float = 90.0,
) -> tuple[str, str, Optional[str]]:
    """Returns ``(voice_id, final_status, preview_url)``. Raises
    ``RuntimeError`` for any non-2xx / non-READY outcome — the caller
    wraps the error into a ``VoiceCloneResult``.

    PR AR — preview URL is captured from whichever poll response
    flips status to ``READY`` (audio_client follows the same shape
    for text-design voices). Returned as ``None`` when Runway never
    surfaces one before the poll deadline; the caller treats missing
    preview as non-fatal so the clone + apply flow still succeeds.
    """
    body = {
        "name": name,
        "from": {
            "type": "audio",
            "audio": _data_uri(audio_bytes, mime),
        },
    }
    create_url = f"{settings.runway_api_base}/v1/voices"
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
    if resp.status_code != 200:
        raise RuntimeError(
            f"voice clone create failed: {resp.status_code} {resp.text[:300]}"
        )
    created = resp.json()
    voice_id = created.get("id")
    if not voice_id:
        raise RuntimeError(f"voice clone create missing id: {created}")

    detail_url = f"{settings.runway_api_base}/v1/voices/{voice_id}"
    deadline = time.time() + poll_seconds
    final_status = (created.get("status") or "").upper()
    last_payload: dict = created
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline and final_status not in {"READY", "FAILED"}:
            time.sleep(3)
            r = client.get(detail_url, headers=_runway_headers(settings))
            r.raise_for_status()
            last_payload = r.json() or {}
            final_status = (last_payload.get("status") or "").upper()
    if final_status == "FAILED":
        raise RuntimeError("Runway rejected the voice clone request.")
    if final_status != "READY":
        raise RuntimeError(f"voice clone did not reach READY (final: {final_status})")
    preview_url = _extract_preview_url(last_payload)
    return voice_id, final_status, preview_url


def fetch_voice_preview(
    voice_id: str,
    settings: Settings,
    *,
    timeout: float = 15.0,
) -> Optional[str]:
    """PR AR — best-effort `GET /v1/voices/{id}` to refresh a missing
    or stale ``previewUrl``. Returns ``None`` in mock mode, when the
    voice id is missing/mock, or on any HTTP / network error. Never
    raises — caller treats missing preview as non-fatal.
    """
    if not voice_id or settings.runway_mock or str(voice_id).startswith("mock_"):
        return None
    url = f"{settings.runway_api_base}/v1/voices/{voice_id}"
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=_runway_headers(settings))
    except httpx.HTTPError as exc:
        logger.warning("voice detail http error for %s: %s", voice_id, exc)
        return None
    if resp.status_code >= 400:
        logger.warning(
            "voice detail non-2xx for %s: %s %s",
            voice_id, resp.status_code, resp.text[:200],
        )
        return None
    try:
        return _extract_preview_url(resp.json())
    except ValueError:
        return None


def clone_voice_from_audio(
    name: str,
    audio_bytes: bytes,
    mime: str,
    settings: Settings,
) -> VoiceCloneResult:
    """Public entry — clone a voice from an uploaded audio sample.
    Never raises; caller inspects the ``VoiceCloneResult`` and persists
    the chosen status / id.

    Mock mode: returns a deterministic ``mock_voice_<sha>`` id so the
    UI can demo + tests can verify the wiring without burning credits.
    """
    cleaned_name = (name or "Custom Voice").strip()[:80] or "Custom Voice"
    if not audio_bytes:
        return VoiceCloneResult(
            status="failed",
            error="audio sample is empty",
            mock_mode=settings.runway_mock,
        )

    if settings.runway_mock:
        return VoiceCloneResult(
            status="mock",
            voice_id=mock_voice_id(cleaned_name, audio_bytes),
            mock_mode=True,
        )

    try:
        voice_id, _final, preview_url = _create_voice_real(
            cleaned_name, audio_bytes, mime, settings,
        )
    except httpx.HTTPError as exc:
        return VoiceCloneResult(
            status="failed",
            error=f"http error: {exc!s}"[:200],
        )
    except RuntimeError as exc:
        return VoiceCloneResult(
            status="failed",
            error=str(exc)[:200],
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("voice clone unexpected")
        return VoiceCloneResult(
            status="failed",
            error=f"unexpected: {exc!s}"[:200],
        )
    return VoiceCloneResult(
        status="ready",
        voice_id=voice_id,
        preview_url=preview_url,
    )


# ---- PR AQ — Avatar PATCH for custom voice swap -------------------


@dataclass
class VoiceApplyResult:
    """Result of `PATCH /v1/avatars/{id}` swapping in a custom voice.

    Status vocabulary mirrors the persisted enum on the Character
    record so the route hands the value straight to the storage
    helper. ``mock_patched`` distinguishes the offline-demo path
    from a real patch.
    """

    status: str  # "applied" | "mock_patched" | "failed" | "pending_avatar"
    error: Optional[str] = None


@dataclass
class AvatarVoiceState:
    """PR AS — resolved voice state from `GET /v1/avatars/{id}`. The
    route persists every field on the Character record so the UI can
    surface a pill that confirms the bind survived the PATCH (vs.
    just trusting Runway's 2xx).

    ``status`` mirrors the persisted enum:
    - ``verified`` — real fetch returned a parseable voice block
    - ``mock_verified`` — runway_mock OR avatar id starts with
      ``mock_``; the resolved fields are derived deterministically
      from the character's existing custom_voice_id without any HTTP
    - ``unverified`` — fetch attempted but returned no voice block
      (e.g. Runway response shape changed or block is null)
    - ``failed`` — fetch errored (non-2xx / network / non-JSON)
    """

    status: str  # "verified" | "mock_verified" | "unverified" | "failed"
    resolved_type: Optional[str] = None
    resolved_id: Optional[str] = None
    resolved_label: Optional[str] = None
    error: Optional[str] = None


def _extract_voice_block(payload: Optional[dict]) -> Optional[dict]:
    """PR AS — Runway has shipped multiple voice-block shapes across
    revisions (`voice`, `voiceBlock`, `voice_block`). Tolerate them
    all so the introspection survives a server-side rename.
    """
    if not isinstance(payload, dict):
        return None
    for key in ("voice", "voiceBlock", "voice_block"):
        block = payload.get(key)
        if isinstance(block, dict):
            return block
    return None


def _resolve_voice_fields(
    block: Optional[dict],
) -> tuple[Optional[str], Optional[str], Optional[str]]:
    """PR AS — pull ``(type, voiceId, label)`` out of a voice block.
    Tolerant of `type` / `voiceType`, `voiceId` / `voice_id` / `id`,
    `name` / `label`. Returns the first non-empty match per slot;
    missing values stay ``None`` so the persistence layer can write
    a partial record without raising.
    """
    if not isinstance(block, dict):
        return None, None, None

    def _first(*keys: str) -> Optional[str]:
        for key in keys:
            value = block.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
        return None

    return (
        _first("type", "voiceType"),
        _first("voiceId", "voice_id", "id"),
        _first("name", "label", "presetId"),
    )


def fetch_avatar_voice(
    avatar_id: Optional[str],
    settings: Settings,
    *,
    avatar_is_mock: bool = False,
    expected_voice_id: Optional[str] = None,
    timeout: float = 15.0,
) -> AvatarVoiceState:
    """PR AS — `GET /v1/avatars/{avatar_id}` and pull the resolved
    voice block out of the response. Used by the clone-voice +
    apply-voice routes to confirm the PATCH actually landed (rather
    than trusting the 2xx from PR AQ's PATCH alone).

    Mock mode: short-circuits with a deterministic ``mock_verified``
    state derived from ``expected_voice_id`` so the demo flow shows
    the verification end-to-end without any HTTP.

    Never raises. Failure modes surface as ``unverified`` (no voice
    block in the payload) or ``failed`` (network / non-2xx / parse).
    """
    if not avatar_id:
        return AvatarVoiceState(
            status="failed",
            error="no avatar id to introspect",
        )
    if settings.runway_mock or avatar_is_mock or str(avatar_id).startswith("mock_"):
        # Deterministic mock: assume the prior PATCH succeeded with
        # the supplied voice id. Label keeps the mock prefix so the
        # UI can tell the resolved value apart from a real binding.
        if expected_voice_id:
            return AvatarVoiceState(
                status="mock_verified",
                resolved_type="custom",
                resolved_id=expected_voice_id,
                resolved_label=f"mock · {expected_voice_id}",
            )
        return AvatarVoiceState(
            status="mock_verified",
            resolved_type="runway-live-preset",
            resolved_label="mock · preset",
        )

    url = f"{settings.runway_api_base}/v1/avatars/{avatar_id}"
    headers = {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.get(url, headers=headers)
    except httpx.HTTPError as exc:
        logger.warning("avatar GET http error for %s: %s", avatar_id, exc)
        return AvatarVoiceState(
            status="failed",
            error=f"http error: {exc!s}"[:200],
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("avatar GET unexpected")
        return AvatarVoiceState(
            status="failed",
            error=f"unexpected: {exc!s}"[:200],
        )
    if resp.status_code >= 400:
        return AvatarVoiceState(
            status="failed",
            error=f"GET rc={resp.status_code}: {resp.text[:200]}",
        )
    try:
        payload = resp.json()
    except ValueError:
        return AvatarVoiceState(
            status="failed",
            error="non-json avatar response",
        )

    block = _extract_voice_block(payload)
    rtype, rid, rlabel = _resolve_voice_fields(block)
    if not (rtype or rid or rlabel):
        return AvatarVoiceState(
            status="unverified",
            error="avatar response carried no voice block",
        )
    return AvatarVoiceState(
        status="verified",
        resolved_type=rtype,
        resolved_id=rid,
        resolved_label=rlabel,
    )


def apply_voice_to_avatar(
    avatar_id: Optional[str],
    voice_id: Optional[str],
    settings: Settings,
    *,
    avatar_is_mock: bool = False,
    timeout: float = 15.0,
) -> VoiceApplyResult:
    """PATCH ``/v1/avatars/{avatar_id}`` so an existing Runway avatar
    starts speaking with the supplied custom ``voice_id`` — without
    recreating the avatar.

    Mirrors PR AI's `attach_documents_to_avatar` shape: the route
    treats the result as best-effort, persists the status, and the
    overall clone flow still succeeds even if the patch fails.

    Branches:
    - ``pending_avatar`` — caller has no real avatar id yet (mock or
      missing). The next ``Create Runway Avatar`` click will bind
      the voice via the PR AN avatar-create payload, so we just
      surface the state without raising.
    - ``mock_patched`` — runway_mock is true (or avatar id is mock).
      Records the linkage without any HTTP so the demo flow can show
      the patch state end-to-end.
    - ``applied`` — real `PATCH /v1/avatars/{id}` returned 2xx.
    - ``failed`` — non-2xx / network / unexpected error. Stored on
      the character; the cloned voice id stays usable for future
      avatar recreates.

    Never raises; the route inspects the result and persists it.
    """
    if not avatar_id or not voice_id:
        return VoiceApplyResult(
            status="pending_avatar",
            error=(None if not voice_id else "no avatar to apply voice to"),
        )
    if settings.runway_mock or avatar_is_mock or str(avatar_id).startswith("mock_"):
        return VoiceApplyResult(status="mock_patched")

    url = f"{settings.runway_api_base}/v1/avatars/{avatar_id}"
    body = {"voice": {"type": "custom", "voiceId": voice_id}}
    headers = {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.patch(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        logger.warning("avatar PATCH voice http error for %s: %s", avatar_id, exc)
        return VoiceApplyResult(
            status="failed",
            error=f"http error: {exc!s}"[:200],
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("avatar PATCH voice unexpected")
        return VoiceApplyResult(
            status="failed",
            error=f"unexpected: {exc!s}"[:200],
        )
    if resp.status_code >= 400:
        logger.warning(
            "avatar PATCH voice non-2xx for %s: %s %s",
            avatar_id, resp.status_code, resp.text[:200],
        )
        return VoiceApplyResult(
            status="failed",
            error=f"PATCH rc={resp.status_code}: {resp.text[:200]}",
        )
    return VoiceApplyResult(status="applied")
