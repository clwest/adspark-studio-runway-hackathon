#!/usr/bin/env python3
"""PR CH — Demo Campaign Fixtures.

Idempotent seeder for the four canonical demo campaigns that
back the v2 product narrative — one per spokesperson seeded
by ``scripts/seed-demo-spokespeople.py`` (PR CG):

    Brewster Bolt   → CEO Buzz · Energy Drink Launch
    Clara Vale      → AdSpark Studio · Persistent AI Spokesperson Platform
    Rex Roadside    → Freedom Ford · F-150 / Ranger truck spotlight
    Mina Spark      → Spark Social · Corner-spokesperson commentary

Each campaign lands as a **draft** — brief / business / product /
audience / tone / runway_prompt / selected_concept / social_post /
commercial_script all filled with purposeful copy, but
**zero cached outputs**. Operators run Generate Real Cinematic
/ Spokesperson Ad / Plan Dialogue inside the workspace to fill
those out per Runway-burning click.

Run from repo root:

    python scripts/seed-demo-campaigns.py

The script is **safe to re-run**:
- Match key: ``(character_id, business)`` pair.
- Existing demo campaigns get their brief / concept / prompt /
  script / social_post fields refreshed.
- Operator-generated outputs (cached_video_url, host_video_url,
  voiced_commercial_url, storyboard fields, dialogue fields,
  reels, host_clip_audio_url, runway_task_id, etc.) are
  **never** cleared.
- Existing user campaigns (anything not matching a demo
  spokesperson by character_id) are **never** touched.
- ``Campaign`` model has no metadata field, so demo flagging
  uses the ``character_id``-keyed match instead.

Spokesperson lookup: case-insensitive name match against the
existing characters list. If a demo spokesperson hasn't been
seeded yet (PR CG hasn't run), the corresponding campaign is
skipped with a warning — operators run the spokespeople
seeder first.

No Runway calls fire. No portraits, no avatars, no media.
"""

from __future__ import annotations

import json
import os
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

# Same chdir + sys.path trick as the spokespeople seeder so
# imports + Settings.data_path resolve to backend/data/.
REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))
os.chdir(BACKEND_ROOT)

from app.models import (  # noqa: E402
    AdConcept,
    Campaign,
    CampaignCreate,
    CampaignSocialPost,
)
from app.services.character_store import CharacterStore  # noqa: E402
from app.services.storage import CampaignStore  # noqa: E402

DATA_DIR = BACKEND_ROOT / "data"


# Static fixture set — one per demo spokesperson. The
# `spokesperson_name` field is the case-insensitive lookup
# key against the character store; the script will skip a
# fixture (printing a warning) if no matching spokesperson
# exists yet.
DEMO_CAMPAIGNS: list[dict[str, Any]] = [
    {
        "key": "brewster-bolt-ceo-buzz",
        "spokesperson_name": "Brewster Bolt",
        "business": "CEO Buzz",
        "product": "Dumpster-to-CEO Energy Drink",
        "audience": (
            "founders, creators, hustlers, social media viewers"
        ),
        "tone": "loud, funny, high-energy",
        "intended_modes": ["spokesperson", "reels", "cinematic"],
        "selected_concept": {
            "title": "Brewster Bolt × CEO Buzz · 3AM Founder Mode",
            "hook": (
                "When the inbox is full and the runway is empty, "
                "Brewster cracks open the dumpster-to-CEO can."
            ),
            "visual": (
                "Fast-cut close-ups of Brewster slamming the can on "
                "the desk, side-eye to the camera, neon kitchen "
                "light, founder's chaos in the background."
            ),
            "caption": (
                "Founder fuel. Loud, funny, no apologies."
            ),
            "cta": "Crack one open →",
        },
        "runway_prompt": (
            "Brewster Bolt slams a can of CEO Buzz energy drink on "
            "a cluttered desk at 3 AM, looks straight at camera, "
            "cocky grin. Punchy fast-cut social ad style. Neon "
            "accent lighting, kinetic camera moves, high contrast."
        ),
        "commercial_script": (
            "Three a.m. The inbox? Demolished. The runway? "
            "Vapor. But the can is full — and so am I. "
            "CEO Buzz: founder fuel. One click, you're in."
        ),
        "social_post": {
            "caption": (
                "Founder fuel — CEO Buzz × Brewster Bolt. "
                "When the runway runs out, the can stays loud."
            ),
            "cta": "Crack one open →",
            "hashtags": ["#CEOBuzz", "#FounderFuel", "#AdSparkStudio"],
        },
    },
    {
        "key": "clara-vale-adspark-platform",
        "spokesperson_name": "Clara Vale",
        "business": "AdSpark Studio",
        "product": "Persistent AI Spokesperson Platform",
        "audience": (
            "small businesses, agencies, founders, dealerships"
        ),
        "tone": "polished, strategic, trustworthy",
        "intended_modes": ["cinematic", "spokesperson", "realtime"],
        "selected_concept": {
            "title": "Clara Vale × AdSpark · Persistent Spokespeople",
            "hook": (
                "One brand voice. Every campaign. Every channel. "
                "Without re-casting."
            ),
            "visual": (
                "Studio-lit founder framing, calm desk shot, "
                "subtle cuts to product UI showing the same "
                "spokesperson across cinematic / spokesperson "
                "ad / realtime conversation surfaces."
            ),
            "caption": (
                "AdSpark turns one spokesperson into a portfolio "
                "of campaigns — without losing the brand voice."
            ),
            "cta": "See how it works →",
        },
        "runway_prompt": (
            "Clara Vale, polished founder, sits at a clean modern "
            "desk in a calm studio. Speaks directly to camera "
            "about the AdSpark platform. Soft natural light, "
            "neutral palette with one brand accent, restrained "
            "motion, trustworthy gaze."
        ),
        "commercial_script": (
            "Most brands rebuild their spokesperson every "
            "campaign. AdSpark doesn't. We give you one persistent "
            "AI spokesperson — same face, same voice, same brand — "
            "across cinematic ads, talking-head spots, and live "
            "conversations. Here's how it works."
        ),
        "social_post": {
            "caption": (
                "Persistent AI spokespeople — one voice across "
                "every campaign. AdSpark Studio."
            ),
            "cta": "See how it works →",
            "hashtags": [
                "#AdSparkStudio",
                "#AIspokesperson",
                "#BrandConsistency",
            ],
        },
    },
    {
        "key": "rex-roadside-freedom-ford",
        "spokesperson_name": "Rex Roadside",
        "business": "Freedom Ford",
        "product": "F-150 / Ranger truck spotlight",
        "audience": (
            "local truck buyers, contractors, families"
        ),
        "tone": "practical, helpful, no-pressure",
        "intended_modes": ["spokesperson", "dialogue", "reels"],
        "selected_concept": {
            "title": "Rex Roadside × Freedom Ford · Walk it With Me",
            "hook": (
                "No pressure. No payment math you can't follow. "
                "Just Rex, the truck, and a quick walkaround."
            ),
            "visual": (
                "Natural daylight on the lot. Rex leans on the "
                "tailgate, points to the bed, opens the cab. "
                "Cuts to spec callouts and a clean payment "
                "summary card."
            ),
            "caption": (
                "Walk it with Rex. The numbers make sense when "
                "the truck does."
            ),
            "cta": "Drive it this weekend →",
        },
        "runway_prompt": (
            "Rex Roadside, friendly automotive salesperson in a "
            "casual flannel, leans on the tailgate of a Ford "
            "F-150 on a sunny dealership lot. Mid-shot, talks "
            "to camera with practical confidence, no pressure. "
            "Natural daylight, weather-worn but cared-for look."
        ),
        "commercial_script": (
            "Most truck ads yell at you. I'd rather just walk "
            "the lot with you. F-150 stick shift, payment laid "
            "out plain, no surprises. If it ain't right for "
            "you, we keep looking. Freedom Ford."
        ),
        "social_post": {
            "caption": (
                "Walk the lot with Rex. F-150 spotlight at "
                "Freedom Ford — straight talk, real numbers."
            ),
            "cta": "Drive it this weekend →",
            "hashtags": ["#FreedomFord", "#F150", "#WalkItWithMe"],
        },
    },
    {
        "key": "mina-spark-spark-social",
        "spokesperson_name": "Mina Spark",
        "business": "Spark Social",
        "product": "Corner-spokesperson commentary ads",
        "audience": (
            "creators, local brands, social media managers"
        ),
        "tone": "playful, creator-native, quick",
        "intended_modes": ["reels", "dialogue", "corner-commentary"],
        "selected_concept": {
            "title": "Mina Spark × Spark Social · Corner Commentary",
            "hook": (
                "Brand video plays full-screen. Mina reacts in "
                "the corner. Suddenly the ad is content."
            ),
            "visual": (
                "Vertical 9:16 frame. Brand product shot fills "
                "the background; Mina sits in the bottom-right "
                "corner reacting in real time. Quick cuts on "
                "her best lines. Creator-native energy."
            ),
            "caption": (
                "If you only catch one thing, catch this — Mina "
                "reviews your ad while it plays."
            ),
            "cta": "Watch the corner →",
        },
        "runway_prompt": (
            "Mina Spark, warm and playful creator-style host, "
            "delivers a quick reaction-style commentary in "
            "vertical framing. Casual streetwear, expressive "
            "face, natural mixed lighting, warm desaturated "
            "palette, creator-native quick-cut energy."
        ),
        "commercial_script": (
            "Okay so wait — watch this. Most ads talk AT you. "
            "Spark Social runs the ad full-screen and lets a "
            "real spokesperson react in the corner. Suddenly "
            "the ad's content. Wild, right?"
        ),
        "social_post": {
            "caption": (
                "Corner commentary ads — your brand plays, Mina "
                "reacts. Spark Social."
            ),
            "cta": "Watch the corner →",
            "hashtags": [
                "#SparkSocial",
                "#CreatorAds",
                "#CornerCommentary",
            ],
        },
    },
]


def _find_character(store: CharacterStore, name: str):
    target = name.strip().lower()
    for c in store.list():
        if (c.name or "").strip().lower() == target:
            return c
    return None


def _find_existing(
    rows: list[dict[str, Any]],
    character_id: str,
    business: str,
) -> Optional[dict[str, Any]]:
    biz = (business or "").strip().lower()
    for row in rows:
        if (
            row.get("character_id") == character_id
            and (row.get("business") or "").strip().lower() == biz
        ):
            return row
    return None


def _build_payload(
    fixture: dict[str, Any],
) -> CampaignCreate:
    """Assemble a CampaignCreate from a fixture dict."""
    concept = AdConcept(**fixture["selected_concept"])
    social = CampaignSocialPost(**fixture["social_post"])
    return CampaignCreate(
        business=fixture["business"],
        product=fixture["product"],
        tone=fixture["tone"],
        audience=fixture["audience"],
        selected_concept=concept,
        runway_prompt=fixture["runway_prompt"],
        commercial_script=fixture["commercial_script"],
        social_post=social,
    )


def _seed_one(
    campaign_store: CampaignStore,
    character_store: CharacterStore,
    fixture: dict[str, Any],
) -> dict[str, Any]:
    """Upsert a single demo campaign. Returns a status dict."""
    spokesperson_name = fixture["spokesperson_name"]
    character = _find_character(character_store, spokesperson_name)
    if not character:
        return {
            "key": fixture["key"],
            "business": fixture["business"],
            "spokesperson": spokesperson_name,
            "action": "skipped (spokesperson not seeded)",
        }

    payload = _build_payload(fixture)

    # Idempotency: read campaigns.json directly so we can match
    # by (character_id, business) and patch fields in place.
    rows = campaign_store._read()  # type: ignore[attr-defined]
    existing = _find_existing(rows, character.id, fixture["business"])

    if existing:
        # Refresh ONLY the demo-defined columns. Operator-
        # generated outputs (cached_video_url, host_video_url,
        # voiced_commercial_url, host_task_id, runway_task_id,
        # storyboard_*, dialogue_*, *_reels_url) are NOT
        # touched.
        existing["business"] = payload.business
        existing["product"] = payload.product
        existing["audience"] = payload.audience
        existing["tone"] = payload.tone
        existing["selected_concept"] = json.loads(
            payload.selected_concept.model_dump_json()
        )
        existing["runway_prompt"] = payload.runway_prompt
        existing["commercial_script"] = payload.commercial_script
        existing["social_post"] = json.loads(
            payload.social_post.model_dump_json()
        )
        # Pin the character_id (in case a previous run used a
        # different demo character that was since renamed).
        existing["character_id"] = character.id
        # Persist via the store's atomic _write so we keep the
        # tmp-then-rename safety pattern.
        campaign_store._write(rows)  # type: ignore[attr-defined]
        return {
            "key": fixture["key"],
            "business": fixture["business"],
            "spokesperson": spokesperson_name,
            "campaign_id": existing["id"],
            "character_id": character.id,
            "action": "updated",
        }

    # Create path: build a fresh Campaign record. We do this by
    # constructing a Campaign (extends CampaignCreate) ourselves
    # rather than calling store.create() because store.create()
    # doesn't accept character_id (it's set post-create via
    # update_character_attachment). Hand-rolling keeps the
    # character_id link atomic and skips the round-trip.
    now = datetime.now(timezone.utc)
    record = Campaign(
        id=uuid.uuid4().hex[:12],
        created_at=now,
        commercial_script_updated_at=now if payload.commercial_script else None,
        character_id=character.id,
        **payload.model_dump(),
    )
    rows.insert(0, json.loads(record.model_dump_json()))
    campaign_store._write(rows)  # type: ignore[attr-defined]
    return {
        "key": fixture["key"],
        "business": fixture["business"],
        "spokesperson": spokesperson_name,
        "campaign_id": record.id,
        "character_id": character.id,
        "action": "created",
    }


def main() -> int:
    character_store = CharacterStore(DATA_DIR)
    campaign_store = CampaignStore(DATA_DIR)

    print(f"[seed] data dir: {DATA_DIR}")
    print(f"[seed] characters before: {len(character_store.list())}")
    print(f"[seed] campaigns  before: {len(campaign_store.list())}")

    results: list[dict[str, Any]] = []
    for fixture in DEMO_CAMPAIGNS:
        results.append(_seed_one(campaign_store, character_store, fixture))

    print()
    print(f"[seed] campaigns after:   {len(campaign_store.list())}")
    print()
    print(f"{'spokesperson':<22} {'business':<22} {'campaign id':<14} {'action'}")
    print(f"{'-' * 22} {'-' * 22} {'-' * 14} {'-' * 30}")
    for r in results:
        print(
            f"{r['spokesperson']:<22} "
            f"{r['business']:<22} "
            f"{r.get('campaign_id', '—'):<14} "
            f"{r['action']}"
        )
    print()
    print("[seed] no Runway calls fired — outputs left blank.")
    print(
        "[seed] open /spokespeople/{id} → Campaigns tab to "
        "render real cinematic / spokesperson / dialogue assets."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
