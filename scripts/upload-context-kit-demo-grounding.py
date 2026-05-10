#!/usr/bin/env python3
"""PR DD — Context-kit demo grounding uploader.

Pipes a curated slice of the project's context-kit (the WHAT_IT_IS
narrative + the head of START + INVENTORY + the latest 2–3 handoffs)
into a campaign's Runway realtime grounding document via the
PR DD raw attach route. Use this to set up a "How Character OS Was
Built" demo campaign whose spokesperson can answer questions about
the project itself.

The script is read-only against the repo and only writes via the new
raw route — it never edits campaigns.json directly.

## Usage

    # Dry-run preview (no HTTP call):
    python scripts/upload-context-kit-demo-grounding.py \\
        --campaign-id 8ea08b2fc95d --dry-run

    # Real attach (mock or live depending on backend boot mode):
    python scripts/upload-context-kit-demo-grounding.py \\
        --campaign-id 8ea08b2fc95d

    # Against a non-default backend:
    python scripts/upload-context-kit-demo-grounding.py \\
        --campaign-id 8ea08b2fc95d --base-url http://localhost:9000

## What it includes

In order:

1. `docs/WHAT_IT_IS.md` — narrative anchor (full).
2. `00-START-NEXT-SESSION.md` — head section only (everything before
   the deep PR history dump, which is noise for grounding).
3. `docs/INVENTORY.md` — head section only (the most recent PR block).
4. The 2 most recent `docs/handoffs/SESSION_*.md` files by mtime.

Each section gets a clear Markdown ``## File: <path>`` header so the
avatar can cite where a fact came from. The full payload is trimmed to
``DOCUMENT_MAX_CHARS`` (40,000) before POSTing — Runway's hard cap is
~50k tokens but the AdSpark documents client trims to 40k chars for
safety. If the trim line falls inside a section, that section gets a
``[truncated]`` marker so the avatar knows.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

# Mirror backend/app/services/documents_client.DOCUMENT_MAX_CHARS so the
# script makes the same trimming decision the route would. Duplicated
# rather than imported to keep the script runnable without the backend
# venv activated.
DOCUMENT_MAX_CHARS = 40_000

REPO_ROOT = Path(__file__).resolve().parent.parent


def _read(path: Path) -> Optional[str]:
    if not path.exists() or not path.is_file():
        return None
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        print(f"warn: could not read {path}: {exc}", file=sys.stderr)
        return None


def _head_only(text: str, max_chars: int) -> str:
    """Take roughly the first `max_chars` characters but stop at a
    paragraph boundary so the section doesn't end mid-sentence.

    Note: START / INVENTORY both start with a title line + a blank +
    one very long paragraph. A naive ``rfind("\\n\\n")`` lands on the
    title break and yields ~30 chars. Require the cut to be at least
    50% of ``max_chars`` before accepting it; otherwise fall back to a
    single-newline cut, then to a hard slice.
    """
    if len(text) <= max_chars:
        return text
    min_cut = max_chars // 2
    cut = text.rfind("\n\n", 0, max_chars)
    if cut < min_cut:
        cut = text.rfind("\n", 0, max_chars)
    if cut < min_cut:
        cut = max_chars
    return text[:cut].rstrip()


def _recent_handoffs(n: int) -> list[Path]:
    """Latest `n` handoff files by mtime. Filters out the one-off
    SESSION_REAL_API* fixture that isn't a numbered handoff."""
    handoffs_dir = REPO_ROOT / "docs" / "handoffs"
    if not handoffs_dir.exists():
        return []
    files = [
        p for p in handoffs_dir.glob("SESSION_*.md")
        if p.name.startswith("SESSION_") and p.name[8:11].isdigit()
    ]
    files.sort(key=lambda p: p.stat().st_mtime, reverse=True)
    return files[:n]


def build_payload() -> tuple[list[tuple[Path, int]], str, bool]:
    """Compose the full Markdown payload + return a per-file manifest.

    Returns:
        manifest: list of ``(repo_relative_path, chars_after_section_trim)``.
        content:  the assembled Markdown, already trimmed to 40k chars.
        truncated: True if the 40k total cap fired (cut lands inside the
                   tail section).
    """
    sections: list[tuple[Path, str]] = []

    # 1. WHAT_IT_IS — full file
    what = REPO_ROOT / "docs" / "WHAT_IT_IS.md"
    text = _read(what)
    if text:
        sections.append((what, text))

    # 2. START — head only (everything is dense PR history; cap at 6k)
    start = REPO_ROOT / "00-START-NEXT-SESSION.md"
    text = _read(start)
    if text:
        sections.append((start, _head_only(text, 6_000)))

    # 3. INVENTORY — head only (recent PR block; cap at 8k)
    inv = REPO_ROOT / "docs" / "INVENTORY.md"
    text = _read(inv)
    if text:
        sections.append((inv, _head_only(text, 8_000)))

    # 4. Latest 2 numbered handoffs (mtime sorted)
    for p in _recent_handoffs(2):
        text = _read(p)
        if text:
            sections.append((p, _head_only(text, 8_000)))

    # Assemble Markdown with clear section headers.
    lines: list[str] = [
        "# AdSpark / Character OS — Project Context Pack",
        "",
        "This document is curated context-kit material the spokesperson "
        "uses to answer questions about how the project was built. "
        "When asked something covered below, cite the source filename.",
        "",
    ]
    for path, text in sections:
        rel = path.relative_to(REPO_ROOT)
        lines.append(f"## File: {rel}")
        lines.append("")
        lines.append(text.strip())
        lines.append("")

    full = "\n".join(lines).strip()

    # Trim to 40k chars at a paragraph boundary if possible.
    if len(full) > DOCUMENT_MAX_CHARS:
        cut = full.rfind("\n\n", 0, DOCUMENT_MAX_CHARS)
        if cut == -1:
            cut = DOCUMENT_MAX_CHARS
        trimmed = full[:cut].rstrip() + "\n\n[truncated to 40k chars]"
        truncated = True
    else:
        trimmed = full
        truncated = False

    # Manifest reflects each section's post-section-trim size.
    # The total-cap truncation flag is reported once (caller surfaces
    # it) rather than smeared across every section.
    manifest = [
        (path.relative_to(REPO_ROOT), len(text))
        for path, text in sections
    ]
    return manifest, trimmed, truncated


def post_to_route(
    campaign_id: str,
    base_url: str,
    name: str,
    content: str,
) -> dict:
    """POST to the PR DD raw attach route. Returns the parsed JSON
    response body. Raises urllib.error.HTTPError on non-2xx (caller
    surfaces the message)."""
    url = f"{base_url.rstrip('/')}/api/campaigns/{campaign_id}/realtime-document/raw"
    body = json.dumps({"name": name, "content": content}).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={"Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=30.0) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Upload curated context-kit Markdown into a campaign's "
            "realtime grounding document so the spokesperson can "
            "explain how the project was built."
        )
    )
    parser.add_argument(
        "--campaign-id", required=True,
        help="Target campaign id (e.g. 8ea08b2fc95d).",
    )
    parser.add_argument(
        "--base-url", default="http://localhost:8000",
        help="Backend base URL (default: http://localhost:8000).",
    )
    parser.add_argument(
        "--name", default="context-kit-demo-grounding",
        help=(
            "Document name shown in Runway's dashboard / logs "
            "(default: context-kit-demo-grounding)."
        ),
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print manifest + first 500 chars; do not POST.",
    )
    args = parser.parse_args(argv)

    manifest, content, truncated = build_payload()
    raw_total = sum(chars for _, chars in manifest)

    print("Files included:")
    for path, chars in manifest:
        print(f"  - {path}  ({chars:,} chars)")
    print(f"\nRaw section total: {raw_total:,} chars")
    print(f"Final payload:     {len(content):,} chars (cap {DOCUMENT_MAX_CHARS:,})")
    if truncated:
        print("Tail section trimmed at 40k boundary (marker appended).")

    if args.dry_run:
        preview = content[:500]
        print(f"\n--- first 500 chars ---\n{preview}\n--- end preview ---")
        print("\nDry-run: no POST sent.")
        return 0

    print(f"\nPOST {args.base_url}/api/campaigns/{args.campaign_id}/realtime-document/raw")
    try:
        result = post_to_route(args.campaign_id, args.base_url, args.name, content)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        print(f"HTTP {exc.code}: {body}", file=sys.stderr)
        return 1
    except urllib.error.URLError as exc:
        print(f"Connection error: {exc}", file=sys.stderr)
        return 1

    print("\nAttached. Realtime document fields on the campaign:")
    print(f"  runway_document_id:        {result.get('runway_document_id')}")
    print(f"  runway_document_status:    {result.get('runway_document_status')}")
    print(f"  runway_document_mock_mode: {result.get('runway_document_mock_mode')}")
    err = result.get("runway_document_error")
    if err:
        print(f"  runway_document_error:     {err}")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
