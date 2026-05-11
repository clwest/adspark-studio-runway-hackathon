#!/usr/bin/env python3
"""PR DN — Seed submission-video demo content for Character OS.

One-command, demo-safe way to populate the three existing
hackathon spokespeople (Donny Sparks / Riggs Rally / Miles Monroe)
with the knowledge sources, campaigns, ad variants, and scripts
needed for the submission video. Idempotent — safe to re-run.

The script never:
- Fires Runway calls (every write goes through local-only routes:
  ``/knowledge``, ``/campaigns``, ``/ad-variant``).
- Overwrites existing media (videos, rendered MP4s, output history).
- Touches `/legacy` or any character outside the three demo names.
- Creates duplicate knowledge sources / campaigns / variants — see
  the idempotency rules below.

## Usage

    # Dry-run preview (no HTTP writes):
    python scripts/seed-submission-demo-content.py --dry-run

    # Apply against the running backend:
    python scripts/seed-submission-demo-content.py

    # Against a non-default backend:
    python scripts/seed-submission-demo-content.py \\
        --base-url http://localhost:9000

## Idempotency

- **Knowledge sources** — checked by `title` (case-sensitive) on
  the character's existing `knowledge_sources[]`. Skip if present.
- **Campaigns** — checked by `business` (case-sensitive) on the
  campaigns linked to that character. Skip if present, reuse the
  existing campaign id for the variant step.
- **Ad variants** — checked by `title` (case-sensitive) on the
  campaign's `ad_variants[]`. Skip if present.

Output prints `created` vs `skipped` per item so a second run reads
as "skipped knowledge ... skipped campaign ... skipped variant"
across the board, proving idempotency.

## Submission narrative

The three spokespeople form a small team:

- **Donny Sparks** — creative campaign lead / product hype.
- **Riggs Rally** — chaotic builder / dev workflow / context-kit
  explainer.
- **Miles Monroe** — business strategist / value proposition.

Each gets one knowledge source, one campaign, and one ad variant.
Each script fits under the 300-char Runway `avatar_videos` cap so
the operator can hit Render Line / Render Spokesperson Ad without
truncation.
"""
from __future__ import annotations

import argparse
import json
import sys
import urllib.error
import urllib.request

# Submission ad scripts must fit the 300-char `avatar_videos` cap.
SCRIPT_MAX_CHARS = 300


CHARACTER_NAMES = ["Donny Sparks", "Riggs Rally", "Miles Monroe"]


SEED = {
    "Donny Sparks": {
        "role": "creative campaign lead / product hype",
        "knowledge": {
            "title": "Creative Campaign Builder",
            "source_type": "brand_note",
            "content": (
                "Donny explains Character OS as a platform for "
                "creating persistent AI spokespeople, ad variants, "
                "campaign videos, media history, and fast creative "
                "iteration."
            ),
        },
        "campaign": {
            "business": "Character OS Creates Reusable AI Ads",
            "product": (
                "Character OS turns persistent AI spokespeople "
                "into reusable campaign videos, ad variants, and "
                "media assets."
            ),
            "audience": "creators, startups, small businesses, agencies",
            "tone": "energetic, clever, startup-focused",
        },
        "variant": {
            "title": "Submission · Reusable AI Ads",
            "script": (
                "Most AI ads feel like one-off experiments. "
                "Character OS gives your brand persistent "
                "spokespeople, reusable campaigns, saved videos, "
                "and ad variants you can keep building on instead "
                "of starting over every time."
            ),
            # PR DO — long-form variant for the multi-chunk render
            # pipeline. ~950 chars: introduce, role, Character OS
            # angle, closer. Chunks at ~280 chars → 4 clips,
            # estimated ~63s of audio.
            "long_script": (
                "Hi, I'm Donny Sparks. I'm the creative voice on "
                "the Character OS team — the one nudging us to "
                "build campaigns that don't sound like every other "
                "AI ad on the timeline. Here's the problem with "
                "most AI ads today: they feel like one-off "
                "experiments. A founder fires up a prompt, gets "
                "one clip, ships it, then starts over from scratch "
                "when the next campaign rolls in. Character OS "
                "flips that. You build a persistent spokesperson — "
                "me, for example — and the same character ships ad "
                "variant after ad variant. The brief stays stable. "
                "The voice stays consistent. The reusable creative "
                "infrastructure compounds. So when a startup needs "
                "ten ads this quarter, they're not running ten "
                "separate prompts. They're directing one trusted "
                "character through ten campaigns. That's the "
                "difference between AI ad chaos and AI ad continuity."
            ),
        },
    },
    "Riggs Rally": {
        "role": "chaotic builder / dev workflow / context-kit explainer",
        "knowledge": {
            "title": "Hackathon Build Process",
            "source_type": "brand_note",
            "content": (
                "Riggs explains that context-kit is a separate "
                "build-time tool that helped AI coding sessions "
                "stay aligned while building Character OS. It is "
                "not the runtime memory of the spokespeople."
            ),
        },
        "campaign": {
            "business": "How We Built Character OS",
            "product": (
                "Character OS was built during a hackathon using "
                "AI coding sessions coordinated through context-kit."
            ),
            "audience": "builders, hackers, AI developers, technical founders",
            "tone": "witty, technical, fast-moving",
        },
        "variant": {
            "title": "Submission · Build Story",
            "script": (
                "This hackathon build was not one giant prompt. "
                "Character OS came together through AI coding "
                "sessions, context-kit handoffs, and a lot of fast "
                "testing. The result is a team of AI spokespeople "
                "explaining the system they helped create."
            ),
            # PR DO — long-form variant. Explicit context-kit /
            # Character OS distinction so the realtime grounding
            # stays consistent with the curated self-demo doc.
            "long_script": (
                "I'm Riggs Rally. I rode shotgun on the chaotic "
                "build that turned into Character OS. Here's what "
                "actually happened. The hackathon spanned dozens "
                "of AI coding sessions — Claude Code, Cursor, the "
                "usual suspects. Without something keeping all "
                "those sessions aligned, every new conversation "
                "would have re-derived the design and undone "
                "whatever the last one decided. That's where "
                "context-kit came in. context-kit is a separate "
                "dev-time tool — a memory protocol for AI coding "
                "sessions. It uses anchor files plus per-session "
                "handoffs so every new AI session inherits the "
                "current state of the project in about ninety "
                "seconds. To be clear: context-kit is the build "
                "scaffolding. It is not the runtime memory for "
                "Character OS spokespeople. The spokespeople have "
                "their own grounding documents and knowledge "
                "sources — separate system. The point of "
                "explaining all that is: one person plus a team of "
                "AI characters plus the right scaffolding got us "
                "here in a single sprint."
            ),
        },
    },
    "Miles Monroe": {
        "role": "business strategist / value proposition",
        "knowledge": {
            "title": "Business Value of Persistent Spokespeople",
            "source_type": "brand_note",
            "content": (
                "Miles explains why companies, agencies, "
                "dealerships, creators, and local businesses "
                "benefit from reusable AI spokespeople, consistent "
                "messaging, and campaign continuity."
            ),
        },
        "campaign": {
            "business": "Why Businesses Need Persistent Spokespeople",
            "product": (
                "Character OS helps companies build reusable AI "
                "representatives that can explain products, create "
                "campaign content, and stay consistent over time."
            ),
            "audience": "business owners, consultants, dealerships, agencies",
            "tone": "calm, strategic, trustworthy",
        },
        "variant": {
            "title": "Submission · Business Value",
            "script": (
                "Companies do not need more random content. They "
                "need consistent voices that can explain, sell, "
                "and show up across campaigns. Character OS turns "
                "AI spokespeople into reusable creative "
                "infrastructure."
            ),
            # PR DO — long-form variant focusing on the unit-economics
            # case for persistent brand characters.
            "long_script": (
                "I'm Miles Monroe. I think about Character OS the "
                "way a strategist thinks about brand voice — "
                "slowly, deliberately, with an eye on the next "
                "twelve months. Here's the business case. "
                "Companies do not need more random AI content. "
                "They need consistent voices that can explain a "
                "product, sell an offer, and show up across "
                "campaigns without sounding like a different brand "
                "every quarter. Today that's almost impossible. "
                "Agencies turn over creative leads, AI tools "
                "generate one-off clips that don't reference each "
                "other, and brand drift sets in within weeks. "
                "Character OS turns AI spokespeople into reusable "
                "creative infrastructure. You build a character "
                "once — face, voice, knowledge, tone — and that "
                "character carries the brand across every ad "
                "variant, every dialogue scene, every realtime "
                "conversation. For a dealership, that means one "
                "trusted face explaining ten promotions. For a "
                "creator economy startup, that means a founder "
                "avatar that never gets tired, never goes "
                "off-message, and never has to re-record. The unit "
                "economics shift. The continuity gets real."
            ),
        },
    },
}


def _request_json(
    base_url: str,
    path: str,
    method: str = "GET",
    body: dict | None = None,
    timeout: float = 15.0,
) -> dict:
    """Tiny JSON helper. Raises urllib.error.HTTPError on non-2xx
    so the caller can surface the wire response cleanly."""
    url = f"{base_url.rstrip('/')}{path}"
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(
        url,
        data=data,
        method=method,
        headers={"Content-Type": "application/json"} if data else {},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    return json.loads(raw) if raw else {}


def _find_character(characters: list[dict], name: str) -> dict | None:
    """Case-sensitive name match against the live character list.
    Returns the full character record (with knowledge_sources etc)
    or None when missing."""
    target = name.strip()
    return next(
        (c for c in characters if (c.get("name") or "").strip() == target),
        None,
    )


def _find_campaign_by_business(campaigns: list[dict], business: str) -> dict | None:
    target = business.strip()
    return next(
        (
            c for c in campaigns
            if (c.get("business") or "").strip() == target
        ),
        None,
    )


def _knowledge_titles(character: dict) -> set[str]:
    return {
        (s.get("title") or "").strip()
        for s in (character.get("knowledge_sources") or [])
    }


def _variant_titles(campaign: dict) -> set[str]:
    return {
        (v.get("title") or "").strip()
        for v in (campaign.get("ad_variants") or [])
    }


def seed_character(
    base_url: str,
    character: dict,
    plan: dict,
    *,
    dry_run: bool,
) -> dict:
    """Run the three idempotent writes (knowledge / campaign /
    variant) for one character. Returns a summary dict with the
    created / skipped counts + the resolved campaign + variant ids."""
    cid = character["id"]
    cname = character["name"]
    summary: dict = {
        "character_name": cname,
        "character_id": cid,
        "knowledge": {"action": "skipped", "reason": "exists"},
        "campaign": {"action": "skipped", "reason": "exists", "id": None},
        "variant": {"action": "skipped", "reason": "exists", "id": None},
    }

    # --- Knowledge source ----------------------------------------
    k = plan["knowledge"]
    existing_titles = _knowledge_titles(character)
    if k["title"] in existing_titles:
        summary["knowledge"]["action"] = "skipped"
    elif dry_run:
        summary["knowledge"] = {"action": "would_create", "title": k["title"]}
    else:
        _request_json(
            base_url,
            f"/api/characters/{cid}/knowledge",
            method="POST",
            body={
                "title": k["title"],
                "source_type": k["source_type"],
                "content": k["content"],
            },
        )
        summary["knowledge"] = {"action": "created", "title": k["title"]}

    # --- Campaign ------------------------------------------------
    p = plan["campaign"]
    # Find campaigns linked to this character.
    list_resp = _request_json(
        base_url, f"/api/campaigns?character_id={cid}",
    )
    campaigns_list = (
        list_resp.get("campaigns", list_resp)
        if isinstance(list_resp, dict)
        else list_resp
    )
    existing_campaign = _find_campaign_by_business(campaigns_list, p["business"])
    campaign_id = None
    if existing_campaign:
        campaign_id = existing_campaign["id"]
        summary["campaign"] = {
            "action": "skipped",
            "reason": "exists",
            "id": campaign_id,
        }
    elif dry_run:
        summary["campaign"] = {"action": "would_create", "business": p["business"]}
    else:
        # Build the minimum CampaignCreate body the v2 lane uses;
        # mirrors `CampaignLanes.handleCreateCampaign` exactly.
        biz = p["business"].strip()
        product = p["product"].strip()
        audience = p["audience"].strip()
        tone = p["tone"].strip()
        payload = {
            "business": biz,
            "product": product,
            "audience": audience,
            "tone": tone,
            "selected_concept": {
                "title": biz,
                "hook": audience or f"Meet {biz}.",
                "visual": product or biz,
                "caption": product or biz,
                "cta": "Learn more",
            },
            "runway_prompt": (
                f"A polished commercial visual for {biz}"
                + (f" featuring {product}" if product else "")
                + "."
            ),
            "social_post": {
                "caption": product or biz,
                "cta": "Learn more",
                "hashtags": [],
            },
        }
        created = _request_json(
            base_url, "/api/campaigns", method="POST", body=payload,
        )
        campaign_id = created.get("id")
        # Attach character so the workspace sees this campaign in
        # the spokesperson's linked-campaigns list.
        _request_json(
            base_url,
            f"/api/campaigns/{campaign_id}/attach-character",
            method="POST",
            body={"character_id": cid},
        )
        summary["campaign"] = {
            "action": "created",
            "id": campaign_id,
            "business": biz,
        }

    # --- Ad variant ----------------------------------------------
    v = plan["variant"]
    if v["script"] and len(v["script"]) > SCRIPT_MAX_CHARS:
        # Guard rail — the brief promised <= 300 chars per script.
        # If a future edit overflows we want a loud failure.
        raise RuntimeError(
            f"variant script for {cname!r} is "
            f"{len(v['script'])} chars (cap {SCRIPT_MAX_CHARS}). Trim it."
        )
    if campaign_id is None:
        # Dry-run path where we haven't created a campaign — we
        # know the variant would also be new, so mark accordingly.
        summary["variant"] = {
            "action": "would_create",
            "title": v["title"],
            "campaign_id": None,
        }
    else:
        # Pull the campaign back so we can check existing variants
        # (created campaigns return their fresh shape with empty
        # `ad_variants`; existing campaigns may already have
        # variants).
        camp = _request_json(
            base_url, f"/api/campaigns?character_id={cid}",
        )
        camp_list = (
            camp.get("campaigns", camp) if isinstance(camp, dict) else camp
        )
        target_campaign = next(
            (c for c in camp_list if c.get("id") == campaign_id), None,
        )
        existing_variants = (
            _variant_titles(target_campaign) if target_campaign else set()
        )
        if v["title"] in existing_variants:
            if target_campaign is None:
                existing_ad_variants: list[dict] = []
            else:
                existing_ad_variants = target_campaign.get("ad_variants") or []
            existing_variant = next(
                (
                    x for x in existing_ad_variants
                    if (x.get("title") or "").strip() == v["title"]
                ),
                None,
            )
            existing_variant_id = (
                existing_variant.get("id") if existing_variant else None
            )
            # PR DO — if the seed has a long_script and the existing
            # variant is missing one, patch it in. We never clobber
            # an already-set long_script (operator may have edited
            # it). Idempotency stays title-based for the variant
            # itself; long_script patch is one-shot fill.
            seed_long = v.get("long_script", "").strip() if v.get("long_script") else ""
            existing_long = (existing_variant.get("long_script") or "").strip() if existing_variant else ""
            if seed_long and not existing_long and existing_variant_id:
                if dry_run:
                    summary["variant"] = {
                        "action": "would_patch_long_script",
                        "reason": "missing_long_script",
                        "id": existing_variant_id,
                    }
                else:
                    _request_json(
                        base_url,
                        f"/api/campaigns/{campaign_id}/ad-variant",
                        method="POST",
                        body={
                            "id": existing_variant_id,
                            "title": v["title"],
                            "script": existing_variant.get("script", ""),
                            "long_script": seed_long,
                        },
                    )
                    summary["variant"] = {
                        "action": "patched_long_script",
                        "id": existing_variant_id,
                        "long_chars": len(seed_long),
                    }
            else:
                summary["variant"] = {
                    "action": "skipped",
                    "reason": "exists",
                    "id": existing_variant_id,
                }
        elif dry_run:
            summary["variant"] = {
                "action": "would_create",
                "title": v["title"],
                "campaign_id": campaign_id,
            }
        else:
            create_body = {
                "title": v["title"],
                "script": v["script"],
            }
            # PR DO — include long_script on initial create so the
            # variant lands with both fields populated in one shot.
            seed_long = v.get("long_script", "").strip() if v.get("long_script") else ""
            if seed_long:
                create_body["long_script"] = seed_long
            created_variant_campaign = _request_json(
                base_url,
                f"/api/campaigns/{campaign_id}/ad-variant",
                method="POST",
                body=create_body,
            )
            # Backend returns the updated Campaign. Newest variant
            # is at the head of `ad_variants` (PR DC ordering).
            new_var = next(
                (
                    x for x in (
                        created_variant_campaign.get("ad_variants") or []
                    )
                    if (x.get("title") or "").strip() == v["title"]
                ),
                None,
            )
            variant_id = new_var.get("id") if new_var is not None else None
            summary["variant"] = {
                "action": "created",
                "id": variant_id,
                "title": v["title"],
                "campaign_id": campaign_id,
            }

    return summary


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(
        description=(
            "Seed Donny / Riggs / Miles with submission-video "
            "knowledge sources, campaigns, and ad variants. "
            "Idempotent — safe to re-run."
        ),
    )
    parser.add_argument(
        "--base-url", default="http://localhost:8000",
        help="Backend base URL (default: http://localhost:8000).",
    )
    parser.add_argument(
        "--dry-run", action="store_true",
        help="Print would-create / skip decisions without writing.",
    )
    args = parser.parse_args(argv)

    # Fetch the full character list once and reuse it.
    try:
        list_resp = _request_json(args.base_url, "/api/characters")
    except urllib.error.URLError as exc:
        print(f"Could not reach {args.base_url}: {exc}", file=sys.stderr)
        return 1
    characters = (
        list_resp.get("characters", list_resp)
        if isinstance(list_resp, dict)
        else list_resp
    )

    print("Character OS submission-video seed")
    print(f"  base_url: {args.base_url}")
    print(f"  mode:     {'dry-run' if args.dry_run else 'apply'}")
    print()

    missing: list[str] = []
    summaries: list[dict] = []
    for name in CHARACTER_NAMES:
        record = _find_character(characters, name)
        if record is None:
            missing.append(name)
            continue
        try:
            summary = seed_character(
                args.base_url, record, SEED[name], dry_run=args.dry_run,
            )
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8", errors="replace")
            print(
                f"HTTP error seeding {name}: {exc.code} {body[:200]}",
                file=sys.stderr,
            )
            return 1
        except RuntimeError as exc:
            print(f"Script error for {name}: {exc}", file=sys.stderr)
            return 1
        summaries.append(summary)

    # ---- pretty print summary ----
    created = 0
    skipped = 0
    would = 0
    for s in summaries:
        print(f"• {s['character_name']} ({s['character_id'][:8]})")
        for slot in ("knowledge", "campaign", "variant"):
            action = s[slot]["action"]
            label = {
                "created": "created",
                "skipped": "skipped",
                "would_create": "would-create (dry-run)",
            }.get(action, action)
            extra: list[str] = []
            if "title" in s[slot]:
                extra.append(f"title={s[slot]['title']!r}")
            if "business" in s[slot]:
                extra.append(f"business={s[slot]['business']!r}")
            if s[slot].get("id"):
                extra.append(f"id={s[slot]['id']}")
            extras = (" · " + " · ".join(extra)) if extra else ""
            print(f"    {slot}: {label}{extras}")
            if action == "created":
                created += 1
            elif action == "skipped":
                skipped += 1
            elif action == "would_create":
                would += 1

    print()
    if missing:
        print(f"⚠️  Missing characters (skipped entirely): {missing}")
        print(
            "    Create them via the homepage or "
            "`scripts/seed-demo-spokespeople.py` first."
        )
    print(
        f"Summary: created={created} · skipped={skipped} "
        f"· would-create={would}"
    )
    return 0 if not missing else 2


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
