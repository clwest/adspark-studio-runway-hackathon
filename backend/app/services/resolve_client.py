"""DaVinci Resolve Studio integration (PR EF).

Talks to a locally-running Resolve Studio 20 instance via its Python
scripting API to drive the "template auto-render" flow: load a
pre-built timeline, swap in the rendered avatar MP4, set Fusion
title text (product name + CTA), trigger Resolve's render queue,
poll until the output MP4 lands on disk.

PR EF-a (probe) verified Resolve 20.3.1.6 connects in <0.1s with
35 render presets available + a 'Runway Hackathon' project ready.

Module surface:

    is_available(settings) -> bool
        Quick health check. Returns False (never raises) when
        Resolve isn't running, scripting modules can't be located,
        or runway_mock is set. Routes call this before attempting
        any render to gate UI affordances.

    connect() -> Any
        Returns the live Resolve handle. Raises ResolveError on
        any failure with an actionable message.

    render_via_template(
        template_project, template_timeline,
        avatar_mp4, output_path,
        title_replacements, placeholder_clip_name,
        preset_name,
    ) -> ResolveRenderResult
        End-to-end: load template, swap clip, set titles, render,
        wait, return result. Mock-safe upstream — the router gates
        on settings.runway_mock.

Resolve's scripting API is local-only — it requires the Resolve
app running on the same machine as this Python process. There is
no remote / network-API path for the public release. PR EF intentionally
ships a local-only feature; deployed instances see the gate disable
the affordance.
"""
from __future__ import annotations

import logging
import os
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

from ..config import Settings

logger = logging.getLogger(__name__)


# ---- env setup (mirrors PR EF-a probe) ----------------------------

# macOS default paths for Resolve Studio 20. Override via
# RESOLVE_SCRIPT_API env if you've installed Resolve elsewhere.
_DEFAULT_RESOLVE_SCRIPT_API = (
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
)
_DEFAULT_RESOLVE_SCRIPT_LIB = (
    "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
)


# ---- template config (PR EF, verified by probe-resolve-template) --
#
# These match the template Chris built in his Resolve install
# (Runway Hackathon project / character-os-template-v1 timeline /
# test_this_file.mp4 placeholder). If the operator restructures
# their template, change these constants — they're intentionally
# centralised here rather than scattered through the router.
RESOLVE_PROJECT_NAME = "Runway Hackathon"
RESOLVE_TIMELINE_NAME = "character-os-template-v1"
RESOLVE_PLACEHOLDER_CLIP = "test_this_file.mp4"
RESOLVE_RENDER_PRESET = "H.264 Master"


def _configure_env() -> bool:
    """Idempotent env-setup so we can `import DaVinciResolveScript`.
    Returns True if the modules path exists on disk."""
    script_api = (
        os.environ.get("RESOLVE_SCRIPT_API") or _DEFAULT_RESOLVE_SCRIPT_API
    )
    script_lib = (
        os.environ.get("RESOLVE_SCRIPT_LIB") or _DEFAULT_RESOLVE_SCRIPT_LIB
    )
    os.environ["RESOLVE_SCRIPT_API"] = script_api
    os.environ["RESOLVE_SCRIPT_LIB"] = script_lib
    modules_path = str(Path(script_api) / "Modules")
    existing = os.environ.get("PYTHONPATH", "")
    if modules_path not in existing.split(os.pathsep):
        os.environ["PYTHONPATH"] = (
            modules_path if not existing else f"{modules_path}{os.pathsep}{existing}"
        )
    if modules_path not in sys.path:
        sys.path.insert(0, modules_path)
    return Path(modules_path).exists()


# ---- errors --------------------------------------------------------


class ResolveError(RuntimeError):
    """Anything that goes wrong talking to Resolve. Carries an
    actionable message so the operator can see what to fix in
    Resolve's UI (launch the app, set External Scripting → Local,
    re-name the timeline, etc.)."""


class ResolveNotRunningError(ResolveError):
    """Resolve Studio is not running locally. Operator must launch
    it manually — we can't spawn it (locks the install license,
    requires GUI session)."""


class ResolveTemplateError(ResolveError):
    """Template project / timeline / clip / title not found.
    Distinct error so the UI can prompt 'check your template' vs
    'launch Resolve'."""


# ---- result dataclass ---------------------------------------------


@dataclass
class ResolveRenderResult:
    status: str  # "ok" | "failed" | "unavailable"
    output_path: Optional[Path] = None
    job_id: Optional[str] = None
    error: Optional[str] = None
    elapsed_seconds: Optional[float] = None
    # Diagnostic surface — keep small but useful when debugging.
    details: dict = field(default_factory=dict)


# ---- module-level state ------------------------------------------


def is_available(settings: Settings) -> bool:
    """Best-effort health check. Returns False on any failure path
    so the UI can disable the Resolve render button rather than
    surfacing 500s. Never raises.

    Gated by ``runway_mock`` — in mock mode we always report
    unavailable so the demo flow doesn't try to launch a real
    Resolve render against a mock avatar MP4.
    """
    if getattr(settings, "runway_mock", False):
        return False
    if not _configure_env():
        logger.info("resolve scripting modules path missing")
        return False
    try:
        import DaVinciResolveScript as dvr  # type: ignore
    except ImportError:
        logger.info("DaVinciResolveScript module unavailable")
        return False
    try:
        resolve = dvr.scriptapp("Resolve")
    except Exception as exc:
        logger.info("dvr.scriptapp failed: %s", exc)
        return False
    return resolve is not None


def connect() -> Any:
    """Get a live Resolve handle. Raises ResolveNotRunningError if
    Resolve isn't running or External Scripting prefs are blocking."""
    if not _configure_env():
        raise ResolveError(
            "DaVinci Resolve Studio scripting modules not found at "
            "the expected path. Either Resolve Studio isn't installed "
            "or it's never been launched — open the app once and "
            "retry."
        )
    try:
        import DaVinciResolveScript as dvr  # type: ignore
    except ImportError as exc:
        raise ResolveError(
            f"DaVinciResolveScript import failed: {exc}. "
            "Resolve Studio (not free Resolve) must be installed."
        ) from exc
    try:
        resolve = dvr.scriptapp("Resolve")
    except Exception as exc:
        raise ResolveError(f"Resolve handshake failed: {exc}") from exc
    if not resolve:
        raise ResolveNotRunningError(
            "Resolve Studio isn't running. Launch the app and verify "
            "Preferences → System → General → 'External scripting "
            "using' is set to 'Local'."
        )
    return resolve


# ---- template navigation -----------------------------------------


def _get_project(resolve: Any, project_name: str) -> Any:
    pm = resolve.GetProjectManager()
    if not pm:
        raise ResolveError("Resolve ProjectManager unavailable")
    current = pm.GetCurrentProject()
    if current and current.GetName() == project_name:
        return current
    # Try to load by name. LoadProject returns the project on
    # success, None on failure.
    project = pm.LoadProject(project_name)
    if not project:
        raise ResolveTemplateError(
            f"Resolve project {project_name!r} not found. Open it "
            "in Resolve, save it, and retry."
        )
    return project


def _get_timeline(project: Any, timeline_name: str) -> Any:
    n = project.GetTimelineCount() or 0
    for idx in range(1, n + 1):  # Resolve indexes from 1
        tl = project.GetTimelineByIndex(idx)
        if tl and tl.GetName() == timeline_name:
            project.SetCurrentTimeline(tl)
            return tl
    raise ResolveTemplateError(
        f"Timeline {timeline_name!r} not found in the current "
        f"project. Available timelines: " + ", ".join(
            (project.GetTimelineByIndex(i).GetName() or "?")
            for i in range(1, n + 1)
        )
    )


def _find_timeline_item_by_clip_name(
    timeline: Any, track_index: int, clip_name: str,
) -> tuple[Any, int, int]:
    """Locate a timeline item on a video track whose underlying
    MediaPoolItem name contains ``clip_name`` (case-insensitive
    substring match, since operators often rename clips with .mp4
    extension or version suffixes).

    Returns ``(timeline_item, start_frame, end_frame)``.
    """
    items = timeline.GetItemListInTrack("video", track_index) or []
    needle = clip_name.lower()
    for item in items:
        pool_item = item.GetMediaPoolItem()
        if pool_item is None:
            continue
        name = pool_item.GetName() or ""
        if needle in name.lower():
            return item, item.GetStart(), item.GetEnd()
    raise ResolveTemplateError(
        f"Placeholder clip {clip_name!r} not found on video track "
        f"{track_index}. Make sure the clip is on V{track_index} "
        "and its Media Pool name contains that string."
    )


# ---- clip swap ----------------------------------------------------


def replace_avatar_clip(
    project: Any,
    timeline: Any,
    placeholder_name: str,
    new_mp4_path: Path,
    track_index: int = 1,
) -> dict:
    """Swap the placeholder clip on a video track with a freshly
    imported MP4. Used to drop the Runway avatar render into the
    template timeline.

    Returns diagnostic info (start_frame, duration_frames, new clip
    name) for the caller to log.
    """
    if not new_mp4_path.exists():
        raise ResolveError(f"avatar MP4 missing on disk: {new_mp4_path}")

    mp = project.GetMediaPool()
    if mp is None:
        raise ResolveError("Resolve MediaPool handle unavailable")

    # Locate the placeholder + remember its position.
    placeholder_item, start_frame, end_frame = _find_timeline_item_by_clip_name(
        timeline, track_index, placeholder_name,
    )
    duration_frames = end_frame - start_frame
    logger.info(
        "resolve: placeholder %r found on V%d at frame %d, duration %d frames",
        placeholder_name, track_index, start_frame, duration_frames,
    )

    # Import the new MP4 to Media Pool.
    imported = mp.ImportMedia([str(new_mp4_path)])
    if not imported:
        raise ResolveError(
            f"Resolve refused to import {new_mp4_path.name}. Check "
            "that the file is a valid MP4 with both video and audio."
        )
    new_pool_item = imported[0]
    logger.info("resolve: imported %r to MediaPool", new_pool_item.GetName())

    # Delete the placeholder timeline item BEFORE adding the new
    # one — otherwise they'd overlap.
    timeline.DeleteClips([placeholder_item])
    logger.info("resolve: deleted placeholder timeline item")

    # Insert the new clip at the same frame position. AppendToTimeline
    # with clipInfo lets us pin the position precisely.
    clip_info = [{
        "mediaPoolItem": new_pool_item,
        "startFrame": 0,
        "endFrame": new_pool_item.GetClipProperty("Frames") or duration_frames,
        "trackIndex": track_index,
        "recordFrame": start_frame,
    }]
    appended = mp.AppendToTimeline(clip_info)
    if not appended:
        raise ResolveError(
            "AppendToTimeline returned empty — the new clip didn't "
            "land. Likely the recordFrame collides with something else "
            "on V" + str(track_index) + " or the clip exceeds the gap "
            "available."
        )
    logger.info(
        "resolve: appended new clip at frame %d on V%d",
        start_frame, track_index,
    )
    return {
        "placeholder_name": placeholder_name,
        "new_clip_name": new_pool_item.GetName(),
        "start_frame": start_frame,
        "duration_frames": duration_frames,
    }


# ---- Fusion title text --------------------------------------------


def set_title_text(
    timeline: Any,
    title_clip_name: str,
    new_text: str,
    track_index: int = 3,
) -> bool:
    """Find a Fusion-title timeline item by clip name and set its
    primary StyledText input. Returns True on success; logs and
    returns False on any failure path (title swap is best-effort —
    a render that fails the text update should still produce
    output).
    """
    try:
        items = timeline.GetItemListInTrack("video", track_index) or []
        needle = title_clip_name.lower()
        for item in items:
            name = item.GetName() or ""
            if needle in name.lower():
                fusion_count = item.GetFusionCompCount() or 0
                if fusion_count <= 0:
                    logger.warning(
                        "resolve: %r has no Fusion comp — skipping",
                        title_clip_name,
                    )
                    return False
                comp = item.GetFusionCompByIndex(1)
                if comp is None:
                    return False
                # Try the most common text-node names operators use.
                for node_name in (
                    "Template", "Text", "Text1", "Text2", "TextPlus", "Title",
                ):
                    node = comp.FindTool(node_name)
                    if node is not None:
                        node.SetInput("StyledText", new_text)
                        logger.info(
                            "resolve: set %r.%s = %r",
                            title_clip_name, node_name, new_text,
                        )
                        return True
                logger.warning(
                    "resolve: %r found but no Text node matched — "
                    "rename your Fusion text node to 'Template' "
                    "for auto-replace.",
                    title_clip_name,
                )
                return False
        logger.warning(
            "resolve: title %r not found on V%d — skipping text swap",
            title_clip_name, track_index,
        )
        return False
    except Exception as exc:
        logger.warning("resolve: title swap failed for %r: %s",
                       title_clip_name, exc)
        return False


# ---- render queue --------------------------------------------------


def trigger_render(
    project: Any,
    preset_name: str,
    output_dir: Path,
    output_name: str,
) -> str:
    """Load a render preset, add a job to the queue, kick off the
    render. Returns the job_id (used for polling).

    Caller is responsible for waiting on the job via
    ``wait_for_render(project, job_id, timeout)``.
    """
    ok = project.LoadRenderPreset(preset_name)
    if not ok:
        raise ResolveError(
            f"Resolve render preset {preset_name!r} not found. "
            "Check Resolve → Deliver → Render Presets for available "
            "names."
        )
    output_dir.mkdir(parents=True, exist_ok=True)
    # Setting both TargetDir and CustomName is required even when
    # using a preset — the preset doesn't carry the output path.
    settings = {
        "TargetDir": str(output_dir),
        "CustomName": output_name,
    }
    if not project.SetRenderSettings(settings):
        raise ResolveError(
            "SetRenderSettings refused the target dir / custom name. "
            "Verify the directory exists and is writable."
        )
    job_id = project.AddRenderJob()
    if not job_id:
        raise ResolveError(
            "AddRenderJob returned empty — render queue may be in a "
            "bad state. Clear it manually in Resolve's Deliver page."
        )
    started = project.StartRendering(job_id)
    if not started:
        raise ResolveError(
            f"StartRendering({job_id}) returned False — render "
            "couldn't begin. Check Resolve's status bar for the reason."
        )
    logger.info(
        "resolve: render started job=%s preset=%r output=%s/%s",
        job_id, preset_name, output_dir, output_name,
    )
    return job_id


def wait_for_render(
    project: Any,
    job_id: str,
    *,
    timeout: float = 600.0,
    poll_interval: float = 2.0,
) -> dict:
    """Poll Resolve until the named job stops rendering. Returns the
    job's status dict (Resolve reports a dict with 'JobStatus' and
    optional 'Error' keys).

    Raises ResolveError on timeout. Surfaces the final job status
    dict either way so the caller can log it.
    """
    deadline = time.time() + timeout
    while time.time() < deadline:
        if not project.IsRenderingInProgress():
            status = project.GetRenderJobStatus(job_id) or {}
            logger.info("resolve: job=%s status=%s", job_id, status)
            return status
        time.sleep(poll_interval)
    raise ResolveError(
        f"Render job {job_id} did not complete within {int(timeout)}s. "
        "Check Resolve's Deliver page — render may still be running."
    )


# ---- public entry --------------------------------------------------


def render_via_template(
    *,
    project_name: str,
    timeline_name: str,
    placeholder_clip_name: str,
    avatar_mp4: Path,
    title_replacements: dict[str, str],
    preset_name: str,
    output_dir: Path,
    output_name: str,
    timeout: float = 600.0,
) -> ResolveRenderResult:
    """End-to-end pipeline: load template, swap clip, set titles,
    render, wait, report.

    Never raises in normal operation — wraps the underlying
    ResolveError chain into a ``ResolveRenderResult(status="failed")``
    so callers can branch on result.status instead of catching.

    Returns ``status="unavailable"`` when Resolve isn't running /
    not installed / mock mode. Status="ok" carries
    ``output_path`` pointing at the final MP4 inside ``output_dir``.
    """
    t0 = time.time()
    try:
        resolve = connect()
    except ResolveError as exc:
        return ResolveRenderResult(
            status="unavailable",
            error=str(exc),
            elapsed_seconds=time.time() - t0,
        )

    try:
        project = _get_project(resolve, project_name)
        timeline = _get_timeline(project, timeline_name)
        swap_info = replace_avatar_clip(
            project, timeline, placeholder_clip_name, avatar_mp4,
        )
        title_results: dict[str, bool] = {}
        for title_name, new_text in title_replacements.items():
            title_results[title_name] = set_title_text(
                timeline, title_name, new_text,
            )
        job_id = trigger_render(project, preset_name, output_dir, output_name)
        status = wait_for_render(project, job_id, timeout=timeout)
    except ResolveError as exc:
        logger.warning("resolve render failed: %s", exc)
        return ResolveRenderResult(
            status="failed",
            error=str(exc),
            elapsed_seconds=time.time() - t0,
        )
    except Exception as exc:  # pragma: no cover — defensive
        logger.exception("resolve render crashed unexpectedly")
        return ResolveRenderResult(
            status="failed",
            error=f"unexpected: {exc!s}"[:300],
            elapsed_seconds=time.time() - t0,
        )

    # Resolve's GetRenderJobStatus surfaces 'JobStatus' enum string.
    # Anything other than "Complete" is a failure even if the call
    # itself didn't throw.
    job_status = (status or {}).get("JobStatus") or "Unknown"
    if job_status != "Complete":
        return ResolveRenderResult(
            status="failed",
            job_id=job_id,
            error=f"Resolve job {job_id} ended with status {job_status!r}",
            elapsed_seconds=time.time() - t0,
            details=status,
        )

    # Resolve appends the preset's extension to CustomName. Find the
    # newest mp4 in output_dir matching output_name as a prefix.
    candidates = sorted(
        output_dir.glob(f"{output_name}*"),
        key=lambda p: p.stat().st_mtime,
        reverse=True,
    )
    final_path = next((p for p in candidates if p.is_file()), None)
    if not final_path or not final_path.exists():
        return ResolveRenderResult(
            status="failed",
            job_id=job_id,
            error=(
                f"Render reported Complete but no output file found "
                f"matching {output_name}* in {output_dir}"
            ),
            elapsed_seconds=time.time() - t0,
            details={**swap_info, "title_results": title_results},
        )

    logger.info(
        "resolve render complete job=%s output=%s elapsed=%.1fs",
        job_id, final_path, time.time() - t0,
    )
    return ResolveRenderResult(
        status="ok",
        output_path=final_path,
        job_id=job_id,
        elapsed_seconds=time.time() - t0,
        details={**swap_info, "title_results": title_results},
    )
