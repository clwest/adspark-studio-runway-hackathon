#!/usr/bin/env python3
"""Burn all 5 talking-head beats for the Character OS submission video.

Three solo Spokesperson Ads + two Dialogue Scenes in one orchestrated
run. Solo beats fire in parallel; dialogue beats run sequentially
(plan → set lines → render lines in parallel → stitch).

Final winners (locked after fact-check audit, 2026-05-11):
  Beat 2 — Donny opener      → solo, on Donny's campaign 0a52aef38809
  Beat 3 — Miles problem     → solo, on Miles's campaign 9d4e15683704
  Beat 4 — Trio dialogue     → dialogue on Riggs's campaign 09e09a0b3129
  Beat 6 — Riggs local LLM   → solo, on Riggs's campaign 09e09a0b3129
  Beat 8 — Closer dialogue   → dialogue on Donny's campaign d00dc42fe5cb

Beat 6's winning variant was 308 chars (over the 300 cap). Trimmed
inline to ≤280 chars while preserving voice + technical accuracy.

Beat 8's winning variant had a layer-conflation in Riggs's line
(Llama doesn't write video, DaVinci doesn't write scripts). Replaced
inline with a fact-clean rewrite that preserves the punchline cadence.

Safety:
  - Dry-run by default. `--yes-fire` actually burns credits.
  - Per-beat try/except — one failure doesn't abort the rest.
  - Final manifest written regardless of partial success.
  - Estimated burn ~1500-2000 credits total.

Usage:
  python scripts/burn-submission-video-beats.py            # dry-run
  python scripts/burn-submission-video-beats.py --yes-fire # real
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = (
    REPO_ROOT / "backend" / "data" / "submission_video" / "manifest-beats.json"
)
LOG_PATH = Path(tempfile.gettempdir()) / (
    f"burn-beats-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
)


# Character IDs from characters.json on Chris's machine.
DONNY = "1527fded7c81"
RIGGS = "ffc0dc094a92"
MILES = "1f48f8c5fab2"


# ---- final locked scripts (post-audit) -----------------------------

BEAT_2_DONNY = (
    "Hey, you're watching a hackathon submission video - and let me "
    "be clear, what you're seeing was BUILT by the very AI-powered "
    "character assistant we're introducing today."
)

BEAT_3_MILES = (
    "When we crave AI in our marketing, what do we get instead? "
    "One-off renders, fleeting ideas, and a brand identity that's "
    "as ephemeral as a sparkler. How can we expect to build meaningful "
    "connections when our AI presence is as disposable as last "
    "night's viral tweet?"
)

# Beat 6 v1 trimmed from 308 → 275 chars. Original was over the 300
# avatar_videos cap. Keeps the "8B parameters", "base URL pivot", and
# "Runway leaving the laptop" beats intact.
BEAT_6_RIGGS = (
    "No fancy OpenAI key needed. The model writing our scripts is "
    "Llama 3, 8 billion parameters, running right here on this "
    "laptop. Ollama serves it; we just pointed the OpenAI client at "
    "a different base URL. No cloud bill for the creative loop. "
    "Runway leaves the laptop."
)

# Beat 4 v1 verbatim (all 5 lines were factually clean).
BEAT_4_LINES = [
    {
        "speaker": DONNY,
        "text": "Meet Character OS, your persistent AI spokesperson.",
    },
    {
        "speaker": RIGGS,
        "text": (
            "We kept multiple coding sessions aligned using a context "
            "kit – massive timesaver for hackathons and actual builds."
        ),
    },
    {
        "speaker": MILES,
        "text": (
            "And with reusable workspaces, you're not limited to "
            "one-off briefs; campaigns fuel long-term growth."
        ),
    },
    {
        "speaker": DONNY,
        "text": (
            "One identity, many surfaces – the same character drives "
            "ads, long-form content, dialogue scenes, and live "
            "real-time conversations."
        ),
    },
    {
        "speaker": RIGGS,
        "text": (
            "Treat it like a real spokesperson, and you can direct it "
            "like one too – seamless integration with your workflow."
        ),
    },
]

# Beat 8 v1 with Riggs's first line manually rewritten to remove the
# layer-conflation (original conflated Llama=video / DaVinci=video).
BEAT_8_LINES = [
    {
        "speaker": DONNY,
        "text": (
            "This submission video was made by the AI itself – a "
            "meta loop that lets it pitch its own value."
        ),
    },
    {
        "speaker": RIGGS,
        "text": (
            "Llama writes the scripts on this laptop. DaVinci polishes "
            "the cuts on this laptop. Runway is the only piece that "
            "leaves the machine — and it only does what nobody else can."
        ),
    },
    {
        "speaker": DONNY,
        "text": (
            "We didn't build an AI ad tool; we built infrastructure "
            "for AI brand identity that survives across campaigns – "
            "not just a single execution."
        ),
    },
    {
        "speaker": RIGGS,
        "text": (
            "Every spokesperson can write its own scripts, render its "
            "own videos, and TALK BACK live over WebRTC – all in one "
            "Character OS environment."
        ),
    },
    {
        "speaker": DONNY,
        "text": (
            "Name the prize – Character OS, built on Runway – where "
            "AI meets human connection, and brand identities come "
            "to life."
        ),
    },
]


# ---- beat → campaign mapping ---------------------------------------

SOLO_BEATS = [
    {
        "id": 2,
        "slug": "donny-opener",
        "campaign_id": "0a52aef38809",
        "script": BEAT_2_DONNY,
    },
    {
        "id": 3,
        "slug": "miles-problem",
        "campaign_id": "9d4e15683704",
        "script": BEAT_3_MILES,
    },
    {
        "id": 6,
        "slug": "riggs-local-llm",
        "campaign_id": "09e09a0b3129",
        "script": BEAT_6_RIGGS,
    },
]

DIALOGUE_BEATS = [
    {
        "id": 4,
        "slug": "what-we-built-trio",
        "campaign_id": "09e09a0b3129",  # Riggs's "How We Built Character OS"
        "lines": BEAT_4_LINES,
    },
    {
        "id": 8,
        "slug": "why-we-win-closer",
        "campaign_id": "d00dc42fe5cb",  # Donny's "Character OS"
        "lines": BEAT_8_LINES,
    },
]


# ---- HTTP helpers --------------------------------------------------

def api_base() -> str:
    return os.environ.get("API_BASE", "http://localhost:8000")


def fire_solo_beat(beat: dict, timeout: float = 360.0) -> dict:
    """POST /spokesperson-ad with script_override. Returns the
    output id + path on success."""
    started = time.time()
    cid = beat["campaign_id"]
    try:
        url = f"{api_base()}/api/campaigns/{cid}/spokesperson-ad"
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                url, json={"script_override": beat["script"]},
            )
        if resp.status_code != 200:
            return {
                "beat": beat,
                "status": "failed",
                "error": f"rc={resp.status_code}: {resp.text[:200]}",
                "elapsed": time.time() - started,
            }
        campaign = resp.json()
        # Newest spokesperson_ad output is at the front of campaign.outputs
        outputs = campaign.get("outputs") or []
        newest = next(
            (o for o in outputs if o.get("kind") == "spokesperson_ad"),
            None,
        )
        return {
            "beat": beat,
            "status": "ok",
            "output_id": newest.get("id") if newest else None,
            "output_url": newest.get("video_url") if newest else None,
            "elapsed": time.time() - started,
        }
    except Exception as exc:
        return {
            "beat": beat,
            "status": "failed",
            "error": str(exc)[:300],
            "elapsed": time.time() - started,
        }


def fire_dialogue_beat(beat: dict, timeout: float = 600.0) -> dict:
    """End-to-end dialogue render: plan → set lines → render lines in
    parallel → stitch. Returns per-line render outcomes + final stitch
    output id."""
    started = time.time()
    cid = beat["campaign_id"]
    base = api_base()
    diagnostics: dict = {"beat": beat, "stages": {}}
    try:
        # 1. Plan
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                f"{base}/api/campaigns/{cid}/dialogue/plan",
                json={"mode": "reset"},
            )
        if resp.status_code != 200:
            return {
                **diagnostics,
                "status": "failed",
                "error": f"plan rc={resp.status_code}: {resp.text[:200]}",
                "elapsed": time.time() - started,
            }
        campaign = resp.json()
        planned_lines = campaign.get("dialogue_lines") or []
        diagnostics["stages"]["plan"] = {
            "planned_count": len(planned_lines),
        }

        # 2. Set per-line text + speaker on the first N planned lines.
        # If the planner created more lines than we have content for,
        # we leave the extras alone (they stay 'idle' and won't render).
        wanted = beat["lines"]
        if len(planned_lines) < len(wanted):
            return {
                **diagnostics,
                "status": "failed",
                "error": (
                    f"planner created {len(planned_lines)} lines but "
                    f"beat needs {len(wanted)}"
                ),
                "elapsed": time.time() - started,
            }

        with httpx.Client(timeout=30.0) as client:
            for idx, wanted_line in enumerate(wanted):
                line_id = planned_lines[idx]["id"]
                resp = client.post(
                    f"{base}/api/campaigns/{cid}/dialogue/line/{line_id}",
                    json={
                        "text": wanted_line["text"],
                        "character_id": wanted_line["speaker"],
                    },
                )
                if resp.status_code != 200:
                    return {
                        **diagnostics,
                        "status": "failed",
                        "error": (
                            f"set line {idx+1} rc={resp.status_code}: "
                            f"{resp.text[:200]}"
                        ),
                        "elapsed": time.time() - started,
                    }
        diagnostics["stages"]["set_lines"] = {"set_count": len(wanted)}

        # 3. Render each line in parallel. Each line is one
        # avatar_videos call against the line's speaker's avatar.
        line_ids = [planned_lines[i]["id"] for i in range(len(wanted))]
        render_results: list[dict] = []

        def render_one(line_id: str, idx: int) -> dict:
            t = time.time()
            try:
                with httpx.Client(timeout=timeout) as client:
                    r = client.post(
                        f"{base}/api/campaigns/{cid}/dialogue/generate-line/{line_id}",
                    )
                if r.status_code != 200:
                    return {
                        "line_id": line_id,
                        "idx": idx,
                        "status": "failed",
                        "error": f"rc={r.status_code}: {r.text[:200]}",
                        "elapsed": time.time() - t,
                    }
                return {
                    "line_id": line_id,
                    "idx": idx,
                    "status": "ok",
                    "elapsed": time.time() - t,
                }
            except Exception as exc:
                return {
                    "line_id": line_id,
                    "idx": idx,
                    "status": "failed",
                    "error": str(exc)[:200],
                    "elapsed": time.time() - t,
                }

        with ThreadPoolExecutor(max_workers=len(line_ids)) as pool:
            futures = {
                pool.submit(render_one, lid, idx): (lid, idx)
                for idx, lid in enumerate(line_ids)
            }
            for fut in as_completed(futures):
                render_results.append(fut.result())
        diagnostics["stages"]["render_lines"] = render_results
        failed = [r for r in render_results if r["status"] != "ok"]
        if failed:
            return {
                **diagnostics,
                "status": "failed",
                "error": (
                    f"{len(failed)}/{len(render_results)} lines failed; "
                    "see stages.render_lines"
                ),
                "elapsed": time.time() - started,
            }

        # 4. Stitch
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(
                f"{base}/api/campaigns/{cid}/dialogue/stitch",
            )
        if resp.status_code != 200:
            return {
                **diagnostics,
                "status": "failed",
                "error": f"stitch rc={resp.status_code}: {resp.text[:200]}",
                "elapsed": time.time() - started,
            }
        campaign = resp.json()
        outputs = campaign.get("outputs") or []
        newest_scene = next(
            (o for o in outputs if o.get("kind") == "dialogue_scene"),
            None,
        )
        diagnostics["stages"]["stitch"] = {
            "output_id": newest_scene.get("id") if newest_scene else None,
            "video_url": newest_scene.get("video_url") if newest_scene else None,
        }
        return {
            **diagnostics,
            "status": "ok",
            "output_id": newest_scene.get("id") if newest_scene else None,
            "output_url": newest_scene.get("video_url") if newest_scene else None,
            "elapsed": time.time() - started,
        }
    except Exception as exc:
        return {
            **diagnostics,
            "status": "failed",
            "error": str(exc)[:300],
            "elapsed": time.time() - started,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes-fire", action="store_true")
    parser.add_argument(
        "--solo-only",
        action="store_true",
        help="render only the 3 solo Spokesperson Ads, skip dialogues",
    )
    parser.add_argument(
        "--dialogue-only",
        action="store_true",
        help="render only the 2 dialogue scenes, skip solos",
    )
    args = parser.parse_args()

    print("==== burn-submission-video-beats ====")
    print(f"log path:     {LOG_PATH}")
    print(f"manifest:     {MANIFEST_PATH}")
    print(f"api base:     {api_base()}")
    print()

    print("SOLO BEATS:")
    for b in SOLO_BEATS:
        print(
            f"  [{b['id']}] {b['slug']:<20} "
            f"campaign={b['campaign_id']}  chars={len(b['script'])}"
        )
    print()
    print("DIALOGUE BEATS:")
    for b in DIALOGUE_BEATS:
        print(
            f"  [{b['id']}] {b['slug']:<20} "
            f"campaign={b['campaign_id']}  lines={len(b['lines'])}"
        )
        for i, line in enumerate(b["lines"], 1):
            preview = line["text"][:55] + ("…" if len(line["text"]) > 55 else "")
            speaker_name = {DONNY: "Donny", RIGGS: "Riggs", MILES: "Miles"}.get(
                line["speaker"], line["speaker"][:8],
            )
            print(f"      {i}. {speaker_name:<6}: {preview}")
    print()

    if not args.yes_fire:
        print("DRY RUN — no renders fired.")
        print("Re-run with --yes-fire to burn ~1500-2000 credits.")
        return 0

    MANIFEST_PATH.parent.mkdir(parents=True, exist_ok=True)

    t_total = time.time()
    solo_results: list[dict] = []
    dialogue_results: list[dict] = []

    # Solo beats in parallel.
    if not args.dialogue_only:
        print(f"firing {len(SOLO_BEATS)} solo Spokesperson Ads in parallel…")
        with ThreadPoolExecutor(max_workers=len(SOLO_BEATS)) as pool:
            futures = {pool.submit(fire_solo_beat, b): b for b in SOLO_BEATS}
            for fut in as_completed(futures):
                res = fut.result()
                solo_results.append(res)
                b = res["beat"]
                if res["status"] == "ok":
                    print(
                        f"  ✅ [{b['id']}] {b['slug']:<20} "
                        f"{res['elapsed']:5.1f}s  output={res.get('output_id')}"
                    )
                else:
                    print(
                        f"  ❌ [{b['id']}] {b['slug']:<20} "
                        f"{res['elapsed']:5.1f}s  ERR: {(res.get('error') or '?')[:90]}"
                    )
        print()

    # Dialogue beats sequentially (each has its own internal parallel
    # render of lines).
    if not args.solo_only:
        for b in DIALOGUE_BEATS:
            print(f"firing dialogue beat [{b['id']}] {b['slug']}…")
            res = fire_dialogue_beat(b)
            dialogue_results.append(res)
            if res["status"] == "ok":
                print(
                    f"  ✅ [{b['id']}] {b['slug']:<20} "
                    f"{res['elapsed']:5.1f}s  output={res.get('output_id')}"
                )
            else:
                print(
                    f"  ❌ [{b['id']}] {b['slug']:<20} "
                    f"{res['elapsed']:5.1f}s  ERR: {(res.get('error') or '?')[:90]}"
                )
            print()

    total = time.time() - t_total
    all_results = solo_results + dialogue_results
    ok = [r for r in all_results if r["status"] == "ok"]
    fail = [r for r in all_results if r["status"] != "ok"]

    print(f"==== DONE ({total:.1f}s total) ====")
    print(f"  succeeded: {len(ok)}/{len(all_results)}")
    if fail:
        print(f"  failed:    {len(fail)} — see manifest for stage detail")

    manifest = {
        "timestamp": datetime.now().isoformat(),
        "total_elapsed": total,
        "solo_results": [_serialise(r) for r in solo_results],
        "dialogue_results": [_serialise(r) for r in dialogue_results],
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, indent=2, default=str))
    print(f"  manifest:  {MANIFEST_PATH}")
    return 0 if not fail else 1


def _serialise(result: dict) -> dict:
    """Strip non-JSON-serialisable bits from a result dict so the
    manifest writes cleanly."""
    out = dict(result)
    if "beat" in out:
        out["beat"] = {
            k: v for k, v in out["beat"].items()
            if k != "lines"  # lines already captured in stages
        }
    return out


if __name__ == "__main__":
    sys.exit(main())
