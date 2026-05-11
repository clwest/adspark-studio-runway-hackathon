#!/usr/bin/env python3
"""Probe: what schema shape does POST /v1/realtime_sessions accept
for the `tools[]` array?

Runway docs reference `tools` as "optional, function-call defs" on
the realtime-session body but don't pin the per-tool shape. This
probe tries the four most plausible shapes in sequence, stops on
the first 2xx, and tears down the session afterward so the slot is
released without consuming WebRTC time.

If all four shapes 4xx, the validation errors collectively reveal
the contract (same approach worked for PR DZ-a probing
/v1/voices/preview).

Candidate shapes tried, in order:

  1. openai-chat-completions
       {"type": "function",
        "function": {"name": "...", "description": "...",
                     "parameters": {<jsonschema>}}}
     (OpenAI Chat Completions API legacy shape — most common in
     the wild)

  2. openai-responses-flat
       {"type": "function",
        "name": "...", "description": "...",
        "parameters": {<jsonschema>}}
     (OpenAI Responses API newer shape — flat, no wrapper)

  3. anthropic-tools
       {"name": "...", "description": "...",
        "input_schema": {<jsonschema>}}
     (Anthropic tool-use shape; uses `input_schema` not `parameters`)

  4. livekit-minimal
       {"name": "...", "description": "..."}
     (LiveKit Agents shape — just name + description, parameters
     inferred / not strictly typed)

Each attempt does:
  - POST /v1/realtime_sessions with the candidate tools[]
  - Log status code + body
  - If 2xx: record the shape as winner, immediately
    DELETE /v1/realtime_sessions/{id} to release the slot
  - Continue to next shape only if 4xx

Realtime session create cost is minimal (per-session-create fee,
not metered by duration when never consumed). Total probe burn
estimate: <25 credits across all four attempts.

Safety:
  - Dry-run by default. `--yes-fire` required to actually POST.
  - Refuses to fire without RUNWAY_API_KEY in env.
  - Refuses to fire against a character without a ready avatar.
  - Refuses to fire against a mock avatar id.

Usage:
  # Dry-run, prints the four shapes that will be tried:
  python scripts/probe-realtime-tools.py --character-id ffc0dc094a92

  # Real fire (~20-25 credits, 4 session-creates + 4 deletes):
  python scripts/probe-realtime-tools.py \
      --character-id ffc0dc094a92 --yes-fire
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
import tempfile
import time
from datetime import datetime
from pathlib import Path

import httpx


REPO_ROOT = Path(__file__).resolve().parent.parent
CHARACTERS_JSON = REPO_ROOT / "backend" / "data" / "characters.json"
LOG_PATH = Path(tempfile.gettempdir()) / (
    f"probe-realtime-tools-{datetime.now().strftime('%Y%m%d-%H%M%S')}.log"
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


# Test-tool semantics — same name + description across shapes so the
# only variable is the wrapping schema. Operation is harmless:
# echoing a string. Probe only verifies SHAPE ACCEPTANCE at session
# create time; we never connect WebRTC, so the tool is never
# actually invoked.
TOOL_NAME = "echo_text"
TOOL_DESCRIPTION = (
    "Echo back the supplied text. Test tool only — never actually "
    "invoked during this probe."
)
TOOL_PARAMS_JSONSCHEMA = {
    "type": "object",
    "properties": {
        "text": {"type": "string", "description": "Text to echo back"},
    },
    "required": ["text"],
}


def candidate_shapes() -> list[tuple[str, dict]]:
    """Candidate tool entry shapes, ordered by probability.

    Shape #5 (`runway-client-event`) is the verified shape — sourced
    from `@runwayml/avatars-react/dist/api.d.ts` line 88, which
    documents: *"At runtime this is just `{ type, name, description }`
    (exactly what the Runway session create payload expects)."* The
    discriminator value is the literal string `client_event` (NOT
    `function`). No `parameters` field on the wire — the SDK keeps
    the JSON schema client-side for arg validation only.

    Shapes #1–#4 are kept for historical record (all failed in the
    first run with "No matching discriminator" because they used
    `type: function` or omitted the discriminator entirely)."""
    return [
        (
            "openai-chat-completions",
            {
                "type": "function",
                "function": {
                    "name": TOOL_NAME,
                    "description": TOOL_DESCRIPTION,
                    "parameters": TOOL_PARAMS_JSONSCHEMA,
                },
            },
        ),
        (
            "openai-responses-flat",
            {
                "type": "function",
                "name": TOOL_NAME,
                "description": TOOL_DESCRIPTION,
                "parameters": TOOL_PARAMS_JSONSCHEMA,
            },
        ),
        (
            "anthropic-tools",
            {
                "name": TOOL_NAME,
                "description": TOOL_DESCRIPTION,
                "input_schema": TOOL_PARAMS_JSONSCHEMA,
            },
        ),
        (
            "livekit-minimal",
            {
                "name": TOOL_NAME,
                "description": TOOL_DESCRIPTION,
            },
        ),
        (
            "runway-client-event",
            {
                "type": "client_event",
                "name": TOOL_NAME,
                "description": TOOL_DESCRIPTION,
            },
        ),
    ]


def try_shape(
    api_base: str,
    api_key: str,
    api_version: str,
    avatar_id: str,
    label: str,
    tool_entry: dict,
    logger: logging.Logger,
) -> tuple[int, dict | str, str | None]:
    """POST a realtime session with the candidate tools[]. Returns
    (status_code, parsed_or_text, session_id_if_created)."""
    url = f"{api_base}/v1/realtime_sessions"
    body = {
        "model": "gwm1_avatars",
        "avatar": {"type": "custom", "avatarId": avatar_id},
        "tools": [tool_entry],
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Runway-Version": api_version,
        "Content-Type": "application/json",
    }
    logger.info("---- shape=%s ----", label)
    logger.info("body: %s", json.dumps(body))
    try:
        with httpx.Client(timeout=30.0) as client:
            resp = client.post(url, headers=headers, json=body)
    except httpx.HTTPError as exc:
        logger.warning("http error: %s", exc)
        return 0, f"http error: {exc!s}", None
    rc = resp.status_code
    text = resp.text[:1500]
    logger.info("http=%s body=%s", rc, text)
    session_id = None
    parsed: dict | str
    try:
        parsed = resp.json()
        if isinstance(parsed, dict):
            session_id = parsed.get("id")
    except json.JSONDecodeError:
        parsed = text
    return rc, parsed, session_id


def delete_session(
    api_base: str,
    api_key: str,
    api_version: str,
    session_id: str,
    logger: logging.Logger,
) -> None:
    """Best-effort teardown so the probe doesn't leak realtime
    sessions. Never raises."""
    url = f"{api_base}/v1/realtime_sessions/{session_id}"
    headers = {
        "Authorization": f"Bearer {api_key}",
        "X-Runway-Version": api_version,
    }
    try:
        with httpx.Client(timeout=10.0) as client:
            resp = client.delete(url, headers=headers)
        logger.info("DELETE session %s -> %s", session_id, resp.status_code)
    except httpx.HTTPError as exc:
        logger.warning("delete failed for %s: %s", session_id, exc)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--character-id", required=True)
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
    logger.info("==== probe-realtime-tools ====")
    logger.info("character_id=%s", args.character_id)
    logger.info("log path: %s", LOG_PATH)

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

    shapes = candidate_shapes()
    logger.info("attempting %d shapes:", len(shapes))
    for label, tool in shapes:
        logger.info("  - %s", label)
        logger.info("    %s", json.dumps(tool)[:240])

    if not args.yes_fire:
        logger.info("")
        logger.info("DRY RUN — no Runway calls fired.")
        logger.info("Re-run with --yes-fire to actually probe.")
        logger.info("Expected total credit burn: <25 credits across %d shapes.", len(shapes))
        return 0

    api_key = os.environ.get("RUNWAY_API_KEY")
    if not api_key:
        raise SystemExit(
            "RUNWAY_API_KEY missing. Source .env or export the key first."
        )

    winner: str | None = None
    winning_payload: dict | str | None = None
    errors: list[tuple[str, int, dict | str]] = []
    for label, tool_entry in shapes:
        rc, payload, session_id = try_shape(
            args.api_base, api_key, args.api_version, avatar_id, label, tool_entry, logger,
        )
        if 200 <= rc < 300:
            winner = label
            winning_payload = payload
            # Tear down the winning session — we don't need to
            # consume it; the shape acceptance is all we wanted.
            if session_id:
                delete_session(
                    args.api_base, api_key, args.api_version, session_id, logger,
                )
            break
        errors.append((label, rc, payload))
        # Small breathing room so we don't hammer Runway on rapid 400s.
        time.sleep(1)

    if winner is None:
        print("")
        print("==== NO SHAPE ACCEPTED — but the validation errors are gold ====")
        for label, rc, payload in errors:
            short = (
                json.dumps(payload)[:500]
                if isinstance(payload, dict)
                else str(payload)[:500]
            )
            print(f"")
            print(f"  shape={label}  rc={rc}")
            print(f"    body: {short}")
        print("")
        print(f"log: {LOG_PATH}")
        print("")
        print("Read the 'path' / 'expected' fields in each validation")
        print("error to reconstruct the schema Runway wants. PR DV used")
        print("this same technique to discover voice.id vs voice.voiceId.")
        return 1

    print("")
    print("==== PROBE PASSED ====")
    print(f"winning shape:    {winner}")
    payload_str = (
        json.dumps(winning_payload, indent=2)[:1200]
        if isinstance(winning_payload, dict)
        else str(winning_payload)[:1200]
    )
    print(f"session payload:")
    for line in payload_str.splitlines():
        print(f"  {line}")
    print("")
    print(f"log: {LOG_PATH}")
    print("")
    print("Next steps:")
    print("  1. Grep `node_modules/@runwayml/avatars-react/dist/` for")
    print("     'tool' / 'onToolCall' / 'function_call' — confirm the")
    print("     SDK exposes tool-call events to the frontend.")
    print("  2. If SDK supports tool events → PR EE-b plumbing")
    print("     (backend adds tools to session create + tool dispatch")
    print("     endpoint, frontend wires SDK handler).")
    print("  3. If SDK doesn't support tool events → fallback to raw")
    print("     LiveKit data-channel or upgrade @runwayml/avatars-react.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
