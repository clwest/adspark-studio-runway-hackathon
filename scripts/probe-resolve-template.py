#!/usr/bin/env python3
"""Probe: introspect a specific Resolve template timeline so we know
what to pass to `resolve_client.render_via_template`.

Reports:
  - Timeline duration + total frame count
  - Every video track's clip list (name + start + duration)
  - Every Fusion title on any track (with its text nodes' current
    StyledText values, when readable)

Read-only. Doesn't modify the template.

Usage:
  python scripts/probe-resolve-template.py \
      --project "Runway Hackathon" \
      --timeline "character-os-template-v1"
"""
from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


# Match resolve_client.py env setup so the probe works whether or
# not the operator's shell has the vars set.
_DEFAULT_API = (
    "/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting"
)
_DEFAULT_LIB = (
    "/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so"
)
os.environ["RESOLVE_SCRIPT_API"] = os.environ.get("RESOLVE_SCRIPT_API") or _DEFAULT_API
os.environ["RESOLVE_SCRIPT_LIB"] = os.environ.get("RESOLVE_SCRIPT_LIB") or _DEFAULT_LIB
modules_path = str(Path(_DEFAULT_API) / "Modules")
if modules_path not in sys.path:
    sys.path.insert(0, modules_path)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--project", required=True)
    parser.add_argument("--timeline", required=True)
    args = parser.parse_args()

    import DaVinciResolveScript as dvr  # type: ignore

    resolve = dvr.scriptapp("Resolve")
    if not resolve:
        print("ERROR: Resolve not running.")
        return 1
    pm = resolve.GetProjectManager()
    current = pm.GetCurrentProject()
    if not current or current.GetName() != args.project:
        loaded = pm.LoadProject(args.project)
        if not loaded:
            print(f"ERROR: project {args.project!r} not found.")
            return 1
        current = loaded
    print(f"Project: {current.GetName()!r}")

    # Find the named timeline
    n = current.GetTimelineCount() or 0
    target = None
    for i in range(1, n + 1):
        tl = current.GetTimelineByIndex(i)
        if tl and tl.GetName() == args.timeline:
            target = tl
            break
    if not target:
        print(f"ERROR: timeline {args.timeline!r} not found. Available:")
        for i in range(1, n + 1):
            print(f"  - {current.GetTimelineByIndex(i).GetName()}")
        return 1

    print(f"Timeline: {target.GetName()!r}")
    print(f"  Start frame: {target.GetStartFrame()}")
    print(f"  End frame:   {target.GetEndFrame()}")
    print(f"  Video tracks: {target.GetTrackCount('video')}")
    print(f"  Audio tracks: {target.GetTrackCount('audio')}")
    print()

    # Iterate video tracks + report clips
    n_video = target.GetTrackCount("video") or 0
    for track_idx in range(1, n_video + 1):
        items = target.GetItemListInTrack("video", track_idx) or []
        print(f"V{track_idx}: {len(items)} item(s)")
        for j, item in enumerate(items, 1):
            name = item.GetName() or "?"
            start = item.GetStart()
            duration = item.GetDuration()
            pool_item = item.GetMediaPoolItem()
            pool_name = pool_item.GetName() if pool_item else "(no MediaPoolItem)"
            print(
                f"  [{j}] name={name!r}  pool={pool_name!r}  "
                f"start={start}  duration={duration}"
            )
            # If it's a Fusion composition, probe its text nodes
            fusion_count = item.GetFusionCompCount() or 0
            if fusion_count > 0:
                comp = item.GetFusionCompByIndex(1)
                if comp:
                    print(f"      Fusion comp present (looking for text nodes…)")
                    for guess in (
                        "Template", "Text", "Text1", "Text2",
                        "TextPlus", "Title", "Title1",
                    ):
                        node = comp.FindTool(guess)
                        if node is not None:
                            try:
                                text_val = node.GetInput("StyledText")
                            except Exception:
                                text_val = "(unreadable)"
                            print(
                                f"        text node {guess!r} -> "
                                f"StyledText={text_val!r}"
                            )
    print()
    print("Next: pin down the placeholder clip name + title node names")
    print("for the render_via_template() call.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
