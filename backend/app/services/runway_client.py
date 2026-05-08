import base64
import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, cast

import httpx

from ..config import Settings
from ..models import (
    RunwayGenerateRequest,
    RunwayGenerateResponse,
    RunwayTaskResponse,
    TaskStatus,
)

logger = logging.getLogger(__name__)

# gen4.5 is the only video model that supports text-only generation today.
# Anything else routed through this client (currently just gen4_turbo) requires
# `promptImage`.
_TEXT_ONLY_CAPABLE_MODELS = {"gen4.5"}

# Per-model generation policy (PR C). Limits what the router will accept so a
# misconfigured request never spends Runway quota on a combination Runway will
# reject anyway. The set of values intentionally tracks what AdSpark exposes
# in the UI — broader Runway support exists for some models but is out of
# scope for the hackathon build.
GENERATION_POLICY: dict[str, dict] = {
    "gen4_turbo": {
        "image_required": True,
        "ratios": {"1280:720", "720:1280", "960:960"},
        "durations": {5},
    },
    "gen4.5": {
        "image_required": False,
        "ratios": {"1280:720", "720:1280", "960:960"},
        "durations": {5, 8, 10},
    },
}


class GenerationSettingsError(ValueError):
    """Raised when the requested model/ratio/duration/image combination is
    rejected by AdSpark's policy. The router maps this to HTTP 400.
    """


def validate_generation_settings(
    model: str,
    ratio: str,
    duration: int,
    has_image: bool,
    *,
    enforce_image_required: bool = True,
) -> None:
    """Enforce the per-model generation policy. Raises GenerationSettingsError
    on the first failure with a human-readable message.

    ``enforce_image_required`` lets callers (mock mode) skip the image
    requirement check while still getting model/ratio/duration validation.
    """
    policy = GENERATION_POLICY.get(model)
    if policy is None:
        supported = sorted(GENERATION_POLICY.keys())
        raise GenerationSettingsError(
            f"unsupported model '{model}'. supported: {supported}"
        )
    if ratio not in policy["ratios"]:
        raise GenerationSettingsError(
            f"unsupported ratio '{ratio}' for model {model}. "
            f"supported: {sorted(policy['ratios'])}"
        )
    if duration not in policy["durations"]:
        raise GenerationSettingsError(
            f"unsupported duration {duration}s for model {model}. "
            f"supported: {sorted(policy['durations'])}"
        )
    if enforce_image_required and policy["image_required"] and not has_image:
        raise GenerationSettingsError(
            f"prompt_image is required for model {model}. "
            "Use model=gen4.5 for text-only generation."
        )

# Local image-cache route prefix used by image_client + this client to swap a
# locally-served URL for a base64 data URI before posting to Runway. Mirrors
# the FastAPI route registered at GET /api/runway/image/{image_id}.
_LOCAL_IMAGE_PREFIX = "/api/runway/image/"


def resolve_model(req_model: Optional[str], settings: Settings) -> str:
    """Pick the request model, falling back to the configured default."""
    candidate = (req_model or settings.runway_model or "gen4_turbo").strip()
    return candidate or "gen4_turbo"


def image_required_for(model: str) -> bool:
    """Return True iff this video model requires `promptImage` to be supplied."""
    policy = GENERATION_POLICY.get(model)
    if policy is None:
        return model not in _TEXT_ONLY_CAPABLE_MODELS
    return bool(policy["image_required"])


@dataclass
class _MockTask:
    task_id: str
    started_at: float
    duration_seconds: float = 12.0
    failure_reason: Optional[str] = None
    output: list[str] = field(default_factory=list)


class _MockRunwayStore:
    """In-memory mock task tracker. Progress advances with wall-clock time."""

    def __init__(self) -> None:
        self._tasks: dict[str, _MockTask] = {}
        self._lock = threading.Lock()

    def create(self) -> _MockTask:
        task = _MockTask(task_id=f"mock_{uuid.uuid4().hex[:10]}", started_at=time.time())
        with self._lock:
            self._tasks[task.task_id] = task
        return task

    def get(self, task_id: str) -> Optional[_MockTask]:
        with self._lock:
            return self._tasks.get(task_id)


_MOCK_STORE = _MockRunwayStore()
_DEMO_VIDEO_URL = "https://download.samplelib.com/mp4/sample-5s.mp4"


def _mock_status(task: _MockTask) -> RunwayTaskResponse:
    elapsed = time.time() - task.started_at
    progress = min(elapsed / task.duration_seconds, 1.0)
    status: TaskStatus
    output: list[str]
    if progress >= 1.0:
        status = "SUCCEEDED"
        output = [_DEMO_VIDEO_URL]
    elif progress < 0.05:
        status = "PENDING"
        output = []
    else:
        status = "RUNNING"
        output = []
    return RunwayTaskResponse(
        task_id=task.task_id,
        status=status,
        progress=round(progress, 2),
        output=output,
        mock_mode=True,
    )


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _normalize_status(raw: str) -> TaskStatus:
    s = (raw or "").upper()
    if s in {"PENDING", "RUNNING", "SUCCEEDED", "FAILED", "CANCELED"}:
        return cast(TaskStatus, s)
    if s == "THROTTLED":
        return "RUNNING"
    return "RUNNING"


def maybe_to_data_uri(prompt_image: str, settings: Settings) -> str:
    """If `prompt_image` points at our local image-cache route, embed the cached
    PNG as a data URI so Runway (which can't reach localhost) can ingest it.

    Falls back to the original string for external URLs and existing data URIs.
    Silently passes through if the local file is missing — Runway will then
    surface the original URL error, which is the right user-visible failure.
    """
    if not prompt_image:
        return prompt_image
    pi = prompt_image.strip()
    if not pi.startswith(_LOCAL_IMAGE_PREFIX):
        return pi
    image_id = pi[len(_LOCAL_IMAGE_PREFIX):]
    # Defensive: refuse path traversal attempts.
    if "/" in image_id or ".." in image_id:
        return pi
    local: Path = settings.data_path / "images" / f"{image_id}.png"
    if not local.exists():
        return pi
    data = local.read_bytes()
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:image/png;base64,{b64}"


def create_task(req: RunwayGenerateRequest, settings: Settings) -> RunwayGenerateResponse:
    model = resolve_model(req.model, settings)

    if settings.runway_mock:
        task = _MOCK_STORE.create()
        endpoint = (
            "text_to_video"
            if model in _TEXT_ONLY_CAPABLE_MODELS
            and not (req.prompt_image and req.prompt_image.strip())
            else "image_to_video"
        )
        return RunwayGenerateResponse(
            task_id=task.task_id,
            status="PENDING",
            mock_mode=True,
            model=model,
            endpoint=endpoint,
        )

    has_image = bool(req.prompt_image and req.prompt_image.strip())
    use_text_only = (model in _TEXT_ONLY_CAPABLE_MODELS) and not has_image

    body: dict = {
        "model": model,
        "promptText": req.prompt_text,
        "ratio": req.ratio,
        "duration": req.duration,
    }
    endpoint = "text_to_video" if use_text_only else "image_to_video"
    if not use_text_only:
        if not has_image:
            # Belt-and-suspenders: this is also enforced by the router. A bare
            # call here without an image for an image-required model would
            # otherwise hit Runway and fail.
            raise RuntimeError(
                f"prompt_image is required for Runway {endpoint} (model={model})"
            )
        # Resolve local image-cache URLs to data URIs server-side so Runway
        # can fetch generated reference images without a public callback URL.
        body["promptImage"] = maybe_to_data_uri(req.prompt_image or "", settings)

    url = f"{settings.runway_api_base}/v1/{endpoint}"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=_runway_headers(settings), json=body)
        resp.raise_for_status()
        payload = resp.json()
    task_id = payload.get("id") or payload.get("taskId") or ""
    if not task_id:
        raise RuntimeError(f"Runway response missing task id: {payload}")
    return RunwayGenerateResponse(
        task_id=task_id,
        status="PENDING",
        mock_mode=False,
        model=model,
        endpoint=endpoint,
    )


def get_task(task_id: str, settings: Settings) -> RunwayTaskResponse:
    if settings.runway_mock or task_id.startswith("mock_"):
        task = _MOCK_STORE.get(task_id)
        if not task:
            return RunwayTaskResponse(
                task_id=task_id,
                status="FAILED",
                progress=0.0,
                output=[],
                failure_reason="Unknown mock task id",
                mock_mode=True,
            )
        return _mock_status(task)

    url = f"{settings.runway_api_base}/v1/tasks/{task_id}"
    with httpx.Client(timeout=20.0) as client:
        resp = client.get(url, headers=_runway_headers(settings))
        resp.raise_for_status()
        payload = resp.json()

    status = _normalize_status(payload.get("status", ""))
    output_field = payload.get("output") or []
    if isinstance(output_field, dict):
        output_urls = [v for v in output_field.values() if isinstance(v, str)]
    elif isinstance(output_field, list):
        output_urls = [v for v in output_field if isinstance(v, str)]
    else:
        output_urls = []

    progress = payload.get("progress")
    if not isinstance(progress, (int, float)):
        progress = 1.0 if status == "SUCCEEDED" else 0.0

    return RunwayTaskResponse(
        task_id=task_id,
        status=cast(TaskStatus, status),
        progress=float(progress),
        output=output_urls,
        failure_reason=payload.get("failure") or payload.get("error"),
        mock_mode=False,
    )
