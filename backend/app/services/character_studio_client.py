"""Character Studio service (PR K).

Two phases mirroring the existing Brand Spokesperson flow:

    1. ``generate_portrait(character, settings, ...)``
       Runway ``gen4_image_turbo`` with a portrait-shaped prompt
       template (see PORTRAIT_TEMPLATES). The locked recipe is
       documented in
       ``docs/research/CHARACTER_STUDIO_SPIKE.md`` §7 and was
       confirmed end-to-end by the Phase K spike probe (raccoon
       barista mascot → READY in ~50 s).
       Mock path generates a deterministic stdlib zlib PNG with
       colour derived from sha256(prompt).

    2. ``create_avatar(character, settings, ...)``
       Hands the cached portrait to ``POST /v1/avatars``, polls to
       READY, persists the avatar id + processed thumbnail. Reuses
       the same primitives as ``character_host_client._create_avatar_real``
       (we just import its helpers rather than duplicating them).

Both phases return result dataclasses; the routers handle storage.
Never raises in normal operation — the result objects carry status
+ optional error messages.
"""
from __future__ import annotations

import base64
import hashlib
import logging
import struct
import time
import uuid
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

import httpx

from ..config import Settings
from ..models import Character

logger = logging.getLogger(__name__)

_IMAGE_MODEL = "gen4_image_turbo"
_MAX_IMAGE_BYTES = 16 * 1024 * 1024
_MAX_PORTRAIT_RATIO = "1280:720"  # landscape; predictable face crop on Runway side


# ---- prompt templates (locked in spike §7) ------------------------

PORTRAIT_TEMPLATES: dict[str, str] = {
    "mascot": (
        "Studio portrait of {subject}. {style}. "
        "Front-facing, head-and-shoulders crop. Expressive eyes, "
        "soft warm smile. Simple solid mid-grey background. Soft "
        "three-point studio lighting. Centered composition. No "
        "props or sunglasses."
    ),
    "founder": (
        "Friendly studio portrait of {subject}. {style}. "
        "Head-and-shoulders, front-facing. Direct eye contact. Soft "
        "natural smile. Clean off-white background. Warm soft "
        "lighting. Photorealistic. Modern founder aesthetic. No "
        "props or sunglasses."
    ),
    "coach": (
        "Energetic studio portrait of {subject}. {style}. "
        "Head-and-shoulders. Confident posture, bright expression, "
        "open mouth mid-speech. Solid muted-blue background. Crisp "
        "directional lighting. Athletic-coach aesthetic. No props "
        "or sunglasses."
    ),
    "local_guide": (
        "Warm portrait of {subject} in a small-business setting. "
        "{style}. Head-and-shoulders, front-facing. Welcoming "
        "smile. Soft-blurred neutral background suggesting indoors. "
        "Natural daylight. Approachable neighborly aesthetic. No "
        "props or sunglasses."
    ),
}


# Default subject + style hints when the user doesn't supply them. Keep
# these neutral so the Runway face check passes.
TEMPLATE_DEFAULTS: dict[str, dict[str, str]] = {
    "mascot": {
        "subject": "a friendly raccoon barista mascot",
        "style": "Photorealistic stylised plush texture",
    },
    "founder": {
        "subject": "an indie brand founder, mid-30s",
        "style": "Polished modern editorial style",
    },
    "coach": {
        "subject": "a fitness coach, mid-30s",
        "style": "Bright high-energy editorial style",
    },
    "local_guide": {
        "subject": "a friendly local-business shopkeeper",
        "style": "Warm documentary editorial style",
    },
}


def build_prompt(
    template: str,
    subject: Optional[str] = None,
    style: Optional[str] = None,
    *,
    prompt_override: Optional[str] = None,
) -> str:
    """Assemble the portrait prompt. ``prompt_override`` wins over
    everything; otherwise we fill the named template.
    """
    if prompt_override and prompt_override.strip():
        return prompt_override.strip()[:1000]
    tpl = PORTRAIT_TEMPLATES.get(template) or PORTRAIT_TEMPLATES["mascot"]
    defaults = TEMPLATE_DEFAULTS.get(template) or TEMPLATE_DEFAULTS["mascot"]
    return tpl.format(
        subject=(subject or defaults["subject"]).strip(),
        style=(style or defaults["style"]).strip(),
    )[:1000]


# ---- result dataclasses ------------------------------------------

@dataclass
class PortraitResult:
    status: str  # "ok" | "failed"
    portrait_path: Optional[Path] = None
    portrait_url: Optional[str] = None  # local /api/characters/{id}/portrait
    portrait_prompt: Optional[str] = None
    portrait_source: str = "stock"
    error: Optional[str] = None
    mock_mode: bool = False


@dataclass
class AvatarBindingResult:
    status: str  # "ready" | "failed" | "mock"
    avatar_id: Optional[str] = None
    thumbnail_url: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False


class CharacterStudioError(RuntimeError):
    """Internal — caught by the public entry points."""


# ---- shared helpers ----------------------------------------------

def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _solid_png(width: int, height: int, rgb: tuple[int, int, int]) -> bytes:
    """Stdlib-only PNG builder — same primitive used in
    ``image_client.py`` and ``avatar_listing_client.py``.
    """
    sig = b"\x89PNG\r\n\x1a\n"

    def chunk(typ: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    row = bytes([0]) + bytes(rgb) * width
    raw = row * height
    idat = zlib.compress(raw, level=9)
    return sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


def _mock_color_for(prompt: str) -> tuple[int, int, int]:
    digest = hashlib.sha256(prompt.encode("utf-8", errors="ignore")).digest()
    return (40 + digest[0] % 120, 30 + digest[1] % 100, 50 + digest[2] % 130)


def _atomic_write_bytes(target: Path, payload: bytes) -> None:
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(payload)
    tmp.replace(target)


def _seed_reference_data_uri() -> str:
    """gen4_image_turbo requires referenceImages >= 1. Seed with a
    flat charcoal PNG so the prompt remains the dominant signal —
    same trick as ``image_client._seed_reference_uri``.
    """
    payload = _solid_png(320, 320, (45, 45, 55))
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


# ---- phase 1: portrait generation --------------------------------

def _download_image_to_disk(url: str, target: Path, timeout: float = 60.0) -> int:
    tmp = target.with_suffix(target.suffix + ".tmp")
    size = 0
    try:
        with httpx.stream("GET", url, timeout=timeout, follow_redirects=True) as resp:
            resp.raise_for_status()
            ctype = (resp.headers.get("content-type") or "").lower()
            if not ctype.startswith("image/"):
                raise CharacterStudioError(
                    f"unexpected content-type: {ctype or '(missing)'}"
                )
            with open(tmp, "wb") as fh:
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    if size > _MAX_IMAGE_BYTES:
                        raise CharacterStudioError(
                            f"portrait exceeds cap ({_MAX_IMAGE_BYTES} bytes)"
                        )
                    fh.write(chunk)
        tmp.replace(target)
        return size
    except CharacterStudioError:
        tmp.unlink(missing_ok=True)
        raise
    except httpx.HTTPError as exc:
        tmp.unlink(missing_ok=True)
        raise CharacterStudioError(f"download error: {exc!s}"[:300]) from exc


def _generate_portrait_real(prompt: str, target: Path, settings: Settings) -> int:
    body = {
        "model": _IMAGE_MODEL,
        "promptText": prompt,
        "ratio": _MAX_PORTRAIT_RATIO,
        "referenceImages": [{"uri": _seed_reference_data_uri(), "tag": "seed"}],
    }
    create_url = f"{settings.runway_api_base}/v1/text_to_image"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
        if resp.status_code != 200:
            raise CharacterStudioError(
                f"portrait create failed: {resp.status_code} {resp.text[:300]}"
            )
        created = resp.json()
    task_id = created.get("id")
    if not task_id:
        raise CharacterStudioError(f"portrait create missing task id: {created}")

    deadline = time.time() + 90
    final_payload = None
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline:
            r = client.get(
                f"{settings.runway_api_base}/v1/tasks/{task_id}",
                headers=_runway_headers(settings),
            )
            r.raise_for_status()
            payload = r.json()
            status = (payload.get("status") or "").upper()
            if status == "SUCCEEDED":
                final_payload = payload
                break
            if status in {"FAILED", "CANCELED"}:
                reason = payload.get("failure") or payload.get("error") or status
                raise CharacterStudioError(f"portrait task {status}: {reason}")
            time.sleep(3)
    if not final_payload:
        raise CharacterStudioError(f"portrait task {task_id} timed out")

    output = final_payload.get("output")
    out_url: Optional[str] = None
    if isinstance(output, list):
        for v in output:
            if isinstance(v, str):
                out_url = v
                break
    if not out_url:
        raise CharacterStudioError(f"portrait task {task_id} produced no output url")

    return _download_image_to_disk(out_url, target)


def generate_portrait(
    character: Character,
    portrait_path: Path,
    settings: Settings,
    *,
    template: Optional[str] = None,
    subject: Optional[str] = None,
    style: Optional[str] = None,
    prompt_override: Optional[str] = None,
) -> PortraitResult:
    """Public entry. Mock-safe; never raises."""
    chosen_template = (template or character.template or "mascot").lower()
    prompt = build_prompt(
        chosen_template,
        subject=subject if subject is not None else character.subject,
        style=style if style is not None else character.style,
        prompt_override=prompt_override,
    )

    if settings.runway_mock:
        try:
            payload = _solid_png(512, 512, _mock_color_for(prompt))
            _atomic_write_bytes(portrait_path, payload)
            return PortraitResult(
                status="ok",
                portrait_path=portrait_path,
                portrait_url=f"/api/characters/{character.id}/portrait",
                portrait_prompt=prompt,
                portrait_source="mock",
                mock_mode=True,
            )
        except OSError as exc:
            return PortraitResult(
                status="failed", error=f"io error: {exc}"[:200], mock_mode=True
            )

    try:
        size = _generate_portrait_real(prompt, portrait_path, settings)
        logger.info(
            "portrait ready character=%s size=%d template=%s",
            character.id, size, chosen_template,
        )
        return PortraitResult(
            status="ok",
            portrait_path=portrait_path,
            portrait_url=f"/api/characters/{character.id}/portrait",
            portrait_prompt=prompt,
            portrait_source="generated",
            mock_mode=False,
        )
    except CharacterStudioError as exc:
        logger.warning("portrait failed character=%s: %s", character.id, exc)
        return PortraitResult(status="failed", error=str(exc)[:300], portrait_prompt=prompt)
    except httpx.HTTPError as exc:
        logger.warning("portrait http error: %s", exc)
        return PortraitResult(status="failed", error=f"http error: {exc!s}"[:300], portrait_prompt=prompt)
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("portrait unexpected")
        return PortraitResult(status="failed", error=f"unexpected: {exc!s}"[:300], portrait_prompt=prompt)


# ---- phase 2: avatar binding -------------------------------------

def _portrait_to_data_uri(portrait_path: Path) -> str:
    data = portrait_path.read_bytes()
    return "data:image/png;base64," + base64.b64encode(data).decode("ascii")


def _create_avatar_real(
    name: str,
    portrait_data_uri: str,
    voice_preset: str,
    personality: Optional[str],
    settings: Settings,
) -> tuple[str, Optional[str]]:
    """Returns (avatar_id, processed_thumbnail_url). Raises on failure."""
    body = {
        "name": name,
        "referenceImage": portrait_data_uri,
        "voice": {"type": "runway-live-preset", "presetId": voice_preset},
        "personality": personality or "Reusable AI brand character.",
    }
    url = f"{settings.runway_api_base}/v1/avatars"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=_runway_headers(settings), json=body)
        if resp.status_code != 200:
            raise CharacterStudioError(
                f"avatar create failed: {resp.status_code} {resp.text[:300]}"
            )
        avatar = resp.json()
    avatar_id = avatar.get("id")
    if not avatar_id:
        raise CharacterStudioError(f"avatar create missing id: {avatar}")

    deadline = time.time() + 180
    detail_url = f"{settings.runway_api_base}/v1/avatars/{avatar_id}"
    final_status = (avatar.get("status") or "").upper()
    payload = avatar
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline and final_status not in {"READY", "FAILED"}:
            time.sleep(5)
            r = client.get(detail_url, headers=_runway_headers(settings))
            r.raise_for_status()
            payload = r.json()
            final_status = (payload.get("status") or "").upper()
    if final_status != "READY":
        raise CharacterStudioError(
            f"avatar processing did not reach READY (final: {final_status})"
        )
    return avatar_id, payload.get("processedImageUri") or payload.get("referenceImageUri")


def create_avatar(
    character: Character,
    portrait_path: Path,
    settings: Settings,
    *,
    voice_preset: Optional[str] = None,
    personality_override: Optional[str] = None,
) -> AvatarBindingResult:
    """Public entry — turn the cached portrait into a Runway Avatar.
    Mock-safe; never raises.
    """
    voice = (voice_preset or character.voice_preset or "vincent").lower()

    if settings.runway_mock:
        avatar_id = f"mock_char_avatar_{uuid.uuid4().hex[:10]}"
        # Use a data URI of the cached portrait as the thumbnail so
        # the UI renders the same image it just generated.
        thumb_uri = None
        try:
            if portrait_path.exists():
                thumb_uri = _portrait_to_data_uri(portrait_path)
        except OSError:
            thumb_uri = None
        return AvatarBindingResult(
            status="mock",
            avatar_id=avatar_id,
            thumbnail_url=thumb_uri,
            mock_mode=True,
        )

    if not portrait_path.exists():
        return AvatarBindingResult(
            status="failed",
            error="portrait must exist before avatar creation",
            mock_mode=False,
        )

    try:
        portrait_data_uri = _portrait_to_data_uri(portrait_path)
        if len(portrait_data_uri) > 5 * 1024 * 1024:  # data URI cap is 5 MB
            return AvatarBindingResult(
                status="failed",
                error="portrait too large for data URI (>5 MB)",
                mock_mode=False,
            )
        avatar_id, thumb_url = _create_avatar_real(
            name=f"AdSpark Character — {character.name[:40]}",
            portrait_data_uri=portrait_data_uri,
            voice_preset=voice,
            personality=personality_override or character.personality,
            settings=settings,
        )
        logger.info(
            "character avatar ready character=%s avatar=%s",
            character.id, avatar_id,
        )
        return AvatarBindingResult(
            status="ready",
            avatar_id=avatar_id,
            thumbnail_url=thumb_url,
            mock_mode=False,
        )
    except CharacterStudioError as exc:
        logger.warning("character avatar failed character=%s: %s", character.id, exc)
        return AvatarBindingResult(status="failed", error=str(exc)[:300])
    except httpx.HTTPError as exc:
        logger.warning("character avatar http error: %s", exc)
        return AvatarBindingResult(status="failed", error=f"http error: {exc!s}"[:300])
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("character avatar unexpected")
        return AvatarBindingResult(status="failed", error=f"unexpected: {exc!s}"[:300])
