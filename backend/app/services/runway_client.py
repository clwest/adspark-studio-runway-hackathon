import logging
import threading
import time
import uuid
from dataclasses import dataclass, field
from typing import Optional, cast

import httpx

from ..config import Settings
from ..models import RunwayGenerateRequest, RunwayGenerateResponse, RunwayTaskResponse, TaskStatus

logger = logging.getLogger(__name__)


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


def create_task(req: RunwayGenerateRequest, settings: Settings) -> RunwayGenerateResponse:
    if settings.runway_mock:
        task = _MOCK_STORE.create()
        return RunwayGenerateResponse(task_id=task.task_id, status="PENDING", mock_mode=True)

    body: dict = {
        "model": settings.runway_model,
        "promptText": req.prompt_text,
        "ratio": req.ratio,
        "duration": req.duration,
    }
    if req.prompt_image:
        body["promptImage"] = req.prompt_image

    url = f"{settings.runway_api_base}/v1/image_to_video"
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=_runway_headers(settings), json=body)
        resp.raise_for_status()
        payload = resp.json()
    task_id = payload.get("id") or payload.get("taskId") or ""
    if not task_id:
        raise RuntimeError(f"Runway response missing task id: {payload}")
    return RunwayGenerateResponse(task_id=task_id, status="PENDING", mock_mode=False)


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
