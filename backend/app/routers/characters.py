"""Character Studio routes (PR K).

Eight V1 endpoints under ``/api/characters/*`` plus the integration
point ``POST /api/campaigns/{id}/attach-character`` which lives in
the campaigns router.

Locked design in
``docs/research/CHARACTER_STUDIO_SPIKE.md`` §§4-6.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Literal, Optional

from fastapi import APIRouter, Body, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from ..config import Settings, get_settings
from ..models import Character, CharacterCreate, CharacterList, KnowledgeSourceCreate
from ..services.character_store import CharacterStore
from ..services.character_studio_client import (
    create_avatar as studio_create_avatar,
    generate_portrait as studio_generate_portrait,
    PORTRAIT_TEMPLATES,
)
from ..services.character_host_client import SUPPORTED_VOICE_PRESETS
from ..services.voice_clone_client import (
    MAX_AUDIO_BYTES,
    SUPPORTED_AUDIO_MIMES,
    apply_voice_to_avatar,
    clone_voice_from_audio,
    compute_voice_drift_status,
    fetch_avatar_voice,
    fetch_voice_preview,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/characters", tags=["characters"])


def _store(settings: Settings = Depends(get_settings)) -> CharacterStore:
    return CharacterStore(settings.data_path)


# ---- PR AS — introspection helper shared by clone + apply routes ----


def _verify_avatar_voice_after_patch(
    record: Character,
    expected_voice_id: Optional[str],
    settings: Settings,
    apply_status: str,
):
    """PR AS — run `GET /v1/avatars/{id}` to confirm the freshly-
    patched voice binding actually landed. Returns
    ``(AvatarVoiceState, verified_at | None, drift_status)``. The
    caller persists every field; a verification failure is logged
    but never blocks the clone or apply flows.

    PR AT — also computes ``drift_status`` (match / drift / unknown)
    from the resolved id vs the expected (cloned) voice id so the
    UI can render a single drift-aware pill.

    When the prior PATCH was ``pending_avatar`` (no avatar bound
    yet) we skip the GET entirely — there's nothing to introspect.
    """
    from ..services.voice_clone_client import (  # noqa: WPS433 lazy-import
        AvatarVoiceState,
    )
    if apply_status == "pending_avatar":
        state = AvatarVoiceState(status="failed", error="no avatar bound")
        return state, None, "unknown"
    state = fetch_avatar_voice(
        record.runway_avatar_id,
        settings,
        avatar_is_mock=(record.runway_avatar_status == "mock"),
        expected_voice_id=expected_voice_id,
    )
    verified_at = (
        datetime.now(timezone.utc)
        if state.status in {"verified", "mock_verified"}
        else None
    )
    drift_status = compute_voice_drift_status(
        expected_voice_id, state.resolved_id, state.status,
    )
    return state, verified_at, drift_status


# ---- request bodies ----------------------------------------------


class GeneratePortraitBody(BaseModel):
    template: Optional[str] = Field(default=None, description="mascot|founder|coach|local_guide")
    subject: Optional[str] = Field(default=None, max_length=300)
    style: Optional[str] = Field(default=None, max_length=300)
    prompt_override: Optional[str] = Field(default=None, max_length=1000)
    # PR CS — safe-retry preset bypasses character.style and fills a
    # simpler `_SAFE_RETRY_TEMPLATES` entry. Operator-triggered after
    # BAD_OUTPUT failures (style chip stacks + IP references like
    # "indiana jones style hat" are the historical trigger). Has no
    # effect when `prompt_override` is also supplied — explicit
    # operator-typed text always wins.
    safe_retry: bool = Field(default=False)


class CreateAvatarBody(BaseModel):
    voice_preset: Optional[str] = Field(default=None)
    personality_override: Optional[str] = Field(default=None, max_length=600)


class ApplyVoiceBody(BaseModel):
    """PR BB — optional body for ``POST /apply-voice``.

    The frontend's PR AU "Repair voice drift" button passes
    ``mode: "repair"`` so the appended audit-trail entry is labeled
    ``action="repair"`` instead of the default ``"apply"``. Both
    code paths share the same backend handler — ``mode`` is purely
    for the audit trail label.
    """

    mode: Optional[Literal["apply", "repair"]] = None


class MetadataPatchBody(BaseModel):
    """PR CK — request body for the metadata-patch route.

    ``Character.metadata`` is a free-form ``dict`` (PR CG used it
    for ``demo: True`` flags via a direct store update). The v2
    multi-step Create Spokesperson flow needs to write
    ``audience_vibe`` / ``creation_flow`` / ``visual_style_chips``
    / ``speaking_energy`` from the browser without inventing per-
    field columns; this route is the smallest possible HTTP path
    that lets it.

    Semantics:
    - Missing keys are left alone (merge, not replace).
    - Pass ``null`` for a key to delete it.
    - Cap the patch dict at 32 keys + 4 KB serialised so a
      pathological client can't fill the JSON record.
    """

    metadata: dict = Field(
        default_factory=dict,
        description=(
            "Partial metadata patch. Existing keys not mentioned "
            "stay; explicit nulls delete; new keys are added."
        ),
    )


# ---- PR BB — history helper -------------------------------------
#
# Centralised so every route appends entries with a consistent shape.
# Best-effort: callers wrap this in ``try/except`` so an audit
# failure never aborts the underlying clone / apply / refresh flow.


def _append_voice_history_safe(
    store: CharacterStore,
    character_id: str,
    *,
    action: str,
    before_voice_id: Optional[str] = None,
    after_voice_id: Optional[str] = None,
    resolved_voice_id: Optional[str] = None,
    drift_status: Optional[str] = None,
    status: Optional[str] = None,
    error: Optional[str] = None,
    mock_mode: Optional[bool] = None,
) -> None:
    entry = {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "action": action,
        "before_voice_id": before_voice_id,
        "after_voice_id": after_voice_id,
        "resolved_voice_id": resolved_voice_id,
        "drift_status": drift_status,
        "status": status,
        "error": error,
        "mock_mode": mock_mode,
    }
    try:
        store.append_voice_history(character_id, entry)
    except Exception as exc:  # pragma: no cover - audit is best-effort
        logger.warning(
            "voice history append failed for character %s action=%s: %s",
            character_id, action, exc,
        )


# ---- routes -------------------------------------------------------


@router.get("", response_model=CharacterList)
def list_characters(store: CharacterStore = Depends(_store)) -> CharacterList:
    return CharacterList(characters=store.list())


@router.post("", response_model=Character)
def create_character(
    payload: CharacterCreate,
    store: CharacterStore = Depends(_store),
) -> Character:
    if payload.template not in PORTRAIT_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported template '{payload.template}'. "
                f"supported: {sorted(PORTRAIT_TEMPLATES)}"
            ),
        )
    if payload.voice_preset and payload.voice_preset.lower() not in SUPPORTED_VOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported voice_preset '{payload.voice_preset}'. "
                f"supported: {sorted(SUPPORTED_VOICE_PRESETS)}"
            ),
        )
    record = store.create(payload)
    logger.info("character created id=%s name=%s template=%s", record.id, record.name, record.template)
    return record


@router.get("/{character_id}", response_model=Character)
def get_character(
    character_id: str,
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    return record


@router.post("/{character_id}/generate-portrait", response_model=Character)
def post_generate_portrait(
    character_id: str,
    body: Optional[GeneratePortraitBody] = None,
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")

    template = (body.template if body else None) or record.template
    if template not in PORTRAIT_TEMPLATES:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported template '{template}'. "
                f"supported: {sorted(PORTRAIT_TEMPLATES)}"
            ),
        )

    portrait_path = store.portrait_path(character_id)
    safe_retry = bool(body.safe_retry) if body else False
    result = studio_generate_portrait(
        record,
        portrait_path,
        settings,
        template=template,
        subject=body.subject if body else None,
        style=body.style if body else None,
        prompt_override=body.prompt_override if body else None,
        safe_retry=safe_retry,
    )

    if result.status == "ok":
        updated = store.update(
            character_id,
            portrait_url=result.portrait_url,
            portrait_source=result.portrait_source,
            portrait_prompt=result.portrait_prompt,
            portrait_last_error=None,  # PR CS — clear on success
            template=template,
            subject=(body.subject if body else None) or record.subject,
            style=(body.style if body else None) or record.style,
            mock_mode=result.mock_mode,
        )
    else:
        # PR CS — capture the failed prompt + error on the Character
        # record so the workspace audit `<details>` (and any UI
        # failure banner) can surface what was sent without a
        # log dive. Style-chips + prompt_override flag are
        # logged here for diagnosis; the persisted prompt itself
        # carries the resolved text.
        style_chips = []
        if isinstance(record.metadata, dict):
            chips = record.metadata.get("visual_style_chips") or []
            if isinstance(chips, list):
                style_chips = [c for c in chips if isinstance(c, str)]
        logger.warning(
            "portrait failed character=%s name=%r template=%s "
            "style_chips=%s prompt_override_used=%s safe_retry=%s "
            "prompt_len=%d err=%s prompt=%r",
            character_id,
            record.name,
            template,
            style_chips,
            bool((body.prompt_override or "").strip()) if body else False,
            safe_retry,
            len(result.portrait_prompt or ""),
            result.error,
            (result.portrait_prompt or "")[:600],
        )
        store.update(
            character_id,
            portrait_prompt=result.portrait_prompt,
            portrait_last_error=result.error,
        )
        raise HTTPException(
            status_code=502 if not result.mock_mode else 500,
            detail=result.error or "portrait generation failed",
        )
    return updated or record


@router.post("/{character_id}/create-avatar", response_model=Character)
def post_create_avatar(
    character_id: str,
    body: Optional[CreateAvatarBody] = None,
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    if not store.has_portrait(character_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Generate the portrait first. "
                "POST /api/characters/{id}/generate-portrait."
            ),
        )
    # PR CR — additional belt-and-braces: an empty / zero-byte portrait
    # file slipped through `has_portrait()` would lead to an avatar
    # request with an empty referenceImage. Catch it here.
    portrait_path = store.portrait_path(character_id)
    portrait_size = portrait_path.stat().st_size if portrait_path.exists() else 0
    if portrait_size <= 0:
        raise HTTPException(
            status_code=409,
            detail="portrait cache is empty; regenerate the portrait first.",
        )

    voice_preset = body.voice_preset if body else None
    if voice_preset and voice_preset.lower() not in SUPPORTED_VOICE_PRESETS:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported voice_preset '{voice_preset}'. "
                f"supported: {sorted(SUPPORTED_VOICE_PRESETS)}"
            ),
        )

    logger.info(
        "create-avatar character=%s portrait_bytes=%d portrait_mtime=%s "
        "voice_preset=%s has_custom_voice=%s",
        character_id,
        portrait_size,
        int(portrait_path.stat().st_mtime),
        (voice_preset or record.voice_preset or "vincent"),
        bool(record.custom_voice_id),
    )

    result = studio_create_avatar(
        record,
        portrait_path,
        settings,
        voice_preset=voice_preset,
        personality_override=(body.personality_override if body else None),
    )

    if result.status in {"ready", "mock"}:
        updated = store.update(
            character_id,
            runway_avatar_id=result.avatar_id,
            runway_avatar_status=result.status,
            runway_avatar_thumbnail_url=result.thumbnail_url,
            runway_avatar_error=None,
            voice_preset=(voice_preset or record.voice_preset).lower(),
            mock_mode=result.mock_mode,
        )
        return updated or record

    # PR CR — persist the failed state so the workspace pill shows
    # `avatar · failed` next time the record is read, AND raise 502 so
    # the immediate caller (v2 stepper / workspace button) can surface
    # the specific error to the operator. The previous code returned
    # 200 with persisted-failed flags, so the frontend treated avatar
    # failures as success and silently navigated past them.
    store.update(
        character_id,
        runway_avatar_status="failed",
        runway_avatar_error=result.error,
    )
    logger.warning(
        "create-avatar failed character=%s err=%s",
        character_id, result.error,
    )
    raise HTTPException(
        status_code=502,
        detail=result.error or "avatar processing failed",
    )


# ---- PR AN — Custom voice cloning foundation ----------------------
#
# Multipart upload of a 10 s – 5 min audio sample. POST /v1/voices
# with from.type=audio creates a Runway voice id; Character OS persists it
# on the Character record and prefers it over the runway-live-preset
# binding the next time an avatar is created. Mock mode short-circuits
# with a deterministic ``mock_voice_<sha>`` id keyed off the character
# + sample bytes so re-uploads are idempotent and re-recordings yield
# a fresh id.


@router.post("/{character_id}/clone-voice", response_model=Character)
async def post_clone_voice(
    character_id: str,
    audio: UploadFile = File(..., description="10 s – 5 min audio sample (≤ 10 MB)"),
    name: Optional[str] = Form(default=None),
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    """PR AN — clone a voice from an uploaded audio sample. Returns the
    updated Character with ``custom_voice_*`` fields populated.

    Real mode: ``POST /v1/voices`` with ``from.type=audio`` (audio is
    embedded as a base64 data URI). Mock mode: deterministic
    ``mock_voice_<sha256(name + bytes)[:16]>``.

    Failure modes:
    - 404 — character not found.
    - 415 — unsupported audio mime type.
    - 413 — audio sample exceeds the local 15 MB cap.
    - 422 — empty / unreadable audio body.
    - 502 — Runway upstream rejection (real mode only).
    """
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")

    mime = (audio.content_type or "").lower().strip()
    if mime not in SUPPORTED_AUDIO_MIMES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"unsupported audio mime type '{mime or audio.filename or ''}'. "
                f"accepted: {sorted(set(SUPPORTED_AUDIO_MIMES))}"
            ),
        )

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=422, detail="audio sample is empty")
    if len(audio_bytes) > MAX_AUDIO_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"audio sample is {len(audio_bytes):,} bytes "
                f"(cap: {MAX_AUDIO_BYTES:,}); Runway's documented limit is 10 MB."
            ),
        )

    voice_name = (
        (name or "").strip()
        or f"Character OS — {(record.name or 'Character')[:60]}"
    )
    result = clone_voice_from_audio(voice_name, audio_bytes, mime, settings)

    if result.status == "failed" or not result.voice_id:
        store.update(
            character_id,
            custom_voice_id=None,
            custom_voice_name=voice_name,
            custom_voice_status="failed",
            custom_voice_error=result.error,
            custom_voice_mock_mode=result.mock_mode,
        )
        # PR BB — record the failed clone in the audit trail so the
        # operator can see it tried and what went wrong even after a
        # 502 surfaces in the UI.
        _append_voice_history_safe(
            store,
            character_id,
            action="clone",
            before_voice_id=record.custom_voice_id,
            after_voice_id=None,
            status="failed",
            error=result.error,
            mock_mode=result.mock_mode,
        )
        raise HTTPException(
            status_code=502,
            detail=f"voice clone failed: {result.error or 'unknown error'}",
        )

    # PR AQ — auto-PATCH the existing Runway avatar so the cloned
    # voice swaps in without an avatar recreate. Best-effort: a
    # patch failure preserves the cloned voice id and surfaces a
    # friendly error on the character record. The next
    # Create Runway Avatar click would still bind the voice via the
    # PR AN create-avatar payload.
    apply_result = apply_voice_to_avatar(
        record.runway_avatar_id,
        result.voice_id,
        settings,
        avatar_is_mock=(record.runway_avatar_status == "mock"),
    )
    patched_at = (
        datetime.now(timezone.utc)
        if apply_result.status in {"applied", "mock_patched"}
        else None
    )

    # PR AS — introspect the avatar resource so the operator can
    # confirm the bind actually landed (rather than trusting the
    # 2xx alone). Best-effort: a verify failure never blocks the
    # cloned voice or the patch state.
    # PR AT — also computes drift_status from the resolved id vs
    # the cloned voice id so the UI renders a single drift-aware pill.
    verify_state, verified_at, drift_status = _verify_avatar_voice_after_patch(
        record, result.voice_id, settings, apply_result.status,
    )

    updated = store.update(
        character_id,
        custom_voice_id=result.voice_id,
        custom_voice_name=voice_name,
        custom_voice_status=result.status,
        custom_voice_error=None,
        custom_voice_mock_mode=result.mock_mode,
        # PR AR — surface the Runway voice previewUrl when the clone
        # path captured one. ``None`` in mock mode + when polling
        # didn't expose a URL; the UI handles both cases gracefully.
        custom_voice_preview_url=result.preview_url,
        custom_voice_avatar_patch_status=apply_result.status,
        custom_voice_avatar_patch_error=apply_result.error,
        custom_voice_avatar_patched_at=(patched_at.isoformat() if patched_at else None),
        # PR AS — resolved voice fields from the avatar GET.
        avatar_voice_resolved_type=verify_state.resolved_type,
        avatar_voice_resolved_id=verify_state.resolved_id,
        avatar_voice_resolved_label=verify_state.resolved_label,
        avatar_voice_verify_status=verify_state.status,
        avatar_voice_verified_at=(
            verified_at.isoformat() if verified_at else None
        ),
        avatar_voice_verify_error=verify_state.error,
        # PR AT — drift detection.
        avatar_voice_drift_status=drift_status,
    )
    logger.info(
        "character %s voice cloned -> %s (status=%s mock=%s; patch=%s; drift=%s)",
        character_id, result.voice_id, result.status,
        result.mock_mode, apply_result.status, drift_status,
    )
    # PR BB — log the successful clone in the audit trail. We surface
    # the apply + verify outcomes via the same entry's drift / status
    # fields so the operator gets a single row that captures the
    # whole clone-then-bind-then-verify cycle.
    _append_voice_history_safe(
        store,
        character_id,
        action="clone",
        before_voice_id=record.custom_voice_id,
        after_voice_id=result.voice_id,
        resolved_voice_id=verify_state.resolved_id,
        drift_status=drift_status,
        status=result.status,
        error=None,
        mock_mode=result.mock_mode,
    )
    return updated or record


# ---- PR AQ — manual retry for the avatar voice swap ---------------
#
# The clone route auto-PATCHes the avatar after a successful clone.
# This route lets the operator retry the swap manually when the auto
# attempt failed (real-mode upstream blip, network, etc) without
# re-uploading the audio sample.


@router.post("/{character_id}/apply-voice", response_model=Character)
def post_apply_voice_to_avatar(
    character_id: str,
    body: Optional[ApplyVoiceBody] = Body(default=None),
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    """PR AQ — apply the character's already-cloned ``custom_voice_id``
    to the bound Runway avatar via ``PATCH /v1/avatars/{id}``.

    PR BB — accepts an optional ``mode`` body field (``"apply"`` |
    ``"repair"``). The frontend's PR AU "Repair voice drift" button
    passes ``mode: "repair"`` so the audit-trail entry is labeled
    accordingly; both code paths share the same backend behaviour.

    Failure modes:
    - 404 — character not found.
    - 409 — character has no cloned voice yet.
    - 502 — Runway upstream rejection.
    """
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    if not record.custom_voice_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "no custom voice cloned for this character yet — "
                "upload or record an audio sample first."
            ),
        )

    apply_result = apply_voice_to_avatar(
        record.runway_avatar_id,
        record.custom_voice_id,
        settings,
        avatar_is_mock=(record.runway_avatar_status == "mock"),
    )
    patched_at = (
        datetime.now(timezone.utc)
        if apply_result.status in {"applied", "mock_patched"}
        else None
    )
    # PR AS — verify the bind landed. PR AT — also compute drift.
    verify_state, verified_at, drift_status = _verify_avatar_voice_after_patch(
        record, record.custom_voice_id, settings, apply_result.status,
    )
    updated = store.update(
        character_id,
        custom_voice_avatar_patch_status=apply_result.status,
        custom_voice_avatar_patch_error=apply_result.error,
        custom_voice_avatar_patched_at=(patched_at.isoformat() if patched_at else None),
        avatar_voice_resolved_type=verify_state.resolved_type,
        avatar_voice_resolved_id=verify_state.resolved_id,
        avatar_voice_resolved_label=verify_state.resolved_label,
        avatar_voice_verify_status=verify_state.status,
        avatar_voice_verified_at=(
            verified_at.isoformat() if verified_at else None
        ),
        avatar_voice_verify_error=verify_state.error,
        avatar_voice_drift_status=drift_status,
    )
    # PR BB — record the apply/repair attempt in the audit trail so
    # the operator can see who patched the avatar, when, and what
    # the resolved voice + drift state ended up as. Distinguish
    # repair from apply via the optional body ``mode`` flag (frontend
    # PR AU repair button passes "repair"; default flow is "apply").
    audit_action = "repair" if (body and body.mode == "repair") else "apply"
    _append_voice_history_safe(
        store,
        character_id,
        action=audit_action,
        before_voice_id=record.avatar_voice_resolved_id,
        after_voice_id=record.custom_voice_id,
        resolved_voice_id=verify_state.resolved_id,
        drift_status=drift_status,
        status=apply_result.status,
        error=apply_result.error,
        mock_mode=(apply_result.status == "mock_patched"),
    )
    if apply_result.status == "failed":
        raise HTTPException(
            status_code=502,
            detail=f"avatar voice PATCH failed: {apply_result.error or 'unknown'}",
        )
    return updated or record


# ---- PR AV — Avatar status manual refresh -------------------------
#
# Read-only counterpart to PR AQ's apply-voice. Re-runs the PR AS
# avatar introspection + PR AT drift recompute against the existing
# avatar resource without ever calling PATCH. Useful when an operator
# wants to re-check Runway state (e.g. after waiting for a queued
# upstream change) without mutating the binding.


@router.post("/{character_id}/refresh-avatar-voice", response_model=Character)
def post_refresh_avatar_voice(
    character_id: str,
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    """PR AV — re-run avatar voice introspection + drift recompute
    without applying the PATCH. Calls only ``fetch_avatar_voice`` +
    ``compute_voice_drift_status``; the PR AQ apply path is never
    invoked from here so this route has no PATCH side effects.

    Failure modes:
    - 404 — character not found.
    - 409 — character has no avatar bound yet (cannot introspect).
    - 409 — character has no cloned voice yet (drift comparison
      requires both ids to exist).

    Real-mode HTTP / network failures persist as ``failed`` /
    ``unverified`` on the character; the route still returns 200 so
    the UI can render the new failure state. Mock mode short-circuits
    via PR AS's existing helper to ``mock_verified`` + ``match``.
    """
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    if not record.runway_avatar_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "no Runway avatar bound to this character yet — "
                "create the avatar before refreshing its status."
            ),
        )
    if not record.custom_voice_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "no custom voice cloned for this character yet — "
                "drift comparison requires both ids."
            ),
        )

    state = fetch_avatar_voice(
        record.runway_avatar_id,
        settings,
        avatar_is_mock=(record.runway_avatar_status == "mock"),
        expected_voice_id=record.custom_voice_id,
    )
    verified_at = (
        datetime.now(timezone.utc)
        if state.status in {"verified", "mock_verified"}
        else None
    )
    drift_status = compute_voice_drift_status(
        record.custom_voice_id, state.resolved_id, state.status,
    )
    updated = store.update(
        character_id,
        # NOTE: the PR AQ patch fields are intentionally not touched
        # — this route is verify-only. patch_status / patched_at
        # remain whatever the prior PATCH set them to.
        avatar_voice_resolved_type=state.resolved_type,
        avatar_voice_resolved_id=state.resolved_id,
        avatar_voice_resolved_label=state.resolved_label,
        avatar_voice_verify_status=state.status,
        avatar_voice_verified_at=(verified_at.isoformat() if verified_at else None),
        avatar_voice_verify_error=state.error,
        avatar_voice_drift_status=drift_status,
    )
    logger.info(
        "character %s refresh-avatar-voice -> verify=%s drift=%s",
        character_id, state.status, drift_status,
    )
    # PR BB — record the refresh in the audit trail. ``before`` is
    # the prior resolved id (so the operator can see drift before
    # vs after); ``after_voice_id`` stays None because refresh never
    # mutates the bind itself.
    _append_voice_history_safe(
        store,
        character_id,
        action="refresh",
        before_voice_id=record.avatar_voice_resolved_id,
        after_voice_id=None,
        resolved_voice_id=state.resolved_id,
        drift_status=drift_status,
        status=state.status,
        error=state.error,
        mock_mode=(state.status == "mock_verified"),
    )
    return updated or record


# ---- PR AX — Refresh missing cloned voice preview ------------------
#
# Wires the existing PR AR `fetch_voice_preview` helper to a small
# operator-facing route so a missing `custom_voice_preview_url` can
# be re-fetched without re-uploading audio. Read-only relative to
# the avatar binding (no PATCH); only the character's preview URL
# field is touched, and only when Runway returns a fresh value.


@router.post("/{character_id}/refresh-voice-preview", response_model=Character)
def post_refresh_voice_preview(
    character_id: str,
    settings: Settings = Depends(get_settings),
    store: CharacterStore = Depends(_store),
) -> Character:
    """PR AX — re-fetch the cloned voice's `previewUrl` from Runway
    without cloning again.

    Failure modes:
    - 404 — character not found.
    - 409 — character has no cloned voice yet.
    - 200 with unchanged record — Runway returned no preview URL
      (mock mode short-circuits here; real-mode failures also do).
      The existing URL (if any) is preserved.
    """
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    if not record.custom_voice_id:
        raise HTTPException(
            status_code=409,
            detail=(
                "no custom voice cloned for this character yet — "
                "upload or record an audio sample first."
            ),
        )

    fresh_url = fetch_voice_preview(record.custom_voice_id, settings)
    if fresh_url:
        # Persist the freshly-fetched preview URL.
        updated = store.update(
            character_id,
            custom_voice_preview_url=fresh_url,
        )
        logger.info(
            "character %s voice preview refreshed -> %s",
            character_id, fresh_url,
        )
        return updated or record

    # No URL surfaced (mock mode, real-mode network/upstream failure,
    # or Runway hasn't generated one yet). Preserve the existing URL
    # rather than clearing it; return the unchanged record so the UI
    # can render a friendly "still unavailable" state without losing
    # whatever audio was already playable.
    logger.info(
        "character %s voice preview refresh: no URL surfaced (existing preserved)",
        character_id,
    )
    return record


@router.post("/{character_id}/metadata", response_model=Character)
def post_character_metadata(
    character_id: str,
    body: MetadataPatchBody,
    store: CharacterStore = Depends(_store),
) -> Character:
    """PR CK — merge a metadata patch onto an existing Character.

    The new multi-step Create Spokesperson flow uses this to
    persist ``audience_vibe`` / ``creation_flow`` /
    ``visual_style_chips`` / ``speaking_energy`` into the
    Character.metadata free-form dict without per-field columns.
    Existing keys not mentioned in the patch stay; explicit
    ``null`` values delete; new keys are added.

    Failure modes:
    - 404 — character not found.
    - 422 — pydantic validation (max payload size).
    - 413 — patch too large (>32 keys or >4 KB serialised).
    """
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")

    patch = body.metadata or {}
    if len(patch) > 32:
        raise HTTPException(
            status_code=413,
            detail=f"metadata patch too large ({len(patch)} keys; max 32)",
        )
    # Deep-ish guard: serialised size cap.
    import json as _json  # noqa: WPS433
    if len(_json.dumps(patch, default=str)) > 4 * 1024:
        raise HTTPException(
            status_code=413,
            detail="metadata patch too large (>4 KB serialised)",
        )

    merged = dict(record.metadata or {})
    for k, v in patch.items():
        if v is None:
            merged.pop(k, None)
        else:
            merged[k] = v

    updated = store.update(character_id, metadata=merged)
    if not updated:
        raise HTTPException(status_code=404, detail="character not found")
    logger.info(
        "character %s metadata patched (%d keys)",
        character_id,
        len(patch),
    )
    return updated


@router.get("/{character_id}/portrait")
def get_character_portrait(
    character_id: str,
    store: CharacterStore = Depends(_store),
) -> FileResponse:
    path = store.portrait_path(character_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="no portrait for this character")
    return FileResponse(
        str(path),
        media_type="image/png",
        filename=f"adspark-character-{character_id}.png",
    )


@router.delete("/{character_id}", response_model=dict)
def delete_character(
    character_id: str,
    store: CharacterStore = Depends(_store),
) -> dict:
    """Local delete only — does NOT call Runway DELETE /v1/avatars.
    Cached portrait + thumbnail files are removed; the user can run
    DELETE /v1/avatars/{id} via the Runway dashboard if they want
    the avatar entirely gone.
    """
    if not store.delete(character_id):
        raise HTTPException(status_code=404, detail="character not found")
    store.portrait_path(character_id).unlink(missing_ok=True)
    store.thumbnail_path(character_id).unlink(missing_ok=True)
    return {"ok": True, "id": character_id}


# ---- PR CX — Knowledge sources (manual paste, no embeddings) -----
#
# The Knowledge tab in the Spokesperson workspace persists short
# operator-pasted notes (brand voice, product details, FAQs, audience
# facts) on the Character record. The lane surfaces them next to
# the script editor as a reference panel — no RAG, no embeddings, no
# Runway calls. Two routes: append + delete. Both return the updated
# Character so the UI's local slice stays in sync without re-fetch.


@router.post("/{character_id}/knowledge", response_model=Character)
def post_knowledge_source(
    character_id: str,
    body: KnowledgeSourceCreate,
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    now = datetime.now(timezone.utc).isoformat()
    entry = {
        "id": uuid.uuid4().hex[:12],
        "title": body.title.strip(),
        "source_type": body.source_type,
        "content": body.content.strip(),
        "created_at": now,
        "updated_at": now,
    }
    updated = store.append_knowledge_source(character_id, entry)
    if not updated:
        raise HTTPException(status_code=404, detail="character not found")
    logger.info(
        "character %s knowledge source added id=%s title=%r type=%s content_len=%d",
        character_id, entry["id"], entry["title"][:40],
        entry["source_type"], len(entry["content"]),
    )
    return updated


@router.delete(
    "/{character_id}/knowledge/{source_id}", response_model=Character
)
def delete_knowledge_source(
    character_id: str,
    source_id: str,
    store: CharacterStore = Depends(_store),
) -> Character:
    record = store.get(character_id)
    if not record:
        raise HTTPException(status_code=404, detail="character not found")
    updated = store.delete_knowledge_source(character_id, source_id)
    if not updated:
        raise HTTPException(status_code=404, detail="knowledge source not found")
    logger.info(
        "character %s knowledge source removed id=%s",
        character_id, source_id,
    )
    return updated
