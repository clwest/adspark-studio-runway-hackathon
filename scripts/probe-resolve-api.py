#!/usr/bin/env python3
"""Probe: can we talk to DaVinci Resolve Studio 20 via its Python API?

First step toward the Character OS ↔ Resolve "template auto-render"
integration. Resolve's scripting API has notorious environment
quirks (PYTHONPATH + module location + version-specific surface);
this probe verifies we can:

  1. Locate `DaVinciResolveScript` module on this machine
  2. Connect to a running Resolve Studio instance
  3. Introspect: version, current project, current timeline,
     render presets, media pool root
  4. (Optional) `--smoke-test` creates a test project, gets its
     timeline, lists media pool, then closes WITHOUT saving so
     nothing the operator has open gets touched

Read-only by default. If Resolve isn't running, the External
Scripting preference is locked, or the module can't be located,
the probe exits with actionable error messages rather than
crashing.

macOS paths for Resolve Studio 20 (default install):
  RESOLVE_SCRIPT_API = "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
  RESOLVE_SCRIPT_LIB = "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
  PYTHONPATH adds: ${RESOLVE_SCRIPT_API}/Modules

The probe sets these env vars if missing so the operator doesn't
have to twiddle their shell profile.

Usage:
  # Read-only introspection (always safe):
  python scripts/probe-resolve-api.py

  # Smoke test — creates a `CharacterOS Probe` project, queries it,
  # then closes it (without saving):
  python scripts/probe-resolve-api.py --smoke-test

Prereqs:
  - DaVinci Resolve Studio (not free Resolve — scripting API is
    Studio-only) installed and **currently running** on this Mac
  - Resolve → Preferences → System → General → External scripting
    using: set to **Local** (default in recent versions)
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

LOG_PATH = Path(tempfile.gettempdir()) / (
    f"probe-resolve-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
)

# macOS default install. Override with --api-base if your install
# put Resolve somewhere non-standard.
DEFAULT_RESOLVE_SCRIPT_API = (
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
)
DEFAULT_RESOLVE_SCRIPT_LIB = (
    "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
)


def setup_logging() -> logging.Logger:
    logger = logging.getLogger("probe")
    logger.setLevel(logging.INFO)
    fh = logging.FileHandler(LOG_PATH)
    fh.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(fh)
    sh = logging.StreamHandler()
    sh.setFormatter(logging.Formatter("%(message)s"))
    logger.addHandler(sh)
    return logger


def configure_env(logger: logging.Logger, api_base: str | None) -> tuple[str, str]:
    """Set the three env vars Resolve's scripting helper expects,
    using defaults that match a stock macOS Resolve Studio 20 install.
    """
    script_api = api_base or os.environ.get("RESOLVE_SCRIPT_API") or DEFAULT_RESOLVE_SCRIPT_API
    script_lib = os.environ.get("RESOLVE_SCRIPT_LIB") or DEFAULT_RESOLVE_SCRIPT_LIB

    os.environ["RESOLVE_SCRIPT_API"] = script_api
    os.environ["RESOLVE_SCRIPT_LIB"] = script_lib

    modules_path = str(Path(script_api) / "Modules")
    existing = os.environ.get("PYTHONPATH", "")
    if modules_path not in existing.split(os.pathsep):
        os.environ["PYTHONPATH"] = (
            modules_path if not existing else f"{modules_path}{os.pathsep}{existing}"
        )
    # Critical: also extend sys.path so this Python process can
    # `import DaVinciResolveScript` immediately.
    if modules_path not in sys.path:
        sys.path.insert(0, modules_path)

    logger.info("RESOLVE_SCRIPT_API = %s", script_api)
    logger.info("RESOLVE_SCRIPT_LIB = %s", script_lib)
    logger.info("PYTHONPATH modules entry = %s", modules_path)

    if not Path(script_api).exists():
        logger.warning(
            "RESOLVE_SCRIPT_API path does not exist on disk — Resolve "
            "Studio may not be installed at the expected location."
        )
    if not Path(script_lib).exists():
        logger.warning(
            "RESOLVE_SCRIPT_LIB path does not exist on disk — Resolve "
            "Studio may not be installed at the expected location."
        )
    if not Path(modules_path).exists():
        logger.warning(
            "DaVinciResolveScript modules directory missing: %s. "
            "Has Resolve Studio been launched at least once?",
            modules_path,
        )
    return script_api, script_lib


def import_scripting_module(logger: logging.Logger):
    """Try the import; report a helpful error if it fails."""
    try:
        import DaVinciResolveScript as dvr  # noqa: E402
        return dvr
    except ImportError as exc:
        logger.error("import DaVinciResolveScript failed: %s", exc)
        logger.error("")
        logger.error("Most likely causes:")
        logger.error("  1. Resolve Studio not installed (the FREE Resolve")
        logger.error("     does NOT include the scripting API).")
        logger.error("  2. Resolve Studio installed but never launched —")
        logger.error("     the scripting modules drop into place on")
        logger.error("     first launch.")
        logger.error("  3. Non-standard install path. Re-run with:")
        logger.error("       --api-base /path/to/Scripting")
        raise SystemExit(1)


def connect(logger: logging.Logger, dvr) -> object:
    """Get the live Resolve handle. None if Resolve isn't running or
    External Scripting prefs are blocking the connection."""
    logger.info("connecting to running Resolve instance…")
    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        logger.error("dvr.scriptapp('Resolve') returned None.")
        logger.error("")
        logger.error("Most likely causes:")
        logger.error("  1. Resolve isn't running. Launch it and try again.")
        logger.error("  2. External Scripting preference is set to None.")
        logger.error("     Open Resolve → Preferences → System → General")
        logger.error("     → 'External scripting using' → set to 'Local'.")
        logger.error("  3. Two Resolve installs (Studio + free) competing")
        logger.error("     for the API socket.")
        raise SystemExit(2)
    return resolve


def introspect(logger: logging.Logger, resolve) -> dict:
    """Read-only inspection of the live Resolve state."""
    info: dict = {}

    # Version: returns a list like [20, 0, 0, 0, 'beta'] or similar
    try:
        version = resolve.GetVersion()
        version_str = resolve.GetVersionString()
        info["version_array"] = version
        info["version_string"] = version_str
        logger.info("Resolve version: %s (array=%s)", version_str, version)
    except Exception as exc:
        logger.warning("GetVersion failed: %s", exc)
        info["version_error"] = str(exc)

    # Project manager
    try:
        pm = resolve.GetProjectManager()
        info["project_manager_ok"] = pm is not None
        logger.info("ProjectManager handle: %s", "OK" if pm else "None")
    except Exception as exc:
        logger.warning("GetProjectManager failed: %s", exc)
        info["project_manager_error"] = str(exc)
        return info

    if not pm:
        return info

    # Current project (may be None if no project loaded)
    try:
        project = pm.GetCurrentProject()
        if project:
            name = project.GetName()
            info["current_project_name"] = name
            info["timeline_count"] = project.GetTimelineCount()
            logger.info(
                "Current project: %r  timelines=%d",
                name, info["timeline_count"],
            )

            # Current timeline
            try:
                tl = project.GetCurrentTimeline()
                if tl:
                    tl_name = tl.GetName()
                    tl_tracks_v = tl.GetTrackCount("video")
                    tl_tracks_a = tl.GetTrackCount("audio")
                    info["current_timeline"] = {
                        "name": tl_name,
                        "video_tracks": tl_tracks_v,
                        "audio_tracks": tl_tracks_a,
                    }
                    logger.info(
                        "Current timeline: %r  video_tracks=%d  audio_tracks=%d",
                        tl_name, tl_tracks_v, tl_tracks_a,
                    )
            except Exception as exc:
                logger.warning("timeline introspection failed: %s", exc)

            # Render presets — critical for Level 2 (we need to know
            # which preset names are available for trigger_render).
            try:
                presets = project.GetRenderPresetList()
                info["render_presets"] = list(presets) if presets else []
                logger.info(
                    "Render presets: %d available",
                    len(info["render_presets"]),
                )
                for p in info["render_presets"][:10]:
                    logger.info("  - %s", p)
                if len(info["render_presets"]) > 10:
                    logger.info(
                        "  …and %d more", len(info["render_presets"]) - 10,
                    )
            except Exception as exc:
                logger.warning("GetRenderPresetList failed: %s", exc)

            # Media pool root — verifies we can navigate the Media Pool
            try:
                mp = project.GetMediaPool()
                root = mp.GetRootFolder() if mp else None
                if root:
                    info["media_pool_root_name"] = root.GetName()
                    children = root.GetClipList() or []
                    info["media_pool_root_clips"] = len(children)
                    logger.info(
                        "Media Pool root folder: %r  clips_at_root=%d",
                        info["media_pool_root_name"],
                        info["media_pool_root_clips"],
                    )
            except Exception as exc:
                logger.warning("MediaPool introspection failed: %s", exc)
        else:
            info["current_project_name"] = None
            logger.info("No project currently open in Resolve.")
    except Exception as exc:
        logger.warning("GetCurrentProject failed: %s", exc)
        info["current_project_error"] = str(exc)

    return info


def smoke_test(logger: logging.Logger, resolve) -> dict:
    """Optional: create + introspect + close a test project. Never
    saves. Designed to exercise the create/load/teardown surface we'll
    need for Level 2."""
    result: dict = {}
    pm = resolve.GetProjectManager()
    if not pm:
        result["error"] = "no project manager"
        return result

    test_name = f"CharacterOS-Probe-{datetime.now().strftime('%H%M%S')}"
    logger.info("smoke-test creating project %r …", test_name)
    project = pm.CreateProject(test_name)
    if not project:
        result["create_failed"] = True
        logger.error("CreateProject returned None — may collide with existing name")
        return result
    result["created_name"] = project.GetName()
    result["created_timeline_count"] = project.GetTimelineCount()
    logger.info("created project %r (timelines=%d)",
                result["created_name"], result["created_timeline_count"])

    # Close without saving — we don't want to pollute the operator's
    # project list. CloseProject takes a project handle in Resolve 18+.
    try:
        closed = pm.CloseProject(project)
        result["closed"] = bool(closed)
        logger.info("CloseProject(test) returned: %s", closed)
    except Exception as exc:
        logger.warning("CloseProject failed: %s", exc)
        result["close_error"] = str(exc)

    # Best-effort delete from project list so we don't leave clutter.
    try:
        deleted = pm.DeleteProject(test_name)
        result["deleted"] = bool(deleted)
        logger.info("DeleteProject(test) returned: %s", deleted)
    except Exception as exc:
        logger.warning("DeleteProject failed: %s", exc)
        result["delete_error"] = str(exc)

    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--api-base",
        help="override RESOLVE_SCRIPT_API path (defaults to macOS standard)",
    )
    parser.add_argument(
        "--smoke-test",
        action="store_true",
        help="also create + close a test project (never saved)",
    )
    args = parser.parse_args()

    logger = setup_logging()
    logger.info("==== probe-resolve-api ====")
    logger.info("log path: %s", LOG_PATH)

    configure_env(logger, args.api_base)
    dvr = import_scripting_module(logger)
    resolve = connect(logger, dvr)

    t0 = time.time()
    info = introspect(logger, resolve)
    introspect_elapsed = time.time() - t0
    logger.info("introspection elapsed: %.2fs", introspect_elapsed)

    smoke_result = None
    if args.smoke_test:
        logger.info("---- smoke test ----")
        smoke_result = smoke_test(logger, resolve)

    print("")
    print("==== PROBE PASSED ====")
    print(f"Resolve version:        {info.get('version_string', 'unknown')}")
    print(f"Project manager:        {'OK' if info.get('project_manager_ok') else 'FAILED'}")
    if info.get("current_project_name"):
        print(f"Current project:        {info['current_project_name']!r}")
        print(f"Timeline count:         {info.get('timeline_count', '?')}")
        if info.get("current_timeline"):
            tl = info["current_timeline"]
            print(f"Active timeline:        {tl['name']!r}")
            print(f"  Video tracks:         {tl['video_tracks']}")
            print(f"  Audio tracks:         {tl['audio_tracks']}")
        n_presets = len(info.get("render_presets", []))
        print(f"Render presets:         {n_presets} available")
        if info.get("media_pool_root_name") is not None:
            print(f"Media pool root:        {info['media_pool_root_name']!r}")
            print(f"  Clips at root:        {info.get('media_pool_root_clips', '?')}")
    else:
        print("Current project:        (no project open)")
    print(f"Introspection elapsed:  {introspect_elapsed:.2f}s")
    print(f"Log:                    {LOG_PATH}")

    if smoke_result is not None:
        print("")
        print("==== SMOKE TEST RESULT ====")
        for k, v in smoke_result.items():
            print(f"  {k}: {v}")

    print("")
    print("Next: pick a render preset name from the list above for the")
    print("Level 2 backend client. We'll target that preset for output.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
