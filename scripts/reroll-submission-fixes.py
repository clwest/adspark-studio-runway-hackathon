#!/usr/bin/env python3
"""Re-roll the three lines that needed fact-fixes after operator
review:

  Beat 6 (Riggs solo) — "on this laptop" + "leaves the laptop"
      repetition. Rewrite with varied phrasing.

  Beat 8 line 2 (Riggs) — "on this laptop" appearing twice in one
      line. Rewrite to use "locally" / "in post" instead.

  Beat 8 line 6 (Riggs) — "in one night" was inaccurate; the build
      ran across a hackathon weekend, not a single night.

Re-renders just the three affected outputs. Other beats stay intact.
"""
from __future__ import annotations

import sys
import time

import httpx

API_BASE = "http://localhost:8000"

# Same campaign IDs the original burn used.
BEAT_6_CAMPAIGN = "09e09a0b3129"
BEAT_8_CAMPAIGN = "d00dc42fe5cb"

NEW_BEAT_6 = (
    "No fancy OpenAI key needed. The model writing our scripts is "
    "Llama 3, 8 billion parameters, running locally. Ollama serves "
    "it; we just pointed the OpenAI client at a different base URL. "
    "No cloud bill for the creative loop. Runway is the only thing "
    "that hits the network."
)

# Beat 8 line 2 — index 1 in the dialogue_lines array.
NEW_BEAT_8_LINE_2 = (
    "Llama writes the scripts locally. DaVinci polishes the cuts in "
    "post. Runway is the only piece that hits the network — and it "
    "only does what nobody else can do."
)

# Beat 8 line 6 — index 5. "in one night" → "in one hackathon weekend".
NEW_BEAT_8_LINE_6 = (
    "Built by one founder and an AI coding agent — together, in one "
    "hackathon weekend."
)


def set_dialogue_line(cid: str, line_id: str, text: str) -> None:
    with httpx.Client(timeout=30.0) as client:
        r = client.post(
            f"{API_BASE}/api/campaigns/{cid}/dialogue/line/{line_id}",
            json={"text": text},
        )
    if r.status_code != 200:
        raise RuntimeError(
            f"set line {line_id}: rc={r.status_code} {r.text[:200]}"
        )


def render_dialogue_line(cid: str, line_id: str) -> None:
    with httpx.Client(timeout=360.0) as client:
        r = client.post(
            f"{API_BASE}/api/campaigns/{cid}/dialogue/generate-line/{line_id}",
        )
    if r.status_code != 200:
        raise RuntimeError(
            f"render line {line_id}: rc={r.status_code} {r.text[:200]}"
        )


def stitch(cid: str) -> dict:
    with httpx.Client(timeout=600.0) as client:
        r = client.post(f"{API_BASE}/api/campaigns/{cid}/dialogue/stitch")
    if r.status_code != 200:
        raise RuntimeError(f"stitch: rc={r.status_code} {r.text[:200]}")
    return r.json()


def fire_spokesperson_ad(cid: str, script: str) -> dict:
    with httpx.Client(timeout=360.0) as client:
        r = client.post(
            f"{API_BASE}/api/campaigns/{cid}/spokesperson-ad",
            json={"script_override": script},
        )
    if r.status_code != 200:
        raise RuntimeError(
            f"spokesperson-ad: rc={r.status_code} {r.text[:200]}"
        )
    return r.json()


def find_output_id(campaign: dict, kind: str) -> str | None:
    for o in (campaign.get("outputs") or []):
        if o.get("kind") == kind:
            return o.get("id")
    return None


def main() -> int:
    # --- Beat 6 (solo) ---
    print(f"=== Beat 6 (Riggs solo) — campaign {BEAT_6_CAMPAIGN} ===")
    print(f"  → re-rendering with varied 'laptop'/'locally' phrasing…")
    t = time.time()
    camp = fire_spokesperson_ad(BEAT_6_CAMPAIGN, NEW_BEAT_6)
    output_id = find_output_id(camp, "spokesperson_ad")
    print(f"  ✅ done in {time.time() - t:.1f}s — new output {output_id}")
    print()

    # --- Beat 8 (dialogue) — set + render lines 2 + 6, then stitch ---
    print(f"=== Beat 8 (closer dialogue) — campaign {BEAT_8_CAMPAIGN} ===")
    # The dialogue line ids the planner used are "line-1" through
    # "line-6" (confirmed by the earlier finish-dialogue-beats run).
    targets = [
        ("line-2", NEW_BEAT_8_LINE_2, "Riggs 'locally / in post' rewrite"),
        ("line-6", NEW_BEAT_8_LINE_6, "Riggs 'hackathon weekend' fix"),
    ]
    for line_id, new_text, label in targets:
        print(f"  → {line_id}: {label}")
        set_dialogue_line(BEAT_8_CAMPAIGN, line_id, new_text)
        print(f"    setting text OK")
        t = time.time()
        render_dialogue_line(BEAT_8_CAMPAIGN, line_id)
        print(f"    render OK ({time.time() - t:.1f}s)")
    print(f"  → stitching scene…")
    t = time.time()
    result = stitch(BEAT_8_CAMPAIGN)
    output_id = find_output_id(result, "dialogue_scene")
    print(f"  ✅ stitched in {time.time() - t:.1f}s — new output {output_id}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
