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

# PR CT — switched from `gen4_image_turbo` to `gen4_image` after a
# regression audit (SESSION_077) found `gen4_image_turbo` was
# returning `INTERNAL.BAD_OUTPUT.CODE01` on every prompt at every
# aspect ratio (1280:720, 720:1280, 1024:1024) for our account.
# Direct Runway probes with our exact payload shape confirmed the
# failure is upstream, not in our request construction:
#
#   gen4_image_turbo + 1280:720 + seed → FAILED (BAD_OUTPUT)
#   gen4_image_turbo + 720:1280 + seed → FAILED (BAD_OUTPUT)
#   gen4_image_turbo + 1024:1024 + seed → FAILED (BAD_OUTPUT)
#   gen4_image       + 1280:720 + seed → SUCCEEDED ✅
#
# `gen4_image` produces the same family of outputs at slightly
# higher quality and noticeably slower latency (10–20 s vs 5–10 s
# for turbo). Schema is identical — same `referenceImages`
# requirement, same `promptText` field, same ratio set. We can
# revert to turbo if/when Runway resolves the upstream issue.
_IMAGE_MODEL = "gen4_image"
_MAX_IMAGE_BYTES = 16 * 1024 * 1024
_MAX_PORTRAIT_RATIO = "1280:720"  # landscape; predictable face crop on Runway side


# ---- prompt templates (locked in spike §7) ------------------------

# PR CP cont. — every template now leads with a "polished commercial
# spokesperson portrait" anchor and ends with shared brand-safe
# constraints. ``{subject}`` lands in the noun position so Runway
# sees the concrete creature/person before the modifier clauses.
# The mascot anchor explicitly says "anthropomorphic mascot
# spokesperson" so animal mascots (Brewster Bolt the raccoon) read
# as creatures rather than abstract shapes when the seed ``subject``
# is light.
#
# PR CR — rewrote the brand-safe tail to be **positive-only**.
# `gen4_image_turbo` consistently rejected outputs (FAILED with
# `INTERNAL.BAD_OUTPUT.CODE01`) when the previous tail listed
# negations ("no horror, no distortion, no extra limbs, no melted
# anatomy, no uncanny realism, no props or sunglasses"). Diffusion
# models routinely misread inline negations as instructions to
# include those concepts, then Runway's downstream output check
# rejects the result. Donny Sparks the donkey mascot reproduced the
# failure across three attempts under the negation-laden tail and
# rendered cleanly the moment the negations were dropped. The new
# tail says what we DO want — believable anatomy, clean face — in
# positive phrasing that the model can render directly.
_BRAND_SAFE_TAIL = (
    "Brand-safe advertising character suitable for a marketing "
    "campaign. Polished commercial illustration with believable "
    "character anatomy and a clean face."
)

PORTRAIT_TEMPLATES: dict[str, str] = {
    "mascot": (
        "A polished commercial mascot portrait of an anthropomorphic "
        "mascot spokesperson — {subject}. {style}. Head-and-shoulders "
        "framing, expressive friendly face, soft warm smile. Simple "
        "solid mid-grey background. Soft three-point studio lighting. "
        "High-quality 3D character design. " + _BRAND_SAFE_TAIL
    ),
    "founder": (
        "A polished commercial spokesperson portrait of {subject}. "
        "{style}. Head-and-shoulders, front-facing. Direct eye "
        "contact, soft natural smile. Clean off-white background. "
        "Warm soft lighting. Photorealistic modern founder "
        "aesthetic. " + _BRAND_SAFE_TAIL
    ),
    "coach": (
        "A polished commercial spokesperson portrait of {subject}. "
        "{style}. Head-and-shoulders. Confident posture, bright "
        "expression, open mouth mid-speech. Solid muted-blue "
        "background. Crisp directional lighting. Athletic-coach "
        "aesthetic. " + _BRAND_SAFE_TAIL
    ),
    "local_guide": (
        "A polished commercial spokesperson portrait of {subject} "
        "in a small-business setting. {style}. Head-and-shoulders, "
        "front-facing. Welcoming smile. Soft-blurred neutral "
        "background suggesting indoors. Natural daylight. "
        "Approachable neighborly aesthetic. " + _BRAND_SAFE_TAIL
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


# PR CS — Safe-retry preset. When `gen4_image_turbo` rejects a
# portrait as `INTERNAL.BAD_OUTPUT.CODE01` (typically because the
# character's `style` chain stacks unstable concepts — celebrity / IP
# references like "indiana jones style hat", or adjective overload
# like "stylized, editorial, studio light, muted palette; premium
# modern tech-startup hoodie with subtle creative-agency styling"),
# the operator can re-fire with `safe_retry=True`. Safe-retry:
#
# - **Bypasses character.style entirely** — this is the field where
#   chip-stacks + IP references accumulate; it's the most common
#   trigger for BAD_OUTPUT.
# - Uses a short, declarative template (~280 chars vs ~720 for the
#   default mascot template) — fewer comma chains, no negations.
# - Keeps the persona's `subject` (concrete creature description)
#   so the regen still depicts the right character.
#
# Templates are intentionally generic so any subject (donkey mascot,
# bison spokesperson, founder, coach) renders predictably. The
# point is reliable render, not perfect art.
_SAFE_RETRY_TEMPLATES: dict[str, str] = {
    "mascot": (
        "Polished 3D brand mascot portrait of {subject}. "
        "Adult brand-mascot character design with simple modern "
        "attire. Calm confident expression. Clean neutral studio "
        "background. Head and shoulders. Professional advertising "
        "character design. Balanced facial proportions. Soft "
        "studio lighting."
    ),
    "founder": (
        "Polished commercial portrait of {subject}. Photorealistic "
        "professional founder with simple modern attire. Calm "
        "confident expression. Clean neutral studio background. "
        "Head and shoulders. Professional advertising character "
        "design. Balanced facial proportions. Soft studio lighting."
    ),
    "coach": (
        "Polished commercial portrait of {subject}. Photorealistic "
        "professional coach with simple modern attire. Calm "
        "confident expression. Clean neutral studio background. "
        "Head and shoulders. Professional advertising character "
        "design. Balanced facial proportions. Soft studio lighting."
    ),
    "local_guide": (
        "Polished commercial portrait of {subject}. Photorealistic "
        "professional local-business spokesperson with simple "
        "modern attire. Calm confident expression. Clean neutral "
        "studio background. Head and shoulders. Professional "
        "advertising character design. Balanced facial proportions. "
        "Soft studio lighting."
    ),
}


def build_prompt(
    template: str,
    subject: Optional[str] = None,
    style: Optional[str] = None,
    *,
    prompt_override: Optional[str] = None,
    safe_retry: bool = False,
) -> str:
    """Assemble the portrait prompt. ``prompt_override`` wins over
    everything; otherwise we fill the named template.

    PR CS — when ``safe_retry=True`` we bypass ``style`` entirely and
    fill a simpler ``_SAFE_RETRY_TEMPLATES`` entry. The character's
    ``subject`` is still honoured. Operator-triggered after a
    ``BAD_OUTPUT`` failure so we don't double-bill credits on the
    same unstable prompt.
    """
    if prompt_override and prompt_override.strip():
        return prompt_override.strip()[:1000]
    if safe_retry:
        tpl = _SAFE_RETRY_TEMPLATES.get(template) or _SAFE_RETRY_TEMPLATES["mascot"]
        defaults = TEMPLATE_DEFAULTS.get(template) or TEMPLATE_DEFAULTS["mascot"]
        return tpl.format(
            subject=(subject or defaults["subject"]).strip(),
        )[:1000]
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


# Runway failure codes that are flaky on Runway's side rather than
# caused by our prompt. Donny Sparks (PR CR investigation) hit
# ``INTERNAL.BAD_OUTPUT.CODE01`` against a perfectly fine
# anthropomorphic-donkey mascot prompt; Rex Roadside hit the same
# pattern across PR CI / PR CJ / PR CO. We auto-retry once on these
# codes before surfacing the failure to the operator. Codes that
# look like operator-fixable signals (content moderation, prompt
# rejection) are NOT retried — they need a different prompt.
_TRANSIENT_FAILURE_CODE_PREFIXES = ("INTERNAL.",)


def _portrait_task_attempt(
    body: dict, settings: Settings, *, deadline_secs: int = 180
) -> tuple[str, dict]:
    """Single create-and-poll round-trip against ``/v1/text_to_image``.

    Returns ``(output_url, final_payload)`` on SUCCEEDED. Raises
    ``CharacterStudioError`` on FAILED / CANCELED / timeout — the
    raised message preserves the Runway ``failureCode`` so the
    caller can decide whether to retry or surface to the operator.
    """
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

    deadline = time.time() + deadline_secs
    final_payload: Optional[dict] = None
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
                code = payload.get("failureCode") or ""
                # Surface failureCode in the message so logs +
                # operator UI tell us *why* Runway said no.
                raise CharacterStudioError(
                    f"portrait task {status}: {reason}"
                    + (f" [code={code}]" if code else "")
                    + f" (task={task_id})"
                )
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
        raise CharacterStudioError(
            f"portrait task {task_id} produced no output url"
        )
    return out_url, final_payload


def _is_transient_failure(message: str) -> bool:
    """True when the failure shape matches a known Runway-side flake
    (vs an operator-fixable rejection like a content-policy block).

    Two retry-worthy patterns:

    1. ``[code=INTERNAL.…]`` — Runway returned FAILED with an
       internal failure code (BAD_OUTPUT, INTERNAL, etc.). The model
       died on Runway's side; another spin usually works.
    2. ``timed out`` — the polling loop expired waiting for a
       terminal state. PR CR found a Donny Sparks attempt where the
       task sat past our 180 s deadline before flipping to FAILED
       with ``failureCode=INTERNAL``. Retrying gives Runway a fresh
       task slot rather than waiting longer.
    """
    if "timed out" in message:
        return True
    if "[code=" not in message:
        return False
    return any(
        f"[code={prefix}" in message
        for prefix in _TRANSIENT_FAILURE_CODE_PREFIXES
    )


def _generate_portrait_real(prompt: str, target: Path, settings: Settings) -> int:
    # PR CV — referenceImages is REQUIRED by `gen4_image_turbo`'s
    # OpenAPI schema (`reference_images: Required[Iterable[...]]`)
    # and OPTIONAL for `gen4_image` (`reference_images: Annotated`,
    # not Required). We were sending a flat 320×320 charcoal seed
    # under both models because turbo required it; for non-turbo
    # the model interprets the seed as a literal visual reference,
    # which steers the output toward a featureless dark frame
    # instead of letting the prompt drive it. Conditionally
    # include the seed only when the model requires it.
    body: dict = {
        "model": _IMAGE_MODEL,
        "promptText": prompt,
        "ratio": _MAX_PORTRAIT_RATIO,
    }
    if _IMAGE_MODEL == "gen4_image_turbo":
        body["referenceImages"] = [
            {"uri": _seed_reference_data_uri(), "tag": "seed"}
        ]

    # PR CR — single retry on transient INTERNAL.* failure codes.
    # Runway's gen4_image_turbo occasionally returns
    # ``INTERNAL.BAD_OUTPUT.CODE01`` against perfectly valid prompts;
    # one retry is the standard mitigation. Non-transient failures
    # (content policy, schema rejections) are NOT retried — they
    # need an operator decision, not another credit burn.
    last_exc: Optional[CharacterStudioError] = None
    for attempt in (1, 2):
        try:
            out_url, _payload = _portrait_task_attempt(body, settings)
            return _download_image_to_disk(out_url, target)
        except CharacterStudioError as exc:
            last_exc = exc
            msg = str(exc)
            if attempt == 1 and _is_transient_failure(msg):
                logger.warning(
                    "portrait transient-fail attempt=%d msg=%s — retrying once",
                    attempt, msg,
                )
                # tiny backoff before the second shot
                time.sleep(2)
                continue
            raise
    # Defensive — loop above always returns or raises.
    raise last_exc or CharacterStudioError("portrait failed (no attempts ran)")


def generate_portrait(
    character: Character,
    portrait_path: Path,
    settings: Settings,
    *,
    template: Optional[str] = None,
    subject: Optional[str] = None,
    style: Optional[str] = None,
    prompt_override: Optional[str] = None,
    safe_retry: bool = False,
) -> PortraitResult:
    """Public entry. Mock-safe; never raises.

    PR CS — when ``safe_retry=True`` we delegate to a simpler
    `_SAFE_RETRY_TEMPLATES` entry that ignores ``style`` (the
    field where unstable concepts pile up). ``prompt_override``
    still wins if explicitly set so the operator's typed text
    survives.
    """
    chosen_template = (template or character.template or "mascot").lower()
    prompt = build_prompt(
        chosen_template,
        subject=subject if subject is not None else character.subject,
        style=style if style is not None else character.style,
        prompt_override=prompt_override,
        safe_retry=safe_retry,
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
    *,
    custom_voice_id: Optional[str] = None,
) -> tuple[str, Optional[str]]:
    """Returns (avatar_id, processed_thumbnail_url). Raises on failure.

    PR AN — when ``custom_voice_id`` is set, the avatar binds to the
    cloned voice (`voice: {type: "custom", voiceId: ...}`) instead of
    the runway-live-preset. Falls back to the preset binding when no
    custom voice has been cloned for the Character yet.
    """
    if custom_voice_id:
        voice_block: dict = {"type": "custom", "voiceId": custom_voice_id}
    else:
        voice_block = {"type": "runway-live-preset", "presetId": voice_preset}
    body = {
        "name": name,
        "referenceImage": portrait_data_uri,
        "voice": voice_block,
        "personality": personality or "Reusable AI brand character.",
    }
    # PR CR — log payload SHAPE (no secrets, no base64). Voice id is a
    # surrogate identifier, not a secret, but we redact it anyway.
    logger.info(
        "avatar create payload name=%r voice.type=%s voice.id_set=%s "
        "personality_len=%d referenceImage_bytes=%d",
        name,
        voice_block.get("type"),
        bool(voice_block.get("voiceId") or voice_block.get("presetId")),
        len(body["personality"]),
        len(portrait_data_uri),
    )
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
        # PR CR — surface Runway's failure detail + failureCode so the
        # operator-facing error explains *why* (mirrors the portrait
        # `[code=…]` shape).
        reason = (
            payload.get("failure")
            or payload.get("error")
            or final_status
            or "no terminal status"
        )
        code = payload.get("failureCode") or ""
        raise CharacterStudioError(
            f"avatar processing did not reach READY (final={final_status}): {reason}"
            + (f" [code={code}]" if code else "")
            + f" (avatar={avatar_id})"
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
            custom_voice_id=character.custom_voice_id,  # PR AN
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
