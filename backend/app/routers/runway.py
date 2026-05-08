import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException

from ..config import Settings, get_settings
from ..models import RunwayGenerateRequest, RunwayGenerateResponse, RunwayTaskResponse
from ..services.runway_client import create_task, get_task as fetch_task

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/runway", tags=["runway"])


@router.post("/generate", response_model=RunwayGenerateResponse)
def post_generate(
    req: RunwayGenerateRequest,
    settings: Settings = Depends(get_settings),
) -> RunwayGenerateResponse:
    if not settings.runway_mock and not (req.prompt_image and req.prompt_image.strip()):
        raise HTTPException(
            status_code=400,
            detail="prompt_image is required for Runway image_to_video real mode",
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
