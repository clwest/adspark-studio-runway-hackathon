#!/usr/bin/env python3
"""Finish what the first pass started: render line 6 + stitch each
dialogue scene for the submission video.

PR DL bumped the default dialogue line count from 3 to 6. The
submission beats (#4 + #8) were written as 5-line scenes — the
planner created a 6th line each that we never set or rendered.
The stitch endpoint refuses to run with idle lines. This script:

  1. Sets line 6 with a short on-brand closer + correct speaker
  2. Renders line 6 via /dialogue/generate-line/{line_id}
  3. Stitches the full 6-line scene

Idempotent: skips a line that's already 'ok' or beyond.
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parent.parent
CAMPAIGNS_JSON = REPO_ROOT / "backend" / "data" / "campaigns.json"


API_BASE = "http://localhost:8000"

DONNY = "1527fded7c81"
RIGGS = "ffc0dc094a92"
MILES = "1f48f8c5fab2"

PATCHES = [
    {
        "campaign_id": "09e09a0b3129",
        "line_index": 5,  # 0-indexed: the 6th line
        "text": "And we're just getting started — three personas, one platform.",
        "speaker": MILES,
    },
    {
        "campaign_id": "d00dc42fe5cb",
        "line_index": 5,
        "text": "Built by one man and an AI coding agent — together, in one night.",
        "speaker": RIGGS,
    },
]


def get_campaign(cid: str) -> dict:
    """Read directly from campaigns.json (the API doesn't expose a
    single-record GET). We don't need to mutate from this read —
    only need the line ids + statuses to decide what to do next.
    The actual mutations go through the API endpoints below."""
    records = json.loads(CAMPAIGNS_JSON.read_text())
    for r in records:
        if r.get("id") == cid:
            return r
    raise RuntimeError(f"campaign {cid} not found in campaigns.json")


def set_line(cid: str, line_id: str, text: str, speaker: str) -> None:
    with httpx.Client(timeout=30.0) as client:
        r = client.post(
            f"{API_BASE}/api/campaigns/{cid}/dialogue/line/{line_id}",
            json={"text": text, "character_id": speaker},
        )
    if r.status_code != 200:
        raise RuntimeError(f"set line {line_id} failed: rc={r.status_code} {r.text[:200]}")


def render_line(cid: str, line_id: str) -> None:
    with httpx.Client(timeout=360.0) as client:
        r = client.post(
            f"{API_BASE}/api/campaigns/{cid}/dialogue/generate-line/{line_id}",
        )
    if r.status_code != 200:
        raise RuntimeError(
            f"render line {line_id} failed: rc={r.status_code} {r.text[:200]}"
        )


def stitch(cid: str) -> dict:
    with httpx.Client(timeout=600.0) as client:
        r = client.post(f"{API_BASE}/api/campaigns/{cid}/dialogue/stitch")
    if r.status_code != 200:
        raise RuntimeError(f"stitch failed: rc={r.status_code} {r.text[:200]}")
    return r.json()


def main() -> int:
    for patch in PATCHES:
        cid = patch["campaign_id"]
        idx = patch["line_index"]
        print(f"\n=== {cid} ===")
        camp = get_campaign(cid)
        lines = camp.get("dialogue_lines") or []
        if idx >= len(lines):
            print(f"  ⚠️  campaign has {len(lines)} lines but we want line {idx+1}; skipping")
            continue
        line = lines[idx]
        line_id = line["id"]
        status = line.get("status")
        print(f"  L{idx+1} ({line_id}) current status: {status}")

        if status == "ok":
            print(f"  → line already rendered, skipping")
        else:
            print(f"  → setting text + speaker…")
            set_line(cid, line_id, patch["text"], patch["speaker"])
            print(f"  → rendering (will take ~30-45s)…")
            t = time.time()
            render_line(cid, line_id)
            print(f"  ✓ render ok ({time.time() - t:.1f}s)")

        print(f"  → stitching scene…")
        t = time.time()
        result = stitch(cid)
        outputs = result.get("outputs") or []
        newest = next(
            (o for o in outputs if o.get("kind") == "dialogue_scene"), None,
        )
        print(f"  ✅ stitched ({time.time() - t:.1f}s)")
        if newest:
            print(f"     output id: {newest.get('id')}")
            print(f"     video url: {newest.get('video_url')}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
