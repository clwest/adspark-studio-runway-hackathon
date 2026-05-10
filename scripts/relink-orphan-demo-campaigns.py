#!/usr/bin/env python3
"""PR CO — Relink orphaned demo campaigns to live demo spokespeople.

SESSION 070 manual QA found that ``backend/data/campaigns.json``
holds several campaigns whose ``character_id`` references a
character record that no longer exists in
``backend/data/characters.json``. Those campaigns are
"orphans" — invisible to the v2 spokesperson workspace
because no living tile owns them, even though they often
carry valuable cached outputs (cinematic / host / voiced
mp4s).

This script repairs the link **by business name** for the
four canonical demo businesses:

    CEO Buzz        → Brewster Bolt
    AdSpark Studio  → Clara Vale
    Freedom Ford    → Rex Roadside
    Spark Social    → Mina Spark

Anything else (FocusNet, ad-hoc user campaigns, the
"Local coffee shop" PR-A test rows) is left untouched.

The script preserves every output URL field on the
matched campaign — ``cached_video_url`` /
``host_video_url`` / ``voiced_commercial_url`` /
``storyboard_video_url`` / ``storyboard_voiced_url`` /
``dialogue_scene_video_url`` / ``spokesperson_reels_url``
/ ``dialogue_scene_reels_url`` plus their status fields —
so the operator's pre-PR CO generated assets reattach
to the correct spokesperson without needing to re-render.

Idempotency:
- Runs are repeatable. If a campaign is already linked to
  the correct live demo character_id, the script logs it
  as ``ok`` and writes nothing.
- A campaign whose ``character_id`` is alive but does not
  match the demo mapping is left alone.
- Non-demo businesses are skipped.

Run from repo root **after** ``seed-demo-spokespeople.py``:

    python scripts/seed-demo-spokespeople.py
    python scripts/relink-orphan-demo-campaigns.py
    python scripts/seed-demo-campaigns.py    # optional refresh
"""

from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
BACKEND_ROOT = REPO_ROOT / "backend"
sys.path.insert(0, str(BACKEND_ROOT))
os.chdir(BACKEND_ROOT)

from app.services.character_store import CharacterStore  # noqa: E402
from app.services.storage import CampaignStore  # noqa: E402

DATA_DIR = BACKEND_ROOT / "data"


# Map: case-insensitive business → spokesperson name.
DEMO_BUSINESS_TO_SPOKESPERSON: dict[str, str] = {
    "ceo buzz": "Brewster Bolt",
    "adspark studio": "Clara Vale",
    "freedom ford": "Rex Roadside",
    "spark social": "Mina Spark",
}


def main() -> int:
    char_store = CharacterStore(DATA_DIR)
    camp_store = CampaignStore(DATA_DIR)

    live_characters = char_store.list()
    live_ids: set[str] = {c.id for c in live_characters}
    name_to_id: dict[str, str] = {
        (c.name or "").strip().lower(): c.id for c in live_characters
    }

    # Resolve demo target ids up front. Skip a business if its
    # demo spokesperson hasn't been seeded yet.
    demo_targets: dict[str, str] = {}
    for business, name in DEMO_BUSINESS_TO_SPOKESPERSON.items():
        target_id = name_to_id.get(name.strip().lower())
        if target_id:
            demo_targets[business] = target_id
        else:
            print(
                f"[relink] WARN: no live spokesperson for "
                f"'{name}' — campaigns with business='{business}' "
                f"will be left as-is."
            )

    rows: list[dict[str, Any]] = camp_store._read()  # type: ignore[attr-defined]

    relinked: list[dict[str, Any]] = []
    already_ok: list[dict[str, Any]] = []
    skipped_orphans: list[dict[str, Any]] = []

    for row in rows:
        cid = row.get("character_id")
        biz = (row.get("business") or "").strip().lower()
        target = demo_targets.get(biz)

        if not target:
            # Either non-demo business, or its demo target is
            # missing. Don't touch.
            continue

        if cid == target:
            already_ok.append(row)
            continue

        if cid and cid in live_ids:
            # Linked to a living non-demo spokesperson — operator
            # may have intentionally repurposed the row. Leave alone.
            print(
                f"[relink] SKIP {row['id'][:8]} biz='{row.get('business')}' "
                f"already linked to live char {cid[:8]} (not the demo target)"
            )
            continue

        # Orphan or no link → repoint to demo target.
        old = cid
        row["character_id"] = target
        relinked.append(
            {
                "campaign_id": row["id"],
                "business": row.get("business"),
                "old_character_id": old,
                "new_character_id": target,
            }
        )
        if not old:
            skipped_orphans.append(row)

    if relinked:
        camp_store._write(rows)  # type: ignore[attr-defined]

    print()
    print(f"[relink] data dir: {DATA_DIR}")
    print(f"[relink] live characters: {len(live_characters)}")
    print(f"[relink] campaigns total:  {len(rows)}")
    print()
    print(f"{'campaign':<10} {'business':<20} {'old':<14} → {'new':<14} {'action'}")
    print(f"{'-' * 10} {'-' * 20} {'-' * 14}   {'-' * 14} {'------'}")
    for r in relinked:
        old = (r["old_character_id"] or "—")[:12]
        print(
            f"{r['campaign_id'][:8]:<10} "
            f"{r['business'] or '—':<20} "
            f"{old:<14} → {r['new_character_id'][:12]:<14} relinked"
        )
    for r in already_ok:
        print(
            f"{r['id'][:8]:<10} "
            f"{(r.get('business') or '—'):<20} "
            f"{(r.get('character_id') or '—')[:12]:<14}   "
            f"{'(unchanged)':<14} ok"
        )
    print()
    print(f"[relink] relinked: {len(relinked)}")
    print(f"[relink] already ok: {len(already_ok)}")
    print()
    print("[relink] no Runway calls fired. Output URLs preserved.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
