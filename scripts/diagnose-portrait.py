#!/usr/bin/env python3
"""PR CT — Portrait/avatar diagnostic dump.

Usage:

    python scripts/diagnose-portrait.py <character-id>

or run with no arg to list all characters.

Prints (no real Runway calls, no secrets):

- character id / name / template
- subject + style + style chips (metadata)
- the resolved prompt that WOULD be sent (default path)
- the resolved prompt that would be sent under safe_retry=True
- portrait_source / portrait_url / prompt_last_persisted
- portrait_last_error (the most recent failure string, if any)
- runway_avatar_status / id / error
- the Runway request body shape (model + ratio + endpoint) without
  base64 payload bytes
- whether the on-disk portrait file exists + its byte count

Use this BEFORE clicking Generate Portrait so you know what's about
to be sent + what state the record is in.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND))

from app.services.character_studio_client import (  # noqa: E402
    _IMAGE_MODEL,
    _MAX_PORTRAIT_RATIO,
    build_prompt,
)


def _load_characters() -> list[dict]:
    path = BACKEND / "data" / "characters.json"
    if not path.exists():
        print(f"✗ no characters.json at {path}", file=sys.stderr)
        return []
    raw = json.loads(path.read_text())
    return raw if isinstance(raw, list) else raw.get("characters", [])


def _print_character_brief(c: dict) -> None:
    print(f"  {c['id']:<14}  {c.get('name', '?'):<30}  template={c.get('template')}")


def _list_all() -> int:
    chars = _load_characters()
    if not chars:
        return 1
    print(f"-- {len(chars)} character(s) in characters.json --\n")
    for c in chars:
        _print_character_brief(c)
    print("\nRun: python scripts/diagnose-portrait.py <character-id>")
    return 0


def _diagnose(character_id: str) -> int:
    chars = _load_characters()
    record = next((c for c in chars if c.get("id") == character_id), None)
    if record is None:
        print(f"✗ character not found: {character_id}", file=sys.stderr)
        print("  available ids:", file=sys.stderr)
        for c in chars:
            print(f"    {c['id']}  {c.get('name', '?')}", file=sys.stderr)
        return 2

    print(f"=== {record.get('name', '?')} ({record['id']}) ===\n")

    print("-- record fields --")
    for k in (
        "template", "subject", "style",
        "portrait_url", "portrait_source",
        "runway_avatar_id", "runway_avatar_status", "runway_avatar_error",
        "voice_preset", "custom_voice_id", "custom_voice_status",
    ):
        v = record.get(k)
        print(f"  {k}: {v!r}")
    style_chips = []
    if isinstance(record.get("metadata"), dict):
        chips = record["metadata"].get("visual_style_chips") or []
        if isinstance(chips, list):
            style_chips = chips
    print(f"  metadata.visual_style_chips: {style_chips}")
    print(f"  metadata.creation_flow:      {(record.get('metadata') or {}).get('creation_flow', '—')}")
    print()

    print("-- last persisted portrait_prompt (what was sent on the most recent attempt) --")
    pp = record.get("portrait_prompt") or ""
    if pp:
        print(f"  ({len(pp)} chars)")
        print(f"  {pp}")
    else:
        print("  (none persisted — no attempt yet, or pre-PR-CS regen)")
    print()

    print("-- last portrait failure (PR CS) --")
    err = record.get("portrait_last_error") or ""
    if err:
        print(f"  {err}")
    else:
        print("  (cleared / none)")
    print()

    print("-- prompt that WOULD be sent on next default-path click --")
    template = record.get("template") or "mascot"
    next_prompt = build_prompt(
        template,
        subject=record.get("subject"),
        style=record.get("style"),
    )
    print(f"  ({len(next_prompt)} chars)")
    print(f"  {next_prompt}")
    print()

    print("-- prompt that WOULD be sent on next safe_retry click --")
    safe_prompt = build_prompt(
        template,
        subject=record.get("subject"),
        style=record.get("style"),
        safe_retry=True,
    )
    print(f"  ({len(safe_prompt)} chars)")
    print(f"  {safe_prompt}")
    print()

    print("-- runway request shape (no base64 / no secrets) --")
    print(f"  endpoint:  POST /v1/text_to_image")
    print(f"  model:     {_IMAGE_MODEL}")
    print(f"  ratio:     {_MAX_PORTRAIT_RATIO}")
    print(f"  reference: 320×320 charcoal seed PNG (data URI, ~570 bytes base64)")
    print(f"  X-Runway-Version: 2024-11-06")
    print()

    print("-- portrait file on disk --")
    portrait_path = BACKEND / "data" / "characters" / f"{record['id']}-portrait.png"
    if portrait_path.exists():
        size = portrait_path.stat().st_size
        print(f"  {portrait_path} · {size:,} bytes · mtime={int(portrait_path.stat().st_mtime)}")
    else:
        print(f"  {portrait_path} · (missing)")
    print()

    return 0


def main(argv: list[str]) -> int:
    if len(argv) <= 1:
        return _list_all()
    return _diagnose(argv[1].strip())


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
