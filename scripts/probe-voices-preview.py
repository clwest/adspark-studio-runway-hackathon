#!/usr/bin/env python3
"""Probe: does POST /v1/voices/preview accept arbitrary text +
return TTS'd audio?

Follows the PR DY probe (speech.type=audio works at 42s with no
truncation). The remaining unknown is the TTS source for Long
Ad: can we use /v1/voices/preview to generate the audio in the
avatar's bound voice, or do we need a third-party TTS?

The docs reference `POST /v1/voices/preview` as "audition a
voice before committing" but don't pin the body shape. This
probe tries the three most plausible shapes in sequence and
stops on the first 2xx.

Body shapes attempted:

  Shape 1 — runway-live-preset (the "Riggs has voice_preset=max"
            shape, mirrors the avatar voice block):
    {"voice": {"type": "runway-live-preset", "presetId": "<id>"},
     "text": "..."}

  Shape 2 — custom voice id under PR DV-corrected discriminator:
    {"voice": {"type": "custom", "id": "<voice_id>"},
     "text": "..."}

  Shape 3 — bare voiceId flat field (simpler legacy shape):
    {"voiceId": "<voice_id>",
     "text": "..."}

  Shape 4 — `from` block mirroring `POST /v1/voices` text-design:
    {"from": {"type": "text", "prompt": "..."},
     "voiceId": "<voice_id>"}

Safety:
  - Dry-run by default. `--yes-fire` required to send.
  - Each shape attempt is a single POST. If all four 4xx
    with informative validation errors we'll know the
    contract from the error messages without spending
    multiple credit rounds.

Usage:
  # Dry-run:
  python scripts/probe-voices-preview.py

  # Real fire against Riggs's runway-live-preset "max":
  python scripts/probe-voices-preview.py \
      --preset-id max --yes-fire

  # Real fire with a known custom voice id:
  python scripts/probe-voices-preview.py \
      --custom-voice-id abc-123-xyz --yes-fire
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import subprocess
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parent.parent
LOG_PATH = Path(tempfile.gettempdir()) / (
    f"probe-voices-preview-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
)

# ~20s when TTS'd at typical 180 wpm. Shorter than the PR DY probe
# because preview audio is presumed to be sample-length not full
# script-length; we want to validate the path, not stress duration
# limits again.
DEFAULT_SCRIPT = (
    "Hey, I'm Riggs Rally. This is a probe of the voices preview "
    "endpoint to find out if we can use it as the text to speech "
    "source for the long ad rewrite. If you can hear this in my "
    "actual voice, the path is viable."
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


def ffprobe_duration_secs(path: Path) -> float:
    out = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(path),
        ],
        check=True,
        capture_output=True,
        text=True,
    )
    return float(out.stdout.strip() or 0.0)


def candidate_shapes(
    text: str,
    preset_id: str | None,
    custom_voice_id: str | None,
) -> list[tuple[str, dict]]:
    """Build the ordered list of shapes to attempt. Skips shapes
    that require an id we weren't given."""
    shapes: list[tuple[str, dict]] = []
    if preset_id:
        shapes.append((
            "preset-block",
            {
                "voice": {"type": "runway-live-preset", "presetId": preset_id},
                "text": text,
            },
        ))
    if custom_voice_id:
        shapes.append((
            "custom-block-pr-dv",
            {
                "voice": {"type": "custom", "id": custom_voice_id},
                "text": text,
            },
        ))
        shapes.append((
            "flat-voiceId",
            {"voiceId": custom_voice_id, "text": text},
        ))
        shapes.append((
            "from-text-design",
            {
                "from": {"type": "text", "prompt": text},
                "voiceId": custom_voice_id,
            },
        ))
    return shapes


def try_shape(
    api_base: str,
    api_key: str,
    api_version: str,
    name: str,
    body: dict,
    logger: logging.Logger,
) -> tuple[int, dict | str]:
    """POST a single shape. Returns (status_code, parsed_response_or_text)."""
    url = f"{api_base}/v1/voices/preview"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Runway-Version": api_version,
        "Content-Type": "application/json",
    }
    logger.info("---- shape=%s ----", name)
    logger.info("body: %s", json.dumps(body))
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        logger.warning("http error: %s", exc)
        return 0, f"http error: {exc!s}"
    rc = resp.status_code
    text = resp.text[:1200]
    logger.info("http=%s body=%s", rc, text)
    try:
        return rc, resp.json()
    except json.JSONDecodeError:
        return rc, text


def poll_task(
    api_base: str,
    api_key: str,
    api_version: str,
    task_id: str,
    logger: logging.Logger,
    deadline_secs: int = 120,
) -> dict:
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Runway-Version": api_version,
    }
    url = f"{api_base}/v1/tasks/{task_id}"
    deadline = time.time() + deadline_secs
    last_status = ""
    with httpx.Client(timeout=20.0) as client:
        while time.time() < deadline:
            r = client.get(url, headers=headers)
            r.raise_for_status()
            payload = r.json()
            status = (payload.get("status") or "").upper()
            if status != last_status:
                logger.info("task %s -> %s", task_id, status)
                last_status = status
            if status in {"SUCCEEDED", "FAILED", "CANCELED"}:
                return payload
            time.sleep(2)
    raise SystemExit(f"task {task_id} timed out after {deadline_secs}s")


def extract_audio_url(payload) -> str | None:
    """Find an audio URL in the response payload. Tries a handful of
    fields Runway has used historically. Returns None if no obvious
    audio reference."""
    if not isinstance(payload, dict):
        return None
    for key in ("previewUrl", "preview_url", "audioUrl", "audio_url", "url"):
        v = payload.get(key)
        if isinstance(v, str) and v.startswith("http"):
            return v
    output = payload.get("output")
    if isinstance(output, list):
        for v in output:
            if isinstance(v, str) and v.startswith("http"):
                return v
    if isinstance(output, str) and output.startswith("http"):
        return output
    return None


def download(url: str, target: Path, logger: logging.Logger) -> int:
    target.parent.mkdir(parents=True, exist_ok=True)
    size = 0
    with httpx.stream("GET", url, timeout=60.0, follow_redirects=True) as resp:
        resp.raise_for_status()
        with open(target, "wb") as fh:
            for chunk in resp.iter_bytes():
                size += len(chunk)
                fh.write(chunk)
    logger.info("downloaded %d bytes -> %s", size, target)
    return size


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--preset-id", help="runway-live-preset id, e.g. 'max'")
    parser.add_argument("--custom-voice-id", help="custom Runway voice id")
    parser.add_argument("--script", default=DEFAULT_SCRIPT)
    parser.add_argument("--yes-fire", action="store_true")
    parser.add_argument(
        "--api-base",
        default=os.environ.get("RUNWAY_API_BASE", "https://api.dev.runwayml.com"),
    )
    parser.add_argument(
        "--api-version",
        default=os.environ.get("RUNWAY_API_VERSION", "2024-11-06"),
    )
    args = parser.parse_args()

    logger = setup_logging()
    logger.info("==== probe-voices-preview ====")
    logger.info("log path: %s", LOG_PATH)

    if not args.preset_id and not args.custom_voice_id:
        raise SystemExit(
            "Provide at least one of --preset-id or --custom-voice-id. "
            "Riggs is on preset 'max' — try: --preset-id max"
        )

    shapes = candidate_shapes(args.script, args.preset_id, args.custom_voice_id)
    logger.info("script len=%d chars", len(args.script))
    logger.info("attempting %d shapes:", len(shapes))
    for name, body in shapes:
        logger.info("  - %s", name)
        logger.info("    %s", json.dumps(body)[:200])

    if not args.yes_fire:
        logger.info("")
        logger.info("DRY RUN — no Runway calls fired.")
        logger.info("Re-run with --yes-fire to actually probe.")
        logger.info("Expected total credit burn: <15 credits across %d shapes.", len(shapes))
        return 0

    api_key = os.environ.get("RUNWAY_API_KEY")
    if not api_key:
        raise SystemExit(
            "RUNWAY_API_KEY missing. Source .env or export the key first."
        )

    winner = None
    winning_payload = None
    errors = []
    for name, body in shapes:
        rc, payload = try_shape(
            args.api_base, api_key, args.api_version, name, body, logger,
        )
        if 200 <= rc < 300:
            winner = name
            winning_payload = payload
            break
        errors.append((name, rc, payload))

    if winner is None:
        print("")
        print("==== PROBE FAILED — no shape accepted ====")
        for name, rc, payload in errors:
            short = (
                json.dumps(payload)[:300]
                if isinstance(payload, dict)
                else str(payload)[:300]
            )
            print(f"  {name}: rc={rc} body={short}")
        print(f"log: {LOG_PATH}")
        print("")
        print("Conclusion: /v1/voices/preview is not the TTS-arbitrary-text")
        print("endpoint we hoped. Fall back to a third-party TTS (OpenAI,")
        print("ElevenLabs) or a one-shot cloned-voice trick for PR EA.")
        return 1

    logger.info("WINNER shape=%s", winner)
    logger.info("payload: %s", json.dumps(winning_payload, indent=2)[:1500])

    # Async (task id) vs sync (direct URL) — try both interpretations.
    task_id = winning_payload.get("id") if isinstance(winning_payload, dict) else None
    audio_url = extract_audio_url(winning_payload)

    if not audio_url and task_id:
        logger.info("response had id=%s — polling as async task", task_id)
        final = poll_task(args.api_base, api_key, args.api_version, task_id, logger)
        audio_url = extract_audio_url(final)
        winning_payload = final

    if not audio_url:
        print("")
        print("==== PROBE PARTIAL — shape accepted but no audio URL extracted ====")
        print(f"shape:   {winner}")
        print(f"payload: {json.dumps(winning_payload, indent=2)[:600]}")
        print(f"log:     {LOG_PATH}")
        print("")
        print("Inspect the payload manually to find where the audio lives.")
        return 2

    out_mp3 = Path("/tmp/probe-voice-preview.mp3")
    download(audio_url, out_mp3, logger)
    duration = ffprobe_duration_secs(out_mp3)

    print("")
    print("==== PROBE PASSED ====")
    print(f"winning shape:    {winner}")
    print(f"audio URL:        {audio_url[:100]}{'…' if len(audio_url) > 100 else ''}")
    print(f"audio duration:   {duration:.2f}s")
    print(f"local MP3:        {out_mp3}")
    print(f"log:              {LOG_PATH}")
    print("")
    print("Next: `open /tmp/probe-voice-preview.mp3` and verify it's")
    print("the avatar's bound voice speaking the script. If yes, this")
    print("is the TTS source for PR EA Long Ad rewrite.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
