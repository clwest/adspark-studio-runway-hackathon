#!/usr/bin/env python3
"""PR CG — Demo Spokespeople Fixtures.

Idempotent seeder for the four canonical demo spokespeople that
back the v2 product narrative: Brewster Bolt (mascot), Clara
Vale (founder), Rex Roadside (local_guide), Mina Spark (coach).

Run from the repo root:

    python scripts/seed-demo-spokespeople.py

The script is **safe to re-run**:
- Existing characters with matching demo names get their fields
  updated (template / subject / style / personality / voice
  preset / metadata) — never duplicated.
- Existing user-created spokespeople (Brewster the Raccoon,
  Piper Voltage, Sir Landsloplot, …) are NEVER touched.
- No Runway calls fire. Portraits are deliberately left blank;
  the operator generates them via the in-app
  ``Generate Portrait`` button when ready.
- Idempotency key: case-insensitive **name** match against the
  fixed list of demo names below.

Each fixture is tagged via the Character.metadata field:

    metadata = {"demo": True, "demo_persona": "<id>", "demo_role": "..."}

so future tooling can detect demo records without name matching.
"""

from __future__ import annotations

import sys
from pathlib import Path
from typing import Any

# Make backend modules importable when running from repo root.
# `Settings.data_dir` defaults to "./data" relative to the
# process cwd; chdir into backend/ so we hit the same
# `backend/data/characters.json` the running uvicorn process
# reads / writes. Without this the script silently seeds a
# repo-root `data/` dir that the backend never sees.
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))
import os  # noqa: E402

os.chdir(BACKEND_ROOT)

from app.models import CharacterCreate  # noqa: E402
from app.services.character_store import CharacterStore  # noqa: E402

# Single source of truth for the canonical backend data dir.
DATA_DIR = BACKEND_ROOT / "data"


# PR CG — Locked fixture set. Every field maps to a `Character`
# field; `metadata` lands on the record post-create via
# `store.update()` since `CharacterCreate` doesn't accept it.
DEMO_SPOKESPEOPLE: list[dict[str, Any]] = [
    {
        "id": "brewster-bolt",
        "name": "Brewster Bolt",
        "template": "mascot",
        # PR CQ — concrete visual subject (anthropomorphic raccoon
        # mascot) so gen4_image_turbo renders the creature instead
        # of improvising a humanoid silhouette from the previous
        # "kinetic, animated, playful shape" ad-copy.
        "subject": (
            "an anthropomorphic raccoon mascot spokesperson with a "
            "confident grin, energetic posture, and friendly "
            "commercial expression"
        ),
        "style": (
            "vibrant, saturated colour palette; clean modern animation; "
            "expressive close-ups; punchy silhouette"
        ),
        "personality": (
            "Punchy, funny, confident, fast-moving. Hype-machine "
            "energy without feeling shouty. Says things like 'let's "
            "go' and 'one click, you're in'. Best for product launches "
            "and energy-drink-style brands."
        ),
        "catchphrases": [
            "Let's get loud.",
            "Caffeine? Optional. Conviction? Required.",
            "One click. You're in.",
        ],
        "voice_preset": "drew",
        "metadata_role": (
            "high-energy brand mascot · product hype spokesperson"
        ),
        "metadata_use_case": (
            "social ads, reels, energetic product launches"
        ),
    },
    {
        "id": "clara-vale",
        "name": "Clara Vale",
        "template": "founder",
        # PR CQ — concrete visual subject (human local-business
        # spokesperson) so the founder template renders a believable
        # founder headshot instead of leaning on the abstract
        # "polished founder / executive spokesperson —" ad-copy.
        "subject": (
            "a polished local business spokesperson with a warm "
            "confident smile, professional but approachable presence"
        ),
        "style": (
            "cinematic studio lighting; neutral palette with one "
            "brand accent; restrained motion; trustworthy gaze"
        ),
        "personality": (
            "Calm, credible, strategic, professional. Talks the "
            "way a thoughtful founder pitches at a partner "
            "meeting — confident without bravado, warm without "
            "fluff. Best for SaaS, consulting, B2B explainer "
            "video, and the AdSpark platform pitch itself."
        ),
        "catchphrases": [
            "Here's how we see it.",
            "The platform does the heavy lifting; you stay on-brand.",
            "Let me show you what changes when this ships.",
        ],
        "voice_preset": "clara",
        "metadata_role": (
            "polished founder / executive spokesperson"
        ),
        "metadata_use_case": (
            "SaaS, consulting, dealership, B2B explainer videos"
        ),
    },
    {
        "id": "rex-roadside",
        "name": "Rex Roadside",
        # PR CQ — switched from local_guide → mascot. Rex is now an
        # anthropomorphic bison dealership spokesperson, so the
        # mascot template's "an anthropomorphic mascot spokesperson"
        # anchor matches the concept; previously Runway upstream-
        # failed every regen attempt against the dense
        # "lot-and-truck backdrops, weather-worn but cared-for look"
        # phrasing under the local_guide template.
        "template": "mascot",
        "subject": (
            "a rugged but friendly anthropomorphic bison truck-"
            "dealership spokesperson, broad shoulders, warm grin, "
            "clean commercial mascot design"
        ),
        "style": (
            "natural daylight; truck and lot environments; "
            "honest mid-shots; weather-worn texture without "
            "looking gritty"
        ),
        "personality": (
            "Practical, friendly, no-pressure sales tone. Talks "
            "specs and payments like he actually drives the "
            "trucks he sells. Says 'no rush' and 'walk it with "
            "me' a lot. Best for dealership walkarounds, payment "
            "explainers, inventory highlights, Ford / pickup "
            "demos."
        ),
        "catchphrases": [
            "No pressure — just walk it with me.",
            "Numbers make sense when the truck does.",
            "If it ain't right for you, we keep looking.",
        ],
        "voice_preset": "marcus",
        "metadata_role": (
            "dealership / automotive sales spokesperson"
        ),
        "metadata_use_case": (
            "truck walkarounds, payment explanations, "
            "inventory highlights"
        ),
    },
    {
        "id": "mina-spark",
        "name": "Mina Spark",
        "template": "coach",
        # PR CQ — concrete visual subject (human creative-agency
        # spokesperson) so the coach template renders a believable
        # studio-host portrait instead of leaning on the framing
        # / composition ad-copy from the previous seed.
        "subject": (
            "a bright energetic creative agency spokesperson with "
            "a friendly confident expression and polished studio "
            "presence"
        ),
        "style": (
            "natural mixed lighting; quick cuts; reaction-style "
            "framing; warm desaturated palette; creator-native "
            "energy"
        ),
        "personality": (
            "Warm, quick, playful, creator-native. Talks like a "
            "TikTok or Reels host who actually understands the "
            "product — never reads from a script. Best for "
            "commentary-layer ads, reaction-style explainers, "
            "social hosts, and corner-spokesperson formats."
        ),
        "catchphrases": [
            "Wait — watch this.",
            "Okay so here's the part that surprised me.",
            "If you only catch one thing, catch this.",
        ],
        "voice_preset": "ruby",
        "metadata_role": (
            "creator-style social host"
        ),
        "metadata_use_case": (
            "TikTok / Reels commentary, corner-spokesperson ads, "
            "reaction / explainer formats"
        ),
    },
]


def _find_by_name(store: CharacterStore, name: str):
    target = name.strip().lower()
    for c in store.list():
        if (c.name or "").strip().lower() == target:
            return c
    return None


def _seed_one(store: CharacterStore, fixture: dict[str, Any]) -> dict[str, Any]:
    """Upsert a single fixture. Returns a small status dict for the
    caller's summary table.
    """
    name = fixture["name"]
    metadata = {
        "demo": True,
        "demo_persona": fixture["id"],
        "demo_role": fixture["metadata_role"],
        "demo_use_case": fixture["metadata_use_case"],
    }

    create_fields = {
        "template": fixture["template"],
        "subject": fixture["subject"],
        "style": fixture["style"],
        "personality": fixture["personality"],
        "catchphrases": list(fixture["catchphrases"]),
        "voice_preset": fixture["voice_preset"],
    }

    existing = _find_by_name(store, name)
    if existing:
        # Idempotent path: refresh fields on the existing record
        # but DO NOT clear voice clones / avatars / portraits the
        # operator may have generated. Only patch the
        # demo-defined columns + the demo metadata flag.
        store.update(existing.id, metadata=metadata, **create_fields)
        return {
            "name": name,
            "id": existing.id,
            "action": "updated",
        }

    payload = CharacterCreate(name=name, **create_fields)
    record = store.create(payload)
    # CharacterCreate doesn't accept metadata; backfill it via the
    # store's generic update helper.
    store.update(record.id, metadata=metadata)
    return {
        "name": name,
        "id": record.id,
        "action": "created",
    }


def main() -> int:
    store = CharacterStore(DATA_DIR)

    print(f"[seed] data dir: {DATA_DIR}")
    print(f"[seed] characters before: {len(store.list())}")

    results: list[dict[str, Any]] = []
    for fixture in DEMO_SPOKESPEOPLE:
        results.append(_seed_one(store, fixture))

    print()
    print(f"[seed] characters after: {len(store.list())}")
    print()
    print(f"{'name':<22} {'id':<14} {'action'}")
    print(f"{'-' * 22} {'-' * 14} {'------'}")
    for r in results:
        print(f"{r['name']:<22} {r['id']:<14} {r['action']}")
    print()
    print("[seed] no Runway calls fired — portraits left blank.")
    print(
        "[seed] click 'Generate Portrait' inside the app to render "
        "each face when ready."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
