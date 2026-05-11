#!/usr/bin/env python3
"""Burn 10 cinematic b-roll shots in parallel for the submission video.

Fires all 10 `POST /v1/text_to_video` (gen4.5, 5s, 1280×720) tasks
concurrently against Runway, polls each, downloads the resulting
MP4s into ``backend/data/submission_video/broll/{NN}-{slug}.mp4``.

Designed for the 2026-05-11 Runway API Hackathon submission push —
operator has ~45K credits expiring the next day, this burns ~1500
of them for cinematic b-roll cuts that DaVinci stitches between
talking-head segments.

Safety:
  - Dry-run by default. ``--yes-fire`` required to actually POST.
  - Refuses to fire without RUNWAY_API_KEY in env.
  - Each shot has an independent failure path — one bad render
    doesn't abort the batch. Final report lists per-shot outcome.

Usage:
  # Dry-run, prints what would be sent + estimated burn:
  python scripts/burn-broll-for-submission-video.py

  # Real fire:
  python scripts/burn-broll-for-submission-video.py --yes-fire
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "backend" / "data" / "submission_video" / "broll"
LOG_PATH = Path(tempfile.gettempdir()) / (
    f"burn-broll-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
)


@dataclass
class Shot:
    idx: int
    slug: str
    section: str
    prompt: str


SHOTS: list[Shot] = [
    Shot(
        1, "intro-spotlight", "Cinematic intro (00:00)",
        "Slow cinematic push-in on a dark studio space, single warm "
        "spotlight illuminating dust motes, abstract neural network "
        "pattern fading in. Moody film grain, score-swell pacing.",
    ),
    Shot(
        2, "old-ai-montage", "Old AI ads (problem)",
        "Fast-cut montage of generic AI-generated stock content "
        "scrolling on phone screens, low quality, repetitive, "
        "multiple identical faces, glitchy compression artifacts, "
        "sense of disposable throwaway content.",
    ),
    Shot(
        3, "frustrated-marketer", "Old AI ads (problem)",
        "Close-up of a frustrated marketer scrolling through a feed "
        "of identical-looking AI ad outputs, dim office lighting, "
        "screens flickering, sense of fatigue and homogeneity, "
        "cinematic shallow depth of field.",
    ),
    Shot(
        4, "late-night-founder", "Founder late-night (problem→solution)",
        "Indie founder hunched over a glowing laptop in a dark "
        "apartment at 2am, single desk lamp, multiple monitors, "
        "coffee cup, focused energy, cinematic film grain, shallow "
        "depth of field.",
    ),
    Shot(
        5, "developer-flow-state", "Founder late-night",
        "Over-the-shoulder shot of a developer at a desk writing "
        "code, terminal window glowing on screen, dim ambient "
        "lighting, sense of late-night flow state, slow zoom toward "
        "the screen.",
    ),
    Shot(
        6, "terminal-closeup", "Local LLM story",
        "Extreme close-up of a Mac terminal with green monospace text "
        "scrolling rapidly, subtle bloom, dramatic shallow depth of "
        "field, cinematic, dark moody lighting.",
    ),
    Shot(
        7, "llama-silhouette", "Local LLM story",
        "Cinematic shot of a stylized llama silhouette against a "
        "starry night sky, soft glow from a laptop screen below, "
        "surreal calming energy, brand-friendly abstraction, "
        "minimalist composition.",
    ),
    Shot(
        8, "persistent-identity", "Persistent identity",
        "Cinematic shot of a single character portrait morphing "
        "through multiple wardrobe and lighting variations while the "
        "face remains constant, warm color grade, slow camera "
        "push-in, brand-persistence energy.",
    ),
    Shot(
        9, "color-grading-craft", "DaVinci integration",
        "Close-up of color wheels spinning on a professional "
        "color-grading interface, soft monitor glow, hands gently "
        "turning the wheels, premium-production energy, cinematic.",
    ),
    Shot(
        10, "sunrise-workspace", "Cinematic outro (04:30)",
        "Wide aerial of a lone illuminated workspace at sunrise, "
        "gentle camera lift, golden hour rays cutting through window "
        "blinds, soft particle haze. Cinematic, contemplative, "
        "brand-end energy.",
    ),
]


MODEL = "gen4.5"
RATIO = "1280:720"
DURATION = 5


def runway_headers(api_key: str, api_version: str) -> dict:
    return {
        "Authorization": f"Bearer {api_key}",
        "X-Runway-Version": api_version,
        "Content-Type": "application/json",
    }


def fire_one_shot(
    shot: Shot,
    api_base: str,
    api_key: str,
    api_version: str,
    output_dir: Path,
    timeout: float = 240.0,
) -> dict:
    """POST + poll + download a single b-roll shot. Returns a dict
    with status + paths + diagnostics. Never raises — failures
    surface as `status='failed'` with the error message so the
    batch caller can report per-shot outcomes."""
    started = time.time()
    try:
        body = {
            "model": MODEL,
            "promptText": shot.prompt,
            "ratio": RATIO,
            "duration": DURATION,
        }
        create_url = f"{api_base}/v1/text_to_video"
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(
                create_url,
                headers=runway_headers(api_key, api_version),
                json=body,
            )
            if resp.status_code != 200:
                return {
                    "shot": shot,
                    "status": "failed",
                    "error": f"create rc={resp.status_code}: {resp.text[:200]}",
                    "elapsed": time.time() - started,
                }
            task_id = resp.json().get("id")
            if not task_id:
                return {
                    "shot": shot,
                    "status": "failed",
                    "error": "no task id in create response",
                    "elapsed": time.time() - started,
                }

        # Poll
        poll_url = f"{api_base}/v1/tasks/{task_id}"
        deadline = time.time() + timeout
        output_url = None
        last_status = "UNKNOWN"
        with httpx.Client(timeout=20.0) as client:
            while time.time() < deadline:
                r = client.get(
                    poll_url, headers=runway_headers(api_key, api_version),
                )
                r.raise_for_status()
                payload = r.json()
                last_status = (payload.get("status") or "").upper()
                if last_status == "SUCCEEDED":
                    output = payload.get("output")
                    if isinstance(output, list):
                        for v in output:
                            if isinstance(v, str) and v.startswith("http"):
                                output_url = v
                                break
                    break
                if last_status in {"FAILED", "CANCELED"}:
                    reason = (
                        payload.get("failure")
                        or payload.get("failureCode")
                        or "FAILED"
                    )
                    return {
                        "shot": shot,
                        "status": "failed",
                        "task_id": task_id,
                        "error": f"task {last_status}: {reason}",
                        "elapsed": time.time() - started,
                    }
                time.sleep(3)
        if not output_url:
            return {
                "shot": shot,
                "status": "failed",
                "task_id": task_id,
                "error": f"timeout after {timeout}s (last_status={last_status})",
                "elapsed": time.time() - started,
            }

        # Download
        target = output_dir / f"{shot.idx:02d}-{shot.slug}.mp4"
        target.parent.mkdir(parents=True, exist_ok=True)
        size = 0
        with httpx.stream(
            "GET", output_url, timeout=120.0, follow_redirects=True,
        ) as resp:
            resp.raise_for_status()
            with open(target, "wb") as fh:
                for chunk in resp.iter_bytes():
                    size += len(chunk)
                    fh.write(chunk)

        return {
            "shot": shot,
            "status": "ok",
            "task_id": task_id,
            "output_path": str(target),
            "size_bytes": size,
            "elapsed": time.time() - started,
        }
    except Exception as exc:
        return {
            "shot": shot,
            "status": "failed",
            "error": f"unexpected: {exc!s}"[:300],
            "elapsed": time.time() - started,
        }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--yes-fire",
        action="store_true",
        help="REQUIRED to actually fire. Without it, dry-run only.",
    )
    parser.add_argument(
        "--api-base",
        default=os.environ.get("RUNWAY_API_BASE", "https://api.dev.runwayml.com"),
    )
    parser.add_argument(
        "--api-version",
        default=os.environ.get("RUNWAY_API_VERSION", "2024-11-06"),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=10,
        help="parallel render workers (default: all 10 at once)",
    )
    args = parser.parse_args()

    print(f"==== burn-broll-for-submission-video ====")
    print(f"log path: {LOG_PATH}")
    print(f"output dir: {OUTPUT_DIR}")
    print(f"model: {MODEL}  ratio: {RATIO}  duration: {DURATION}s")
    print(f"shots: {len(SHOTS)}")
    print()
    for s in SHOTS:
        print(f"  [{s.idx:02d}] {s.slug:<24}  ({s.section})")
        print(f"       {s.prompt[:90]}{'…' if len(s.prompt) > 90 else ''}")
    print()

    if not args.yes_fire:
        print("DRY RUN — no Runway calls fired.")
        print("Re-run with --yes-fire to actually burn ~1500-2000 credits.")
        return 0

    api_key = os.environ.get("RUNWAY_API_KEY")
    if not api_key:
        raise SystemExit("RUNWAY_API_KEY missing. Source .env first.")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    print(f"firing {len(SHOTS)} parallel renders ({args.workers} workers)…")
    print(f"each ~30-90s; parallel batch finishes when slowest does.")
    print()

    t0 = time.time()
    results: list[dict] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {
            pool.submit(
                fire_one_shot,
                shot,
                args.api_base,
                api_key,
                args.api_version,
                OUTPUT_DIR,
            ): shot
            for shot in SHOTS
        }
        for fut in as_completed(futures):
            res = fut.result()
            results.append(res)
            shot = res["shot"]
            elapsed = res.get("elapsed", 0.0)
            if res["status"] == "ok":
                size_mb = (res.get("size_bytes", 0) or 0) / (1024 * 1024)
                print(
                    f"  ✅ [{shot.idx:02d}] {shot.slug:<24} "
                    f"{elapsed:5.1f}s  {size_mb:4.1f}MB"
                )
            else:
                print(
                    f"  ❌ [{shot.idx:02d}] {shot.slug:<24} "
                    f"{elapsed:5.1f}s  ERR: {res.get('error', '?')[:80]}"
                )

    total_elapsed = time.time() - t0
    ok = [r for r in results if r["status"] == "ok"]
    fail = [r for r in results if r["status"] != "ok"]

    print()
    print(f"==== DONE ({total_elapsed:.1f}s total) ====")
    print(f"  succeeded: {len(ok)}/{len(SHOTS)}")
    print(f"  failed:    {len(fail)}")
    if ok:
        total_size = sum((r.get("size_bytes") or 0) for r in ok) / (1024 * 1024)
        print(f"  total disk: {total_size:.1f} MB in {OUTPUT_DIR}")
    if fail:
        print()
        print("FAILED SHOTS (re-run individually or tweak prompts):")
        for r in sorted(fail, key=lambda x: x["shot"].idx):
            s = r["shot"]
            print(f"  [{s.idx:02d}] {s.slug}: {r.get('error')}")

    # Write a manifest the DaVinci import + frontend submission video
    # builder can consume later.
    manifest = OUTPUT_DIR / "manifest.json"
    manifest.write_text(json.dumps([
        {
            "idx": r["shot"].idx,
            "slug": r["shot"].slug,
            "section": r["shot"].section,
            "prompt": r["shot"].prompt,
            "status": r["status"],
            "output_path": r.get("output_path"),
            "task_id": r.get("task_id"),
            "error": r.get("error"),
            "elapsed": r.get("elapsed"),
        }
        for r in sorted(results, key=lambda x: x["shot"].idx)
    ], indent=2))
    print(f"  manifest:  {manifest}")
    return 0 if not fail else 1


if __name__ == "__main__":
    sys.exit(main())
