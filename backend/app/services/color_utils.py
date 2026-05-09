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


# ---- PR AM — Caption contrast polish ------------------------------


def hex_to_rgb(value: Optional[str]) -> Optional[tuple[int, int, int]]:
    """Parse any AdSpark-supported hex shape into an ``(r, g, b)`` triple
    of integers in ``0..255``. Returns ``None`` for unparseable input —
    callers fall back to the dark-default styling.
    """
    normalised = normalize_brand_color(value)
    if not normalised:
        return None
    raw = normalised.lstrip("#")
    return (
        int(raw[0:2], 16),
        int(raw[2:4], 16),
        int(raw[4:6], 16),
    )


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    """WCAG relative luminance for an sRGB colour in ``0..1``.

    The standard formula linearises each channel before applying the
    photopic weights ``0.2126 R + 0.7152 G + 0.0722 B``. AdSpark uses
    the result as a single threshold (>= 0.5 -> "light") to decide
    caption contrast — full WCAG AA / AAA contrast-ratio math is
    overkill for V1 polish.
    """
    def _channel(c: int) -> float:
        v = c / 255.0
        return v / 12.92 if v <= 0.03928 else ((v + 0.055) / 1.055) ** 2.4

    r, g, b = rgb
    return 0.2126 * _channel(r) + 0.7152 * _channel(g) + 0.0722 * _channel(b)


# Threshold above which the caption box flips to dark text. 0.5 lands
# roughly where a human reader needs to switch from a white-on-dark
# read to a black-on-light read.
_LIGHT_BACKDROP_THRESHOLD = 0.5


def is_light_color(value: Optional[str]) -> bool:
    """Return True when ``value`` parses as a light brand colour, i.e.
    a colour whose WCAG relative luminance is >= ``0.5``. ``None`` /
    invalid input returns False — the caller treats those as the
    default dark backdrop.
    """
    rgb = hex_to_rgb(value)
    if rgb is None:
        return False
    return relative_luminance(rgb) >= _LIGHT_BACKDROP_THRESHOLD


# Default styling shared by the unset / dark-backdrop path. Mirrors the
# PR AH original (white-on-translucent-black) exactly so untouched
# callers see no rendering change.
DARK_CAPTION_STYLE: dict[str, object] = {
    "font_color": "white",
    "box_color": "black",
    "box_alpha": 0.6,
    "is_light_backdrop": False,
}

# Light-backdrop styling. Black text on a slightly more opaque white
# box — the higher alpha keeps the box edge visible against bright
# brand bars while the talking-head visual above stays untouched.
LIGHT_CAPTION_STYLE: dict[str, object] = {
    "font_color": "black",
    "box_color": "white",
    "box_alpha": 0.7,
    "is_light_backdrop": True,
}


def caption_style_for_backdrop(value: Optional[str]) -> dict:
    """Pick a contrast-aware caption styling dict from the brand
    backdrop colour. ``None`` / invalid / dark inputs return the
    dark-default style; light inputs return the light style.

    Used by ``finisher_service.build_reels_export`` to flip the
    drawtext ``fontcolor`` + ``boxcolor`` + alpha so PR AH captions
    stay readable on top of the PR AK brand bars.
    """
    if is_light_color(value):
        return dict(LIGHT_CAPTION_STYLE)
    return dict(DARK_CAPTION_STYLE)
