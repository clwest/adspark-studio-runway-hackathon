import logging
import uuid
from typing import Optional

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from fastapi.responses import FileResponse

from ..config import Settings, get_settings
from ..models import (
    ImageGenerateRequest,
    ImageGenerateResponse,
    RunwayGenerateRequest,
    RunwayGenerateResponse,
    RunwayTaskResponse,
)
from ..services.avatar_listing_client import list_avatars
from ..services.image_client import (
    ImageGenerationError,
    SUPPORTED_IMAGE_EXTS,
    find_image_path,
    generate_prompt_image,
    path_for as image_path_for,
)
from ..services.runway_client import (
    GENERATION_POLICY,
    GenerationSettingsError,
    create_task,
    get_task as fetch_task,
    resolve_model,
    validate_generation_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runway", tags=["runway"])


_CHARACTER_PORTRAIT_PREFIX = "/api/characters/"
_CHARACTER_PORTRAIT_SUFFIX = "/portrait"


@router.post("/generate", response_model=RunwayGenerateResponse)
def post_generate(
    req: RunwayGenerateRequest,
    settings: Settings = Depends(get_settings),
) -> RunwayGenerateResponse:
    model = resolve_model(req.model, settings)
    has_image = bool(req.prompt_image and req.prompt_image.strip())
    # In mock mode we still validate model/ratio/duration so the UI gets the
    # same 400s as it would in real mode, but we skip the image-required
    # check — the in-memory mock task succeeds with a sample MP4 regardless.
    try:
        validate_generation_settings(
            model=model,
            ratio=req.ratio,
            duration=req.duration,
            has_image=has_image,
            enforce_image_required=not settings.runway_mock,
        )
    except GenerationSettingsError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    # PR W — when the user selects "Use Character" as Visual Source,
    # the frontend posts prompt_image="/api/characters/<id>/portrait".
    # If the backing portrait file doesn't exist, return 404 immediately
    # rather than passing the unresolvable URL through to Runway (which
    # would burn a credit chasing a localhost URL and respond with a
    # confusing upstream error). In mock mode we skip — the mock task
    # ignores prompt_image content and would succeed regardless.
    if not settings.runway_mock and has_image:
        pi = (req.prompt_image or "").strip()
        if pi.startswith(_CHARACTER_PORTRAIT_PREFIX) and pi.endswith(_CHARACTER_PORTRAIT_SUFFIX):
            char_id = pi[len(_CHARACTER_PORTRAIT_PREFIX):-len(_CHARACTER_PORTRAIT_SUFFIX)]
            if not char_id or "/" in char_id or ".." in char_id:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"invalid character id in prompt_image: {pi!r}"
                    ),
                )
            portrait = settings.data_path / "characters" / f"{char_id}-portrait.png"
            if not portrait.exists():
                raise HTTPException(
                    status_code=404,
                    detail=(
                        f"character portrait not found for {char_id!r}. "
                        "Generate the portrait in Character Studio first, "
                        "then retry."
                    ),
                )

    try:
        return create_task(req, settings)
    except httpx.HTTPStatusError as exc:
        logger.warning("Runway create task error: %s %s", exc.response.status_code, exc.response.text)
        raise HTTPException(status_code=502, detail=f"Runway error: {exc.response.status_code}") from exc
    except Exception as exc:
        logger.exception("Runway generate failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/task/{task_id}", response_model=RunwayTaskResponse)
def get_runway_task(task_id: str, settings: Settings = Depends(get_settings)) -> RunwayTaskResponse:
    try:
        return fetch_task(task_id, settings)
    except httpx.HTTPStatusError as exc:
        logger.warning("Runway task fetch error: %s %s", exc.response.status_code, exc.response.text)
        raise HTTPException(status_code=502, detail=f"Runway error: {exc.response.status_code}") from exc
    except Exception as exc:
        logger.exception("Runway task fetch failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.post("/image", response_model=ImageGenerateResponse)
def post_generate_image(
    req: ImageGenerateRequest,
    settings: Settings = Depends(get_settings),
) -> ImageGenerateResponse:
    """Generate a reference image (mock or real Runway text_to_image) and
    cache it under data/images. Returns a stable local URL the frontend can
    preview and feed into POST /api/runway/generate as `prompt_image`.
    """
    try:
        return generate_prompt_image(req, settings)
    except ImageGenerationError as exc:
        logger.warning("image generation failed: %s", exc)
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "Runway text_to_image error: %s %s",
            exc.response.status_code, exc.response.text,
        )
        raise HTTPException(
            status_code=502, detail=f"Runway error: {exc.response.status_code}",
        ) from exc
    except Exception as exc:
        logger.exception("image generation crashed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc


@router.get("/image/{image_id}")
def get_generated_image(
    image_id: str,
    settings: Settings = Depends(get_settings),
) -> FileResponse:
    # Defensive: the id is already constrained to hex by the generator, but
    # we still refuse anything path-like to keep this route hardened.
    if "/" in image_id or ".." in image_id or not image_id:
        raise HTTPException(status_code=400, detail="invalid image id")
    # PR R — uploads can be png / jpg / webp. find_image_path tries each
    # supported extension; serves the first match with the right
    # media-type so browser previews render correctly across formats.
    path = find_image_path(settings, image_id)
    if path is None:
        raise HTTPException(status_code=404, detail="image not found")
    media = {
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "webp": "image/webp",
    }.get(path.suffix.lstrip(".").lower(), "image/png")
    return FileResponse(str(path), media_type=media, filename=path.name)


# PR R — Visual Source flow: dedicated upload endpoint so the frontend
# can offer "Upload image" alongside the existing Generate / Character /
# Text-only options. Saves into the same backend/data/images/ cache the
# generator uses, so the resulting URL drops into the generate-video
# pipeline without any further translation.
_UPLOAD_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
_UPLOAD_EXT_FOR_TYPE = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
}


@router.post("/upload-image", response_model=ImageGenerateResponse)
async def post_upload_image(
    file: UploadFile = File(...),
    settings: Settings = Depends(get_settings),
) -> ImageGenerateResponse:
    """Accept a multipart image upload (png / jpg / webp, ≤10 MB) and
    cache it under data/images/<id>.<ext>.  Returns the same shape as
    /api/runway/image so the frontend can route the result through the
    same generate-video helper.
    """
    ctype = (file.content_type or "").lower().split(";")[0].strip()
    ext = _UPLOAD_EXT_FOR_TYPE.get(ctype)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail=(
                f"unsupported content-type {ctype or '(missing)'!r}. "
                f"supported: {sorted(set(_UPLOAD_EXT_FOR_TYPE))}"
            ),
        )

    raw = await file.read()
    if not raw:
        raise HTTPException(status_code=400, detail="empty upload")
    if len(raw) > _UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=413,
            detail=(
                f"image exceeds cap ({_UPLOAD_MAX_BYTES} bytes; "
                f"received {len(raw)})"
            ),
        )

    image_id = uuid.uuid4().hex[:12]
    target_dir = settings.data_path / "images"
    target_dir.mkdir(parents=True, exist_ok=True)
    target = target_dir / f"{image_id}.{ext}"
    tmp = target.with_suffix(target.suffix + ".tmp")
    tmp.write_bytes(raw)
    tmp.replace(target)
    logger.info(
        "uploaded image cached: %s (%d bytes, %s)",
        target.name, len(raw), ctype,
    )
    # ImageGenerateResponse is reused so the frontend's existing
    # generate-image consumer can swallow this without changes.
    return ImageGenerateResponse(
        image_id=image_id,
        image_url=f"/api/runway/image/{image_id}",
        mock_mode=False,
        model="upload",
    )


@router.get("/avatars")
def get_avatars(settings: Settings = Depends(get_settings)) -> dict:
    """List avatars available to the picker.  Curated, secret-free
    projection of Runway's ``GET /v1/avatars`` (in real mode) or four
    hard-coded mock entries (in mock mode).
    """
    return {"data": list_avatars(settings), "mock_mode": settings.runway_mock}


@router.get("/provider-status")
def get_provider_status(settings: Settings = Depends(get_settings)) -> dict:
    """Public, secret-free metadata about generation capabilities.

    Used by the frontend to render the readiness/status chip and to verify
    that the policy table the UI assumes still matches what the backend
    enforces. Never returns the API key.
    """
    return {
        "runway_mock": settings.runway_mock,
        "image_gen_mock": settings.runway_mock,
        "video_gen_mock": settings.runway_mock,
        "has_runway_key": not settings.runway_mock,
        "supported_models": sorted(GENERATION_POLICY.keys()),
        "supported_ratios_by_model": {
            m: sorted(p["ratios"]) for m, p in GENERATION_POLICY.items()
        },
        "supported_durations_by_model": {
            m: sorted(p["durations"]) for m, p in GENERATION_POLICY.items()
        },
        "image_required_by_model": {
            m: bool(p["image_required"]) for m, p in GENERATION_POLICY.items()
        },
    }


def _extract_credits(payload: dict) -> Optional[float]:
    """Pull a numeric credit balance from a Runway organization response.

    The /v1/organization endpoint shape is undocumented enough that we accept
    a few common field names. Returns None when no numeric value is found.
    """
    for path in (
        ("creditsRemaining",),
        ("credits", "remaining"),
        ("credits", "balance"),
        ("credits",),
        ("balance", "credits"),
        ("balance",),
        ("usage", "creditsRemaining"),
    ):
        cur: object = payload
        ok = True
        for key in path:
            if isinstance(cur, dict) and key in cur:
                cur = cur[key]
            else:
                ok = False
                break
        if ok and isinstance(cur, (int, float)):
            return float(cur)
    return None


@router.get("/organization")
def get_organization(settings: Settings = Depends(get_settings)) -> dict:
    """Best-effort proxy of Runway's /v1/organization. Never raises and never
    returns the API key. Mock mode short-circuits with credits=None so the
    UI can decide whether to render a credit chip.

    The Runway response shape is intentionally treated as opaque — we extract
    a numeric credit value when we can recognise one and otherwise pass
    through whatever fields look interesting (plan, tier) without leaking
    secrets. Failures land in the response body so the frontend stays
    non-blocking.
    """
    if settings.runway_mock:
        return {"mock_mode": True, "credits": None}

    url = f"{settings.runway_api_base}/v1/organization"
    headers = {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.get(url, headers=headers)
        if resp.status_code != 200:
            logger.warning(
                "runway organization status %s: %s",
                resp.status_code, resp.text[:200],
            )
            return {
                "mock_mode": False,
                "credits": None,
                "error": f"runway returned {resp.status_code}",
            }
        payload = resp.json() if resp.content else {}
    except httpx.HTTPError as exc:
        logger.warning("runway organization fetch failed: %s", exc)
        return {"mock_mode": False, "credits": None, "error": "fetch failed"}
    except Exception:
        logger.exception("runway organization unexpected error")
        return {"mock_mode": False, "credits": None, "error": "unexpected error"}

    if not isinstance(payload, dict):
        return {"mock_mode": False, "credits": None, "error": "unexpected response shape"}

    # Runway's /v1/organization returns plan limits keyed under `tier` (or
    # `plan`, depending on account shape) and includes a noisy per-model
    # `models` quota map. We strip that out and extract only the small set
    # of safe fields the frontend can render.
    tier_raw = payload.get("tier") or payload.get("plan")
    tier: dict = tier_raw if isinstance(tier_raw, dict) else {}
    return {
        "mock_mode": False,
        "credits": _extract_credits(payload),
        "monthly_credit_cap": tier.get("maxMonthlyCreditSpend"),
    }
