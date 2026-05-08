"""Avatar listing — proxies ``GET /v1/avatars`` and curates a safe view.

The Runway list endpoint returns full avatar records including the
internal `documentIds`, `personality`, and double-presigned image
URLs.  This module forwards only the fields the UI picker needs:

    {id, name, status, source, thumbnail_url, voice_preset_id,
     voice_preset_name, supports_realtime, supports_avatar_video,
     created_at}

Mock mode returns four hard-coded entries that mirror Runway's
documented preset character names so the picker UI remains demoable
without a key.  Each mock entry comes with an inline data-URI
thumbnail (deterministic stdlib PNG) so the gallery renders without
loading any external asset.

Probe finding (2026-05-08): Runway's API does not currently expose
the in-app preset characters (music-superstar, cat-character, etc.)
to the developer API.  ``GET /v1/avatars`` lists only avatars the
account created via ``POST /v1/avatars``, and slug-style avatar IDs
are rejected by the avatar_videos schema as "Invalid UUID".  The
mock entries below preserve the picker UX so the feature remains
demoable; if Runway exposes presets in the future the same picker
will surface them automatically.
"""
from __future__ import annotations

import base64
import logging
import struct
import zlib
from typing import Optional

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)


# ---- mock thumbnails ------------------------------------------------

def _solid_png_data_uri(rgb: tuple[int, int, int], width: int = 192, height: int = 192) -> str:
    def chunk(typ: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(typ + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + typ + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    row = bytes([0]) + bytes(rgb) * width
    raw = row * height
    idat = zlib.compress(raw, level=9)
    payload = sig + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")
    return "data:image/png;base64," + base64.b64encode(payload).decode("ascii")


_MOCK_PRESETS: list[dict] = [
    {
        "id": "mock-preset-music-superstar",
        "name": "Music Superstar",
        "status": "READY",
        "source": "preset",
        "thumbnail_url": _solid_png_data_uri((90, 30, 110)),
        "voice_preset_id": "luna",
        "voice_preset_name": "Luna",
        "supports_realtime": True,
        "supports_avatar_video": True,
        "created_at": None,
        "_mock": True,
    },
    {
        "id": "mock-preset-cat-character",
        "name": "Cat Character",
        "status": "READY",
        "source": "preset",
        "thumbnail_url": _solid_png_data_uri((140, 100, 60)),
        "voice_preset_id": "ruby",
        "voice_preset_name": "Ruby",
        "supports_realtime": True,
        "supports_avatar_video": True,
        "created_at": None,
        "_mock": True,
    },
    {
        "id": "mock-preset-fashion-designer",
        "name": "Fashion Designer",
        "status": "READY",
        "source": "preset",
        "thumbnail_url": _solid_png_data_uri((160, 60, 80)),
        "voice_preset_id": "victoria",
        "voice_preset_name": "Victoria",
        "supports_realtime": True,
        "supports_avatar_video": True,
        "created_at": None,
        "_mock": True,
    },
    {
        "id": "mock-preset-cooking-teacher",
        "name": "Cooking Teacher",
        "status": "READY",
        "source": "preset",
        "thumbnail_url": _solid_png_data_uri((80, 110, 60)),
        "voice_preset_id": "drew",
        "voice_preset_name": "Drew",
        "supports_realtime": True,
        "supports_avatar_video": True,
        "created_at": None,
        "_mock": True,
    },
]


def _curate_runway_avatar(record: dict) -> Optional[dict]:
    """Project a Runway /v1/avatars record onto the picker's safe shape.

    Returns None for records that don't have an id or aren't in a
    usable status.  Internal-only fields (documentIds, personality)
    are intentionally NOT forwarded to the frontend.
    """
    if not isinstance(record, dict):
        return None
    avatar_id = record.get("id")
    if not avatar_id:
        return None
    status = (record.get("status") or "").upper() or "UNKNOWN"
    voice = record.get("voice") or {}
    return {
        "id": avatar_id,
        "name": record.get("name") or "Untitled avatar",
        "status": status,
        # All API-listed avatars are custom-created today.  If Runway
        # later exposes preset/library characters via this endpoint,
        # we'll need a more nuanced source mapping.
        "source": "custom",
        "thumbnail_url": (
            record.get("processedImageUri") or record.get("referenceImageUri")
        ),
        "voice_preset_id": voice.get("presetId") if isinstance(voice, dict) else None,
        "voice_preset_name": voice.get("name") if isinstance(voice, dict) else None,
        # All current account-listed avatars support both surfaces.
        # Realtime requires status == READY; the UI gates on this.
        "supports_realtime": status == "READY",
        "supports_avatar_video": status == "READY",
        "created_at": record.get("createdAt"),
    }


def list_avatars(settings: Settings) -> list[dict]:
    """Return the picker-safe avatar list. Mock-safe; real path proxies
    Runway and curates the response. Never raises — surfaces an
    empty list on upstream failure (the UI shows a "no avatars yet"
    state in that case).
    """
    if settings.runway_mock:
        return list(_MOCK_PRESETS)

    url = f"{settings.runway_api_base}/v1/avatars"
    headers = {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
    }
    try:
        with httpx.Client(timeout=15.0) as client:
            r = client.get(url, headers=headers)
        if r.status_code != 200:
            logger.warning(
                "list_avatars upstream status %s: %s",
                r.status_code, r.text[:200],
            )
            return []
        payload = r.json() if r.content else {}
    except httpx.HTTPError as exc:
        logger.warning("list_avatars http error: %s", exc)
        return []
    except Exception:  # pragma: no cover — defensive
        logger.exception("list_avatars unexpected")
        return []

    raw = []
    if isinstance(payload, dict):
        raw = payload.get("data") or []
    elif isinstance(payload, list):
        raw = payload
    out: list[dict] = []
    for rec in raw:
        curated = _curate_runway_avatar(rec)
        if curated is not None:
            out.append(curated)
    return out
