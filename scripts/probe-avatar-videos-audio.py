#!/usr/bin/env python3
"""Probe: does /v1/avatar_videos accept speech.type=audio with >15s input?

One-shot Runway call to validate the assumptions behind the
speech.type=audio Long Ad rewrite plan. See conversation context
in 00-START-NEXT-SESSION.md head pointer.

Three things to verify per the deep plan:
  1. Audio-input duration cap — docs say "1–15s typical" for text
     input; this probe sends a ~30s audio file and checks for
     SUCCEEDED, truncation, or a duration-cap failure code.
  2. Audio source acceptance — confirms data:audio/mpeg;base64
     data URI works for ~30s @ 128kbps (~480 KB, well under any
     reasonable cap).
  3. Lip-sync acceptance on a non-Runway-generated voice — input
     audio comes from macOS `say` (or operator-supplied file),
     NOT from the avatar's bound voice block. If lip-sync visibly
     drifts on the output MP4 the operator can flag it.

Safety:
  - Refuses to fire without --yes-fire (default = dry-run prints
    planned body shape + audio metadata).
  - Refuses to fire when RUNWAY_API_KEY is missing.
  - Reads character record from backend/data/characters.json
    directly — no app boot, no DB lock contention.
  - Writes full request + response log to /tmp/probe-avatar-audio
    -<timestamp>.log for post-mortem.

Usage:
  # Dry-run — prints what would be sent, no credit burn:
  python scripts/probe-avatar-videos-audio.py \
      --character-id ffc0dc094a92

  # Real fire — burns ~30-60 credits, real Runway call:
  python scripts/probe-avatar-videos-audio.py \
      --character-id ffc0dc094a92 --yes-fire

  # Custom audio path (skips macOS `say` synthesis):
  python scripts/probe-avatar-videos-audio.py \
      --character-id ffc0dc094a92 \
      --audio-path /path/to/30sec.mp3 --yes-fire

  # Custom script (only used when synthesising via `say`):
  python scripts/probe-avatar-videos-audio.py \
      --character-id ffc0dc094a92 \
      --script "Long-form script of at least ~30 seconds when read aloud …" \
      --yes-fire
"""
from __future__ import annotations

import argparse
import base64
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
CHARACTERS_JSON = REPO_ROOT / "backend" / "data" / "characters.json"
LOG_PATH = Path(tempfile.gettempdir()) / (
    f"probe-avatar-audio-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
)

# Default ~30s when read aloud at typical macOS `say` speed (~180 wpm
# default voice rate). Picked to clear the documented "1-15s typical"
# text-input range so we can observe whether audio input is gated
# differently.
DEFAULT_SCRIPT = (
    "Hello. This is a probe of the avatar videos endpoint with an "
    "audio input source. We are testing three specific assumptions. "
    "First, whether the audio input path accepts durations longer "
    "than the fifteen second range typical for text input. Second, "
    "whether base sixty four data URIs work for around thirty "
    "seconds of mono audio. Third, whether lip sync remains "
    "acceptable when the supplied audio comes from a non Runway "
    "text to speech source. If this video renders cleanly with "
    "lip sync that tracks the words, the probe has passed and the "
    "long ad pipeline can be rewritten to use a single audio "
    "input call instead of chunked text renders."
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


def load_character(character_id: str) -> dict:
    if not CHARACTERS_JSON.exists():
        raise SystemExit(f"characters.json not found at {CHARACTERS_JSON}")
    records = json.loads(CHARACTERS_JSON.read_text())
    for rec in records:
        if rec.get("id") == character_id:
            return rec
    raise SystemExit(
        f"character {character_id!r} not in characters.json. "
        f"Available ids: {[r.get('id') for r in records]}"
    )


def synthesise_audio_via_say(script: str, out_mp3: Path) -> None:
    """macOS `say` → AIFF → ffmpeg → MP3 mono 128 kbps.

    `say` only writes AIFF natively; ffmpeg converts to MP3 so the
    file is small enough for a data URI and matches the audio/mpeg
    mime type Runway documents.
    """
    with tempfile.NamedTemporaryFile(suffix=".aiff", delete=False) as tmp:
        aiff_path = Path(tmp.name)
    try:
        subprocess.run(
            ["say", "-o", str(aiff_path), script],
            check=True,
            capture_output=True,
        )
        subprocess.run(
            [
                "ffmpeg", "-y", "-loglevel", "error",
                "-i", str(aiff_path),
                "-ac", "1",        # mono
                "-ar", "44100",
                "-b:a", "128k",
                str(out_mp3),
            ],
            check=True,
            capture_output=True,
        )
    finally:
        aiff_path.unlink(missing_ok=True)


def ffprobe_duration_secs(path: Path) -> float:
    """Return container duration in seconds via ffprobe."""
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


def to_data_uri(audio_bytes: bytes, mime: str = "audio/mpeg") -> str:
    b64 = base64.b64encode(audio_bytes).decode("ascii")
    return f"data:{mime};base64,{b64}"


def post_avatar_video(
    api_base: str,
    api_key: str,
    api_version: str,
    avatar_id: str,
    audio_data_uri: str,
    logger: logging.Logger,
) -> str:
    """POST /v1/avatar_videos with speech.type=audio. Returns task id."""
    url = f"{api_base}/v1/avatar_videos"
    body = {
        "model": "gwm1_avatars",
        "avatar": {"type": "custom", "avatarId": avatar_id},
        "speech": {"type": "audio", "audio": audio_data_uri},
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Runway-Version": api_version,
        "Content-Type": "application/json",
    }
    with httpx.Client(timeout=30.0) as client:
        resp = client.post(url, headers=headers, json=body)
    logger.info("POST %s -> %s", url, resp.status_code)
    logger.info("response body (truncated): %s", resp.text[:600])
    if resp.status_code != 200:
        raise SystemExit(
            f"avatar_videos create rejected: {resp.status_code} "
            f"{resp.text[:300]}"
        )
    created = resp.json()
    task_id = created.get("id")
    if not task_id:
        raise SystemExit(f"avatar_videos create missing task id: {created}")
    return task_id


def poll_task(
    api_base: str,
    api_key: str,
    api_version: str,
    task_id: str,
    logger: logging.Logger,
    deadline_secs: int = 360,
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
            time.sleep(5)
    raise SystemExit(f"task {task_id} timed out after {deadline_secs}s")


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
    parser.add_argument("--character-id", required=True)
    parser.add_argument(
        "--audio-path",
        help="path to a pre-rendered MP3 (skips macOS `say` synthesis)",
    )
    parser.add_argument(
        "--script",
        default=DEFAULT_SCRIPT,
        help="script for `say` synthesis when --audio-path is omitted",
    )
    parser.add_argument(
        "--yes-fire",
        action="store_true",
        help="REQUIRED to actually fire the Runway call. Without "
             "this flag the probe is dry-run.",
    )
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
    logger.info("==== probe-avatar-videos-audio ====")
    logger.info("character_id=%s", args.character_id)
    logger.info("log path: %s", LOG_PATH)

    # --- step 1: load character + verify it has a ready avatar ---
    record = load_character(args.character_id)
    name = record.get("name", "?")
    avatar_id = record.get("runway_avatar_id")
    avatar_status = record.get("runway_avatar_status")
    logger.info("character: %s (name=%r)", args.character_id, name)
    logger.info("  runway_avatar_id=%s status=%s", avatar_id, avatar_status)
    if not avatar_id:
        raise SystemExit("character has no runway_avatar_id — create avatar first")
    if avatar_status not in {"ready", "mock"}:
        raise SystemExit(
            f"avatar status must be ready/mock; got {avatar_status!r}"
        )
    if str(avatar_id).startswith("mock_"):
        raise SystemExit("refusing to probe with a mock avatar id")

    # --- step 2: prepare audio source ---
    if args.audio_path:
        audio_path = Path(args.audio_path).expanduser().resolve()
        if not audio_path.exists():
            raise SystemExit(f"audio file not found: {audio_path}")
    else:
        audio_path = Path(tempfile.mkdtemp()) / "probe.mp3"
        logger.info("synthesising audio via macOS `say` → ffmpeg → %s", audio_path)
        synthesise_audio_via_say(args.script, audio_path)

    audio_bytes = audio_path.read_bytes()
    audio_duration = ffprobe_duration_secs(audio_path)
    audio_size = len(audio_bytes)
    logger.info(
        "audio: path=%s duration=%.2fs size=%d bytes (%.1f KB)",
        audio_path, audio_duration, audio_size, audio_size / 1024,
    )

    # --- step 3: build data URI + report planned request shape ---
    data_uri = to_data_uri(audio_bytes, "audio/mpeg")
    data_uri_size = len(data_uri)
    logger.info(
        "data URI: mime=audio/mpeg len=%d bytes (%.1f KB) — base64 expansion ~4/3",
        data_uri_size, data_uri_size / 1024,
    )

    planned_body_shape = {
        "model": "gwm1_avatars",
        "avatar": {"type": "custom", "avatarId": avatar_id},
        "speech": {
            "type": "audio",
            "audio": f"data:audio/mpeg;base64,<{audio_size}-byte audio>",
        },
    }
    logger.info("planned POST body shape:")
    logger.info("  %s", json.dumps(planned_body_shape, indent=2))

    if not args.yes_fire:
        logger.info("")
        logger.info("DRY RUN — no Runway call fired.")
        logger.info("Re-run with --yes-fire to actually send.")
        logger.info("Expected credit burn: ~30-60 credits for one render.")
        return 0

    # --- step 4: fire ---
    api_key = os.environ.get("RUNWAY_API_KEY")
    if not api_key:
        raise SystemExit(
            "RUNWAY_API_KEY missing. Source .env or export the key first."
        )
    logger.info("firing live Runway call...")
    fire_t0 = time.time()
    task_id = post_avatar_video(
        args.api_base, api_key, args.api_version, avatar_id, data_uri, logger,
    )
    logger.info("task created: %s", task_id)

    payload = poll_task(args.api_base, api_key, args.api_version, task_id, logger)
    fire_elapsed = time.time() - fire_t0
    status = (payload.get("status") or "").upper()
    logger.info("terminal status=%s elapsed=%.1fs", status, fire_elapsed)

    if status != "SUCCEEDED":
        failure = payload.get("failure") or payload.get("error")
        code = payload.get("failureCode")
        logger.info("FAILURE detail: %s", failure)
        logger.info("FAILURE code: %s", code)
        logger.info("full payload: %s", json.dumps(payload, indent=2))
        print("")
        print("==== PROBE FAILED ====")
        print(f"audio duration in: {audio_duration:.2f}s")
        print(f"status:            {status}")
        print(f"failureCode:       {code}")
        print(f"failure:           {failure}")
        print(f"log:               {LOG_PATH}")
        return 1

    # --- step 5: download + measure output ---
    output_urls = payload.get("output") or []
    out_url = next((u for u in output_urls if isinstance(u, str)), None)
    if not out_url:
        raise SystemExit(f"SUCCEEDED but no output URL: {payload}")
    out_mp4 = Path(tempfile.mkdtemp()) / "probe-output.mp4"
    download(out_url, out_mp4, logger)
    video_duration = ffprobe_duration_secs(out_mp4)
    logger.info("output video duration: %.2fs", video_duration)
    drift = video_duration - audio_duration

    print("")
    print("==== PROBE PASSED ====")
    print(f"audio duration in:   {audio_duration:.2f}s")
    print(f"video duration out:  {video_duration:.2f}s")
    print(f"duration drift:      {drift:+.2f}s  (close to 0 = no truncation)")
    print(f"task elapsed:        {fire_elapsed:.1f}s")
    print(f"audio data URI size: {data_uri_size / 1024:.1f} KB")
    print(f"output MP4:          {out_mp4}")
    print(f"log:                 {LOG_PATH}")
    print("")
    print("Next: open the MP4 and visually verify lip-sync quality.")
    print("If lip-sync tracks the audio cleanly the speech.type=audio")
    print("path is viable for the Long Ad rewrite (PR DY → DZ).")

    # Truncation sentinel: if Runway capped at ~15s the drift will be
    # large and negative. Flag in the exit code.
    if drift < -2.0:
        print("")
        print(f"⚠️  Video is {abs(drift):.1f}s shorter than audio — possible "
              "truncation. Investigate before committing to PR DZ.")
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
