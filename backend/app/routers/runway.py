import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse

from ..config import Settings, get_settings
from ..models import (
    ImageGenerateRequest,
    ImageGenerateResponse,
    RunwayGenerateRequest,
    RunwayGenerateResponse,
    RunwayTaskResponse,
)
from ..services.image_client import (
    ImageGenerationError,
    generate_prompt_image,
    path_for as image_path_for,
)
from ..services.runway_client import (
    GenerationSettingsError,
    create_task,
    get_task as fetch_task,
    resolve_model,
    validate_generation_settings,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runway", tags=["runway"])


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
    path = image_path_for(settings, image_id)
    if not path.exists():
        raise HTTPException(status_code=404, detail="image not found")
    return FileResponse(str(path), media_type="image/png", filename=f"{image_id}.png")
