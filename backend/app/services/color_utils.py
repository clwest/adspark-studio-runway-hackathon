"""Brand colour utilities (PR AK).

Tiny module so the reels routes, the brand-color persistence helper,
and any future caption / drawtext styling all agree on a single
hex-validation surface. Kept intentionally minimal: AdSpark stores a
single ``#RRGGBB`` per campaign — no themes, no palettes, no opacity.
"""
from __future__ import annotations

import re
from typing import Optional

# Default backdrop used when no brand colour is set. Matches the
# ``build_reels_export`` default so the wire format stays consistent.
DEFAULT_REELS_BACKDROP = "0x0b1220"

_HEX_RE = re.compile(r"^[0-9a-f]{6}$", re.IGNORECASE)


def normalize_brand_color(value: Optional[str]) -> Optional[str]:
    """Return a normalised ``#RRGGBB`` (lowercase) for storage, or
    ``None`` when the input is empty / unparseable.

    Accepts:
    - ``"#RRGGBB"`` (case-insensitive)
    - ``"RRGGBB"`` (no leading hash)
    - ``"0xRRGGBB"`` (ffmpeg-style)
    - the 3-char shorthand ``"#RGB"`` / ``"RGB"`` — expanded to 6.

    Anything else returns ``None`` so the caller can fall back to
    ``DEFAULT_REELS_BACKDROP`` without raising.
    """
    if value is None:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    if cleaned.startswith("#"):
        cleaned = cleaned[1:]
    elif cleaned.lower().startswith("0x"):
        cleaned = cleaned[2:]
    if len(cleaned) == 3 and re.fullmatch(r"[0-9a-fA-F]{3}", cleaned):
        cleaned = "".join(ch * 2 for ch in cleaned)
    if not _HEX_RE.fullmatch(cleaned):
        return None
    return f"#{cleaned.lower()}"


def to_ffmpeg_color(value: Optional[str]) -> str:
    """Map a stored brand colour to the ``0xRRGGBB`` shape ffmpeg's
    ``pad=…:color=…`` argument expects. Falls back to the default
    backdrop when the input is missing / invalid so callers never
    pass an unparseable value to the filter chain.
    """
    normalised = normalize_brand_color(value)
    if not normalised:
        return DEFAULT_REELS_BACKDROP
    return "0x" + normalised.lstrip("#")
