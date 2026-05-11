#!/usr/bin/env python3
"""Llama-draft every spoken beat for the Character OS submission video.

Five beats need scripts (3 variants each = 15 total Llama calls):

  Beat 2 — Donny opener        Long Ad solo, ~280 chars
  Beat 3 — Miles problem       Long Ad solo, ~280 chars
  Beat 4 — Dialogue (3-way)    5 lines, Donny+Riggs+Miles
  Beat 6 — Riggs local LLM     Long Ad solo, ~280 chars
  Beat 8 — Dialogue (2-way)    5 lines, Donny+Riggs

Each beat gets a persona-tuned system prompt + a beat-specific
user prompt with the target structure / talking points / tone.
Per-beat output written to
``backend/data/submission_video/scripts/beat-{NN}.json``
with a ``variants`` array so the operator can pick a winner.

Uses Ollama via its OpenAI-compatible endpoint. Reads
LLM_PROVIDER / OLLAMA_BASE_URL / OLLAMA_MODEL from .env.

Safety:
  - Dry-run by default. ``--yes-fire`` actually calls Ollama.
  - Calls are local (no cloud spend); the gate is mostly for
    consistency with the other one-shot scripts.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTPUT_DIR = REPO_ROOT / "backend" / "data" / "submission_video" / "scripts"


# Persona voice notes — fed into each Llama call so the model
# matches the character's vibe. Sourced from the seeded
# personality + catchphrase fields in characters.json.
PERSONA_DONNY = (
    "DONNY: Punchy, confident, front-man energy. Fast pace. "
    "Slogan-friendly. Loves a clean opening line. Talks like a "
    "founder pitching at a demo day — direct, no fluff, "
    "occasionally cocky. Trusts a 5-word sentence over a 25-word one."
)

PERSONA_MILES = (
    "MILES: Calm, strategic, trustworthy. Thoughtful cadence. "
    "Mid-sentence pauses feel deliberate. Frames problems before "
    "selling solutions. Talks like a strategy consultant who's "
    "earned the room. Avoids hype words. Lets the audience arrive "
    "at the conclusion."
)

PERSONA_RIGGS = (
    "RIGGS: Scrappy, build-process-aware. The one who actually "
    "shipped the thing. Argues against feature bloat. Tests it "
    "three times. Talks like the engineer who hates marketing speak "
    "but happens to be on camera. Loves an honest concrete detail."
)


N_VARIANTS = 3


def system_prompt_solo(persona_notes: str, char_target: int) -> str:
    return (
        "You write short spoken ad scripts for an AI brand "
        "spokesperson called Character OS. The script will be read "
        "aloud by an avatar on camera, so write in natural spoken "
        "English. No stage directions. No parenthetical asides. No "
        "quotation marks around the script. No 'voiceover' labels. "
        "Just the spoken words.\n\n"
        f"Target length: {char_target} characters or less (hard cap "
        "300). The avatar's API caps the line.\n\n"
        f"PERSONA YOU'RE WRITING FOR:\n{persona_notes}\n\n"
        "Open with a hook in the first 10 words. End with one clear "
        "specific call-to-action or punchline. Do NOT mention the "
        "persona's name — they ARE the speaker."
    )


def system_prompt_dialogue(cast_notes: str, target_lines: int) -> str:
    return (
        "You write multi-character dialogue scripts for AI brand "
        "spokespeople called Character OS. Each line is read aloud "
        "by a different avatar on camera in sequence — like a "
        "scripted skit, but the camera cuts between the speakers. "
        "Write in natural spoken English. No stage directions. No "
        "parenthetical asides. No 'voiceover' labels.\n\n"
        f"Target: EXACTLY {target_lines} lines total. Each line "
        "MUST be under 280 characters (avatar API cap). Aim for "
        "120-220 chars per line — short, punchy, conversational.\n\n"
        f"CAST:\n{cast_notes}\n\n"
        "Format each line as `SPEAKER_NAME: their spoken line.` on "
        "its own line. The SPEAKER_NAME must match one of the cast "
        "names above EXACTLY. No other prefix, no markdown, no "
        "numbered list. Just speaker-colon-text, one per line."
    )


# Beat definitions. Each beat has:
#   id: numeric beat number
#   slug: filename slug
#   kind: "solo" | "dialogue"
#   persona / cast: voice notes for the LLM
#   target_chars / target_lines: length target
#   user_prompt: beat-specific instructions
BEATS = [
    {
        "id": 2,
        "slug": "donny-opener",
        "kind": "solo",
        "persona": PERSONA_DONNY,
        "target_chars": 280,
        "user_prompt": (
            "Write the opening line of the Character OS submission "
            "video. Donny — the canonical Character OS spokesperson "
            "— addresses the viewer directly.\n\n"
            "Beat goals:\n"
            " - Acknowledge upfront that this is a hackathon "
            "submission video.\n"
            " - The hook: the avatar talking to you was BUILT by "
            "the thing this submission is pitching. The script he "
            "is reading was just written by a local Llama LLM. "
            "Welcome to Character OS.\n"
            " - Make the viewer realize they're watching the "
            "product demo itself.\n"
            " - Stay under 280 chars. Single avatar_videos line."
        ),
    },
    {
        "id": 3,
        "slug": "miles-problem",
        "kind": "solo",
        "persona": PERSONA_MILES,
        "target_chars": 280,
        "user_prompt": (
            "Write the 'problem statement' beat of the Character OS "
            "submission video. Miles — the strategist persona — "
            "frames the problem before any solution is named.\n\n"
            "Beat goals:\n"
            " - Every brand wants AI in their marketing.\n"
            " - What they get back is disposable: one-off renders, "
            "no continuity, no brand identity that survives.\n"
            " - End with a question or pivot that sets up the "
            "'persistent AI spokesperson' answer (don't name it yet).\n"
            " - Calm, strategic, no hype. Stay under 280 chars."
        ),
    },
    {
        "id": 4,
        "slug": "what-we-built-trio",
        "kind": "dialogue",
        "cast": (
            f"{PERSONA_DONNY}\n\n{PERSONA_RIGGS}\n\n{PERSONA_MILES}"
        ),
        "cast_names": ["Donny", "Riggs", "Miles"],
        "target_lines": 5,
        "user_prompt": (
            "Write a 5-line dialogue between three Character OS "
            "spokespeople — Donny, Riggs, Miles — explaining what "
            "this hackathon submission actually IS.\n\n"
            "Beat goals (each line should land one of these):\n"
            " - Donny opens: persistent AI spokesperson, not one-off.\n"
            " - Riggs: context-kit kept multiple AI coding sessions "
            "aligned during the build (real differentiator vs. "
            "vibe-coded one-shot demos).\n"
            " - Miles: campaigns are reusable workspaces, not "
            "throwaway briefs.\n"
            " - Donny: the same character drives spokesperson ads, "
            "long ads, dialogue scenes, and live realtime "
            "conversations. One identity, many surfaces.\n"
            " - Riggs (closer): if you can talk to it like a real "
            "spokesperson, you can ALSO direct it like one.\n\n"
            "Each line must be UNDER 280 chars and must be in the "
            "format `Donny: their line.` / `Riggs: their line.` / "
            "`Miles: their line.`. Five lines total. Three speakers."
        ),
    },
    {
        "id": 6,
        "slug": "riggs-local-llm",
        "kind": "solo",
        "persona": PERSONA_RIGGS,
        "target_chars": 280,
        "user_prompt": (
            "Write the 'local LLM story' beat. Riggs — the "
            "build-process persona — talks about why this whole "
            "thing didn't need an OpenAI API key.\n\n"
            "Beat goals:\n"
            " - The model that wrote the previous ad is running on "
            "the operator's laptop right now.\n"
            " - Llama 3, 8B parameters, Ollama serving it locally.\n"
            " - The OpenAI client just got pointed at a different "
            "base URL — that's the whole 'integration'.\n"
            " - The point: no cloud LLM bill for the creative loop. "
            "Runway is the only thing that leaves the laptop.\n"
            " - Concrete and a little proud. Stay under 280 chars."
        ),
    },
    {
        "id": 8,
        "slug": "why-we-win-closer",
        "kind": "dialogue",
        "cast": f"{PERSONA_DONNY}\n\n{PERSONA_RIGGS}",
        "cast_names": ["Donny", "Riggs"],
        "target_lines": 5,
        "user_prompt": (
            "Write the closing dialogue. Donny + Riggs trade lines "
            "about why this submission should win.\n\n"
            "Beat goals (one per line):\n"
            " - Donny: this submission video itself was made by the "
            "product it's pitching. Meta loop.\n"
            " - Riggs: the whole creative loop runs local except for "
            "video generation — Llama writes, DaVinci polishes, "
            "Runway only does what nobody else can.\n"
            " - Donny: we didn't build an AI ad tool. We built "
            "infrastructure for AI brand identity that survives "
            "across campaigns.\n"
            " - Riggs: every spokesperson can write its own scripts, "
            "render its own videos, and TALK BACK live over WebRTC.\n"
            " - Donny (final): name the prize — *Character OS, built "
            "on Runway* (or similar closer). Strong button.\n\n"
            "Each line UNDER 280 chars. Format `Donny: text` / "
            "`Riggs: text`. Five lines total."
        ),
    },
]


def clean_script(raw: str) -> str:
    """Strip the most common LLM ornaments. Mirrors the cleaner in
    concept_service._clean_script_output."""
    if not raw:
        return ""
    text = raw.strip()
    for fence in ("```", "~~~"):
        if text.startswith(fence):
            text = text.lstrip("`~ \n")
        if text.endswith(fence):
            text = text.rstrip("`~ \n")
    prefixes = (
        "Here is the script:",
        "Here's the script:",
        "Here is the dialogue:",
        "Here's the dialogue:",
        "Here is the line:",
        "Here's the line:",
        "Here is your script:",
        "Here's your script:",
        "Script:",
        "Ad:",
    )
    for prefix in prefixes:
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].lstrip()
    if (
        len(text) >= 2
        and text[0] in {'"', "'", "“", "‘"}
        and text[-1] in {'"', "'", "”", "’"}
    ):
        text = text[1:-1].strip()
    return text


def parse_dialogue(raw: str, cast_names: list) -> list:
    """Parse `Speaker: line.` per-line into [{speaker, text}].
    Drops lines that don't match a known speaker or are blank.
    Tolerant of `**Speaker**:` markdown bold ornaments."""
    lines = []
    cast_lower = {n.lower() for n in cast_names}
    for raw_line in raw.split("\n"):
        line = raw_line.strip()
        if not line:
            continue
        # Strip leading bullets / numbering ornaments
        line = re.sub(r"^\s*(?:[-*•]|\d+[\.\)])\s+", "", line)
        # Strip markdown bold around the speaker name
        line = re.sub(r"\*+", "", line)
        # Split on the first colon
        m = re.match(r"^([^:]{1,40}):\s*(.+)$", line)
        if not m:
            continue
        speaker = m.group(1).strip()
        text = m.group(2).strip()
        if speaker.lower() not in cast_lower:
            continue
        # Strip wrapping quotes on the text
        if (
            len(text) >= 2
            and text[0] in {'"', "'", "“", "‘"}
            and text[-1] in {'"', "'", "”", "’"}
        ):
            text = text[1:-1].strip()
        # Avatar API cap
        if len(text) > 300:
            text = text[:280].rstrip()
        lines.append({"speaker": speaker, "text": text})
    return lines


def call_ollama(
    base_url: str,
    model: str,
    system: str,
    user: str,
    temperature: float = 0.95,
    timeout: float = 90.0,
) -> str:
    """Single Ollama chat-completion call. Returns the assistant
    text. Raises on any failure so the caller can decide."""
    import httpx
    url = f"{base_url.rstrip('/')}/chat/completions"
    body = {
        "model": model,
        "messages": [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
        "temperature": temperature,
    }
    with httpx.Client(timeout=timeout) as client:
        resp = client.post(
            url,
            headers={"Authorization": "Bearer ollama"},
            json=body,
        )
        resp.raise_for_status()
        payload = resp.json()
    choices = payload.get("choices") or []
    if not choices:
        raise RuntimeError(f"ollama returned no choices: {payload}")
    return choices[0].get("message", {}).get("content") or ""


def draft_beat(beat: dict, base_url: str, model: str) -> dict:
    """Generate N_VARIANTS variants for one beat. Returns a dict
    suitable for JSON serialisation. Per-variant failures surface
    in the variant entry; doesn't abort the rest."""
    if beat["kind"] == "solo":
        system = system_prompt_solo(beat["persona"], beat["target_chars"])
    else:
        system = system_prompt_dialogue(beat["cast"], beat["target_lines"])

    variants = []
    for v_idx in range(1, N_VARIANTS + 1):
        t0 = time.time()
        try:
            raw = call_ollama(
                base_url, model, system, beat["user_prompt"],
                temperature=0.85 + (v_idx - 1) * 0.05,  # 0.85, 0.90, 0.95
            )
            if beat["kind"] == "solo":
                script = clean_script(raw)
                variants.append({
                    "variant": v_idx,
                    "elapsed": time.time() - t0,
                    "script": script,
                    "chars": len(script),
                    "ok": True,
                })
            else:
                lines = parse_dialogue(raw, beat["cast_names"])
                variants.append({
                    "variant": v_idx,
                    "elapsed": time.time() - t0,
                    "lines": lines,
                    "line_count": len(lines),
                    "raw": raw,
                    "ok": len(lines) >= max(2, beat["target_lines"] - 1),
                })
        except Exception as exc:
            variants.append({
                "variant": v_idx,
                "elapsed": time.time() - t0,
                "ok": False,
                "error": str(exc)[:300],
            })
    return {
        "beat_id": beat["id"],
        "slug": beat["slug"],
        "kind": beat["kind"],
        "variants": variants,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--yes-fire", action="store_true")
    parser.add_argument(
        "--base-url",
        default=os.environ.get("OLLAMA_BASE_URL", "http://localhost:11434/v1"),
    )
    parser.add_argument(
        "--model",
        default=os.environ.get("OLLAMA_MODEL", "llama3:latest"),
    )
    args = parser.parse_args()

    print("==== draft-submission-video-beats ====")
    print(f"ollama base: {args.base_url}")
    print(f"model:       {args.model}")
    print(f"output dir:  {OUTPUT_DIR}")
    print()
    print(f"beats to draft (3 variants each = {len(BEATS) * 3} calls):")
    for b in BEATS:
        print(
            f"  [{b['id']:02d}] {b['slug']:<28} "
            f"({b['kind']:<8}{', ' + ', '.join(b['cast_names']) if b['kind']=='dialogue' else ''})"
        )

    if not args.yes_fire:
        print()
        print("DRY RUN — no Ollama calls fired. Re-run with --yes-fire.")
        return 0

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    print()
    print(f"firing {len(BEATS) * 3} Ollama calls sequentially…")
    print()
    t_total = time.time()
    for beat in BEATS:
        print(f"---- beat {beat['id']} ({beat['slug']}) ----")
        result = draft_beat(beat, args.base_url, args.model)
        path = OUTPUT_DIR / f"beat-{beat['id']:02d}-{beat['slug']}.json"
        path.write_text(json.dumps(result, indent=2))
        for v in result["variants"]:
            if not v.get("ok"):
                err = v.get("error", "structure issue (low line count)")
                print(f"  v{v['variant']}  ❌ {err[:80]}")
            elif beat["kind"] == "solo":
                preview = (v["script"][:70] + "…") if len(v["script"]) > 70 else v["script"]
                print(
                    f"  v{v['variant']}  {v['elapsed']:5.1f}s  "
                    f"{v['chars']:>3}c   {preview}"
                )
            else:
                print(
                    f"  v{v['variant']}  {v['elapsed']:5.1f}s  "
                    f"{v['line_count']} lines"
                )
                for line in v.get("lines", [])[:5]:
                    preview = (line["text"][:60] + "…") if len(line["text"]) > 60 else line["text"]
                    print(f"          {line['speaker']:<6}: {preview}")
        print(f"  → {path.name}")
        print()

    print(f"==== DONE ({time.time() - t_total:.1f}s) ====")
    print(f"  scripts dir: {OUTPUT_DIR}")
    print(f"  beats drafted: {len(BEATS)} × {N_VARIANTS} = {len(BEATS) * N_VARIANTS} variants")
    print()
    print("Next: review the JSON files, pick a winner per beat, then")
    print("queue the renders (step B).")
    return 0


if __name__ == "__main__":
    sys.exit(main())
