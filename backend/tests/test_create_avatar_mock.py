"""PR CR — mock-mode pytest covering avatar creation from a freshly
generated portrait.

Why this test exists: avatar creation has historically been a quiet
failure surface. The flow has four moving parts (character record,
portrait file on disk, base64 data URI, /v1/avatars Runway call) and
breaking any one of them gets the operator a 502 with a generic
banner. This test pins the mock-mode contract so a regression in any
layer (route guard, store, service, response shape) trips CI rather
than hitting Chris in production.

Mock-mode is sufficient — the real-mode branch is exercised manually
via `POST /api/characters/{id}/create-avatar` against
`api.dev.runwayml.com`. The route + service code paths (portrait-
must-exist guard, payload assembly, persistence shape, error
surfacing) are identical between modes.
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterator

import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.main import app


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """TestClient with an isolated data dir + forced mock mode.

    Forced mock mode = empty `runway_api_key`; `Settings.runway_mock`
    derives from key presence (config.py line 42-43). The dependency
    override prevents the lru_cache from leaking real-mode settings
    in if the test runner has them in env.
    """
    settings = Settings(runway_api_key="", data_dir=str(tmp_path))
    app.dependency_overrides[get_settings] = lambda: settings
    yield TestClient(app)
    app.dependency_overrides.pop(get_settings, None)


def _create_character(client: TestClient, name: str = "Mock Donkey") -> dict:
    resp = client.post(
        "/api/characters",
        json={
            "name": name,
            "template": "mascot",
            "subject": "an anthropomorphic donkey marketing mascot",
            "voice_preset": "drew",
        },
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _generate_portrait(client: TestClient, character_id: str) -> dict:
    resp = client.post(
        f"/api/characters/{character_id}/generate-portrait",
        json={},
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def test_avatar_creation_from_existing_portrait(client: TestClient, tmp_path: Path):
    """Happy path: create character → generate portrait (mock) →
    create avatar (mock). Asserts persisted state + thumbnail shape.
    """
    char = _create_character(client)
    cid = char["id"]
    assert char["runway_avatar_id"] is None
    assert char["portrait_url"] is None

    portrait = _generate_portrait(client, cid)
    assert portrait["portrait_source"] == "mock"
    assert portrait["portrait_url"] == f"/api/characters/{cid}/portrait"
    assert portrait["portrait_prompt"], "mock-mode should still persist the resolved prompt"
    portrait_path = tmp_path / "characters" / f"{cid}-portrait.png"
    assert portrait_path.exists(), "mock portrait file should land on disk"
    assert portrait_path.stat().st_size > 0, "mock portrait file must not be empty"

    resp = client.post(f"/api/characters/{cid}/create-avatar", json={})
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["runway_avatar_status"] == "mock"
    assert body["runway_avatar_id"]
    assert body["runway_avatar_id"].startswith("mock_char_avatar_")
    assert body["runway_avatar_error"] is None
    # Thumbnail in mock mode = the cached portrait inlined as a data
    # URI so the workspace renders the same image immediately.
    assert body["runway_avatar_thumbnail_url"]
    assert body["runway_avatar_thumbnail_url"].startswith("data:image/png;base64,"), (
        f"mock thumbnail should be a data URI; got: {body['runway_avatar_thumbnail_url'][:60]}"
    )


def test_create_avatar_404_when_character_missing(client: TestClient):
    resp = client.post("/api/characters/nope-not-real/create-avatar", json={})
    assert resp.status_code == 404
    assert "not found" in resp.json()["detail"].lower()


def test_create_avatar_409_when_portrait_missing(client: TestClient):
    """The route must refuse avatar creation if no portrait file
    exists on disk for the character. Without this guard we'd hand
    Runway an empty referenceImage and get a generic 400 back."""
    char = _create_character(client, name="Bare Donkey")
    cid = char["id"]
    resp = client.post(f"/api/characters/{cid}/create-avatar", json={})
    assert resp.status_code == 409
    assert "portrait" in resp.json()["detail"].lower()


def test_create_avatar_400_on_unsupported_voice_preset(client: TestClient):
    char = _create_character(client, name="Voice Test Donkey")
    _generate_portrait(client, char["id"])
    resp = client.post(
        f"/api/characters/{char['id']}/create-avatar",
        json={"voice_preset": "definitely-not-a-real-preset"},
    )
    assert resp.status_code == 400
    assert "voice_preset" in resp.json()["detail"]


def test_create_avatar_409_when_portrait_file_is_empty(
    client: TestClient, tmp_path: Path
):
    """PR CR belt-and-braces: even if has_portrait() returns true
    (file exists), an empty file should fail loudly with 409 rather
    than silently bind a zero-byte data URI."""
    char = _create_character(client, name="Empty Portrait Donkey")
    cid = char["id"]
    # Create a zero-byte portrait file directly on disk.
    portrait_path = tmp_path / "characters" / f"{cid}-portrait.png"
    portrait_path.parent.mkdir(parents=True, exist_ok=True)
    portrait_path.write_bytes(b"")
    resp = client.post(f"/api/characters/{cid}/create-avatar", json={})
    assert resp.status_code == 409
    assert "empty" in resp.json()["detail"].lower()


# ---- PR CS — safe-retry preset + persist-on-failure --------------


# ---- PR CW — clean prompt composer -------------------------------


def test_clean_prompt_mascot_donkey():
    """Pin the user-spec example: anthropomorphic donkey mascot,
    style chips only, no wardrobe. Verifies the headline anchor
    picks up "editorial" from the chips, the aesthetic sentence
    folds the remaining chips into one readable line, and the
    composer doesn't double-anchor "anthropomorphic".
    """
    from app.services.character_studio_client import build_prompt

    prompt = build_prompt(
        "mascot",
        subject="an anthropomorphic donkey marketing mascot",
        style="stylized, editorial, muted palette",
    )
    assert prompt.startswith(
        "Polished editorial portrait of an anthropomorphic donkey marketing mascot."
    ), prompt
    assert "Calm confident expression." in prompt
    assert "Stylized commercial brand-character design with muted colors." in prompt
    assert "Head-and-shoulders composition on a clean neutral background." in prompt
    # Regression guard — never let the old double-anchor pattern slip back in.
    assert "anthropomorphic mascot spokesperson — anthropomorphic" not in prompt
    assert "polished commercial mascot portrait of a mascot" not in prompt.lower()
    assert "brand-safe advertising character" not in prompt.lower()


def test_clean_prompt_fox_mascot_with_wardrobe():
    """Pin the user-spec fox example verbatim. The composed
    prompt must match the documented expected output."""
    from app.services.character_studio_client import build_prompt

    prompt = build_prompt(
        "mascot",
        subject="an anthropomorphic fox business spokesperson with polished studio styling",
        style="stylized, editorial, studio light, muted palette; dark hoodie, backwards hat",
    )
    assert prompt == (
        "Polished editorial portrait of an anthropomorphic fox business "
        "spokesperson with polished studio styling wearing a dark hoodie "
        "and backwards hat. Calm confident expression. Stylized commercial "
        "brand-character design with muted colors and soft studio lighting. "
        "Head-and-shoulders composition on a clean neutral background. "
        "Professional advertising character design."
    ), prompt


def test_clean_prompt_founder_no_wardrobe_no_chips():
    """Empty style + minimal subject still produces a readable
    prompt using the founder defaults + expression cue."""
    from app.services.character_studio_client import build_prompt

    prompt = build_prompt("founder", subject="a polished founder, mid-30s")
    assert prompt.startswith(
        "Polished commercial portrait of a polished founder, mid-30s."
    ), prompt
    assert "Direct trustworthy gaze with a soft natural smile." in prompt
    # No wardrobe means no "wearing …" clause.
    assert " wearing " not in prompt, prompt
    # No chips means no aesthetic sentence — the standard tail
    # "Soft studio lighting." still lands.
    assert prompt.rstrip().endswith("Soft studio lighting."), prompt


def test_clean_prompt_no_duplicated_anthropomorphic():
    """Even when the operator's `subject` already contains
    "anthropomorphic", the composer must not double up on it."""
    from app.services.character_studio_client import build_prompt

    prompt = build_prompt(
        "mascot",
        subject="an anthropomorphic raccoon mascot spokesperson",
        style="stylized; punk streetwear",
    )
    assert prompt.lower().count("anthropomorphic") == 1, prompt


def test_clean_prompt_under_hard_cap():
    """Even with a maximally noisy subject + every chip, the
    composer caps at 700 chars."""
    from app.services.character_studio_client import build_prompt

    prompt = build_prompt(
        "mascot",
        subject="a " + "very " * 200 + "long subject",
        style=(
            "stylized, editorial, plush mascot, muted palette, "
            "bright palette, vibrant palette, studio light, "
            "natural light, cinematic; an enormous wardrobe with "
            "countless items"
        ),
    )
    assert len(prompt) <= 700, len(prompt)


# ---- PR CX — knowledge sources -----------------------------------


def test_knowledge_source_round_trip(client: TestClient):
    """Add a knowledge source, confirm it persists on the Character
    record + survives a fresh GET, then delete it cleanly."""
    char = _create_character(client, name="Knowledge Test")
    cid = char["id"]
    assert char["knowledge_sources"] == []

    add = client.post(
        f"/api/characters/{cid}/knowledge",
        json={
            "title": "CEO Buzz brand voice",
            "source_type": "brand_note",
            "content": "Punchy, fast-talking, energy-drink confidence. "
            "Catchphrases: 'Let's get loud' / 'One click. You're in.'",
        },
    )
    assert add.status_code == 200, add.text
    body = add.json()
    assert len(body["knowledge_sources"]) == 1
    src = body["knowledge_sources"][0]
    assert src["title"] == "CEO Buzz brand voice"
    assert src["source_type"] == "brand_note"
    assert "punchy" in src["content"].lower()
    assert src["id"]
    assert src["created_at"]

    # Re-fetch confirms persistence (write actually landed on disk).
    refetch = client.get(f"/api/characters/{cid}")
    assert refetch.status_code == 200
    assert len(refetch.json()["knowledge_sources"]) == 1

    # Delete by id.
    rm = client.delete(
        f"/api/characters/{cid}/knowledge/{src['id']}"
    )
    assert rm.status_code == 200
    assert rm.json()["knowledge_sources"] == []


def test_knowledge_source_404_when_character_missing(client: TestClient):
    resp = client.post(
        "/api/characters/no-such-character/knowledge",
        json={"title": "x", "content": "y"},
    )
    assert resp.status_code == 404


def test_knowledge_source_404_when_source_missing(client: TestClient):
    char = _create_character(client, name="Knowledge Delete Test")
    resp = client.delete(
        f"/api/characters/{char['id']}/knowledge/no-such-source"
    )
    assert resp.status_code == 404


def test_knowledge_source_validation(client: TestClient):
    """Title and content are both required + non-empty."""
    char = _create_character(client, name="Knowledge Validation Test")
    cid = char["id"]
    # Empty title → 422
    bad = client.post(
        f"/api/characters/{cid}/knowledge",
        json={"title": "", "content": "some content"},
    )
    assert bad.status_code == 422
    # Empty content → 422
    bad = client.post(
        f"/api/characters/{cid}/knowledge",
        json={"title": "title", "content": ""},
    )
    assert bad.status_code == 422


# ---- PR CY — append-only output history -------------------------


def _create_campaign_with_avatar(client: TestClient, character_id: str) -> str:
    """Helper: create a minimal valid CampaignCreate, attach the
    character + its avatar so /host-video can fire end-to-end in
    mock mode."""
    payload = {
        "business": "Output History Test",
        "product": "Test product",
        "selected_concept": {
            "title": "Output History Test",
            "hook": "Hook",
            "visual": "Visual",
            "caption": "Caption",
            "cta": "Learn more",
        },
        "runway_prompt": "A polished commercial visual.",
        "social_post": {"caption": "Caption", "cta": "Learn more", "hashtags": []},
    }
    resp = client.post("/api/campaigns", json=payload)
    assert resp.status_code == 200, resp.text
    cid = resp.json()["id"]
    # Attach character + force mock-mode avatar so /host-video can fire.
    resp = client.post(
        f"/api/campaigns/{cid}/attach-character",
        json={"character_id": character_id},
    )
    assert resp.status_code == 200, resp.text
    resp = client.post(f"/api/campaigns/{cid}/avatar", json={})
    assert resp.status_code == 200, resp.text
    return cid


def test_host_video_appends_output_history(client: TestClient, tmp_path: Path):
    """Two consecutive /host-video POSTs must produce TWO entries in
    Campaign.outputs. Both historical files must persist on disk so
    the /output/{id} server can serve either render later. The
    canonical legacy `host_video_url` keeps pointing at /host-video
    (latest), so existing UI consumers stay backward-compatible."""
    char = _create_character(client, name="Output History Test")
    _generate_portrait(client, char["id"])
    cid = _create_campaign_with_avatar(client, char["id"])

    # First render.
    r1 = client.post(f"/api/campaigns/{cid}/host-video", json={})
    assert r1.status_code == 200, r1.text
    body1 = r1.json()
    assert body1["host_status"] == "ok"
    assert body1["host_video_url"] == f"/api/campaigns/{cid}/host-video"
    assert len(body1["outputs"]) == 1
    o1 = body1["outputs"][0]
    assert o1["kind"] == "spokesperson_ad"
    assert o1["video_url"] == f"/api/campaigns/{cid}/output/{o1['id']}"
    assert o1["cache_filename"]
    assert o1["created_at"]

    # Second render — appends a new history entry without erasing the first.
    r2 = client.post(f"/api/campaigns/{cid}/host-video", json={})
    assert r2.status_code == 200, r2.text
    body2 = r2.json()
    assert len(body2["outputs"]) == 2
    o2 = body2["outputs"][0]  # newest-first
    assert o2["kind"] == "spokesperson_ad"
    assert o2["id"] != o1["id"]
    assert o2["cache_filename"] != o1["cache_filename"]

    # Both historical files exist on disk.
    f1 = tmp_path / "host" / o1["cache_filename"]
    f2 = tmp_path / "host" / o2["cache_filename"]
    assert f1.exists() and f1.stat().st_size > 0, f"missing or empty: {f1}"
    assert f2.exists() and f2.stat().st_size > 0, f"missing or empty: {f2}"

    # /output/{id} route serves both.
    s1 = client.get(f"/api/campaigns/{cid}/output/{o1['id']}")
    assert s1.status_code == 200
    assert s1.headers["content-type"].startswith("video/")
    s2 = client.get(f"/api/campaigns/{cid}/output/{o2['id']}")
    assert s2.status_code == 200


def test_output_route_404s_for_unknown_id(client: TestClient):
    char = _create_character(client, name="Output 404 Test")
    _generate_portrait(client, char["id"])
    cid = _create_campaign_with_avatar(client, char["id"])
    r = client.get(f"/api/campaigns/{cid}/output/no-such-output")
    assert r.status_code == 404


def test_output_route_404s_for_unknown_campaign(client: TestClient):
    r = client.get("/api/campaigns/no-such-campaign/output/no-such-output")
    assert r.status_code == 404


# ---- PR DC — ad variants + variant-aware renders ----------------


def test_ad_variant_create_and_update(client: TestClient):
    """Upsert by id: passing no id creates a new variant; passing
    an existing id patches it in place; campaign.ad_variants
    preserves the order (newest-first for fresh creates)."""
    # Minimal campaign — `_create_campaign_with_avatar` is heavier
    # than we need here since this test doesn't render.
    resp = client.post("/api/campaigns", json={
        "business": "Variant Test",
        "selected_concept": {"title":"x","hook":"x","visual":"x","caption":"x","cta":"x"},
        "runway_prompt": "x",
        "social_post": {"caption":"x","cta":"x","hashtags":[]},
    })
    cid = resp.json()["id"]
    assert resp.json()["ad_variants"] == []

    # Create variant A
    a = client.post(
        f"/api/campaigns/{cid}/ad-variant",
        json={"title": "Ad 1", "script": "First take."},
    )
    assert a.status_code == 200, a.text
    assert len(a.json()["ad_variants"]) == 1
    v1 = a.json()["ad_variants"][0]
    assert v1["title"] == "Ad 1"
    assert v1["script"] == "First take."
    assert v1["id"]

    # Create variant B (newer)
    b = client.post(
        f"/api/campaigns/{cid}/ad-variant",
        json={"title": "Ad 2", "script": "Different angle."},
    )
    assert len(b.json()["ad_variants"]) == 2
    # newest-first
    assert b.json()["ad_variants"][0]["title"] == "Ad 2"
    assert b.json()["ad_variants"][1]["title"] == "Ad 1"

    # Update variant A's script in place
    u = client.post(
        f"/api/campaigns/{cid}/ad-variant",
        json={"id": v1["id"], "title": "Ad 1 (edited)", "script": "Edited take."},
    )
    assert u.status_code == 200
    variants = u.json()["ad_variants"]
    assert len(variants) == 2  # not duplicated
    v1_after = next(v for v in variants if v["id"] == v1["id"])
    assert v1_after["title"] == "Ad 1 (edited)"
    assert v1_after["script"] == "Edited take."
    # created_at preserved, updated_at moved forward
    assert v1_after["created_at"] == v1["created_at"]


def test_ad_variant_404_when_campaign_missing(client: TestClient):
    r = client.post(
        "/api/campaigns/no-such-campaign/ad-variant",
        json={"title": "x", "script": "y"},
    )
    assert r.status_code == 404


def test_ad_variant_validation(client: TestClient):
    """Title is required (1-80); script optional (≤2000)."""
    resp = client.post("/api/campaigns", json={
        "business": "Validation Test",
        "selected_concept": {"title":"x","hook":"x","visual":"x","caption":"x","cta":"x"},
        "runway_prompt": "x",
        "social_post": {"caption":"x","cta":"x","hashtags":[]},
    })
    cid = resp.json()["id"]
    # Empty title → 422
    r = client.post(
        f"/api/campaigns/{cid}/ad-variant", json={"title": "", "script": "x"}
    )
    assert r.status_code == 422
    # Empty script OK (placeholder variant)
    r = client.post(
        f"/api/campaigns/{cid}/ad-variant", json={"title": "Placeholder"}
    )
    assert r.status_code == 200
    assert r.json()["ad_variants"][0]["script"] == ""


def test_host_video_captures_variant_id(client: TestClient):
    """When the host-video request includes variant_id, the
    appended OutputRecord carries the variant_id + variant_title +
    the variant's script (overriding both explicit override and
    campaign-level commercial_script per PR DC precedence)."""
    char = _create_character(client, name="Variant Render Test")
    _generate_portrait(client, char["id"])
    cid = _create_campaign_with_avatar(client, char["id"])
    # Create a variant with a distinctive script
    var = client.post(
        f"/api/campaigns/{cid}/ad-variant",
        json={"title": "Hook take", "script": "Variant-scripted line."},
    ).json()
    variant = var["ad_variants"][0]

    # Render with variant_id in body
    r = client.post(
        f"/api/campaigns/{cid}/host-video",
        json={"variant_id": variant["id"]},
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["host_status"] == "ok"
    assert len(body["outputs"]) == 1
    out = body["outputs"][0]
    assert out["variant_id"] == variant["id"]
    assert out["variant_title"] == "Hook take"
    # Variant script captured on the OutputRecord (PR CY field +
    # PR DC variant override).
    assert out["script"] == "Variant-scripted line."

    # Render again without variant_id → output's variant fields are
    # null (legacy / unscoped render).
    r2 = client.post(f"/api/campaigns/{cid}/host-video", json={})
    body2 = r2.json()
    assert len(body2["outputs"]) == 2
    latest = body2["outputs"][0]
    assert latest["variant_id"] is None
    assert latest["variant_title"] is None


def test_clean_prompt_prompt_override_still_wins():
    """`prompt_override` short-circuits the composer entirely so
    operator-typed text reaches Runway verbatim."""
    from app.services.character_studio_client import build_prompt

    custom = "totally custom verbatim prompt the operator typed"
    assert build_prompt("mascot", prompt_override=custom) == custom


def test_safe_retry_uses_simpler_prompt(client: TestClient):
    """`safe_retry=True` should bypass character.style and render a
    short, declarative prompt — not the full PORTRAIT_TEMPLATES
    chain. Mock-mode persists the resolved prompt, so we can read it
    back from the Character record.
    """
    resp = client.post(
        "/api/characters",
        json={
            "name": "Safe Retry Donkey",
            "template": "mascot",
            "subject": "an anthropomorphic donkey marketing mascot",
            "style": (
                "stylized, editorial, studio light, muted palette; "
                "premium modern tech-startup hoodie, indiana jones "
                "style hat"
            ),
            "voice_preset": "drew",
        },
    )
    assert resp.status_code == 200
    cid = resp.json()["id"]
    resp = client.post(
        f"/api/characters/{cid}/generate-portrait",
        json={"safe_retry": True},
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    prompt = body["portrait_prompt"]
    assert prompt
    # Safe-retry preamble lands at the top of the prompt.
    assert prompt.startswith("Polished 3D brand mascot portrait of"), prompt
    # The unstable IP reference must not survive — safe-retry drops
    # `style` entirely.
    assert "indiana jones" not in prompt.lower(), (
        "safe_retry must bypass character.style entirely; got: " + prompt
    )
    assert "muted palette" not in prompt.lower(), prompt
    # Sanity: prompt is short enough that diffusion won't choke.
    assert len(prompt) < 600, f"safe-retry prompt too long ({len(prompt)})"


def test_default_path_maps_style_chips(client: TestClient):
    """PR CW — style chips are MAPPED into natural language by the
    composer, not dumped verbatim. "muted palette" should land as
    "muted colors" in the aesthetic sentence; free-form text after
    a `;` becomes wardrobe.
    """
    resp = client.post(
        "/api/characters",
        json={
            "name": "Default Path Donkey",
            "template": "mascot",
            "subject": "an anthropomorphic donkey",
            "style": "muted palette; premium modern hoodie",
            "voice_preset": "drew",
        },
    )
    cid = resp.json()["id"]
    resp = client.post(
        f"/api/characters/{cid}/generate-portrait",
        json={},  # no safe_retry
    )
    assert resp.status_code == 200, resp.text
    prompt = resp.json()["portrait_prompt"]
    # The chip was mapped, not dumped raw.
    assert "muted colors" in prompt.lower(), prompt
    assert "muted palette" not in prompt.lower(), prompt
    # The free-form post-`;` text becomes wardrobe.
    assert "wearing a premium modern hoodie" in prompt.lower(), prompt


# ---- PR DD — raw realtime-document attach -----------------------


def _create_minimal_campaign(client: TestClient, business: str) -> str:
    """Tiny CampaignCreate that exercises only the realtime-document
    field — no character, no avatar, no render path. Cheaper than
    `_create_campaign_with_avatar` for routes that don't touch
    ffmpeg / Runway."""
    resp = client.post("/api/campaigns", json={
        "business": business,
        "selected_concept": {"title":"x","hook":"x","visual":"x","caption":"x","cta":"x"},
        "runway_prompt": "x",
        "social_post": {"caption":"x","cta":"x","hashtags":[]},
    })
    assert resp.status_code == 200, resp.text
    return resp.json()["id"]


def test_realtime_document_raw_round_trip(client: TestClient):
    """Happy path: POST raw doc → mock-mode persists deterministic
    `mock_doc_<sha>` id + status `mock` on the campaign record. The
    raw route is the path the context-kit upload script uses, so a
    regression here breaks the demo grounding flow."""
    cid = _create_minimal_campaign(client, business="Raw Doc Test")
    resp = client.post(
        f"/api/campaigns/{cid}/realtime-document/raw",
        json={
            "name": "context-kit-demo-grounding",
            "content": "# AdSpark\n\nPersistent AI spokesperson infrastructure.",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["runway_document_status"] == "mock"
    assert body["runway_document_id"], "expected a mock_doc_<sha> id"
    assert body["runway_document_id"].startswith("mock_doc_")
    assert body["runway_document_mock_mode"] is True
    assert body["runway_document_error"] is None

    # Re-attach with different content gets a different deterministic id
    # (digest of name + content).
    resp2 = client.post(
        f"/api/campaigns/{cid}/realtime-document/raw",
        json={
            "name": "context-kit-demo-grounding",
            "content": "# AdSpark v2 — edited content",
        },
    )
    assert resp2.status_code == 200
    assert resp2.json()["runway_document_id"] != body["runway_document_id"]


def test_realtime_document_raw_404_when_campaign_missing(client: TestClient):
    r = client.post(
        "/api/campaigns/no-such-campaign/realtime-document/raw",
        json={"name": "x", "content": "y"},
    )
    assert r.status_code == 404


def test_realtime_document_raw_validation(client: TestClient):
    """Empty/whitespace name and content both rejected — 422 from
    Pydantic for length, 422 from the route for whitespace-only."""
    cid = _create_minimal_campaign(client, business="Raw Doc Validation")

    # Pydantic min_length=1 — empty name
    r = client.post(
        f"/api/campaigns/{cid}/realtime-document/raw",
        json={"name": "", "content": "valid content"},
    )
    assert r.status_code == 422

    # Pydantic min_length=1 — empty content
    r = client.post(
        f"/api/campaigns/{cid}/realtime-document/raw",
        json={"name": "valid name", "content": ""},
    )
    assert r.status_code == 422

    # Whitespace-only content — passes Pydantic but route catches the strip
    r = client.post(
        f"/api/campaigns/{cid}/realtime-document/raw",
        json={"name": "valid name", "content": "   \n\n\t"},
    )
    assert r.status_code == 422
    assert "non-empty" in r.json()["detail"].lower()


def test_realtime_document_raw_truncates_to_40k(client: TestClient):
    """`runway_create_document` trims to DOCUMENT_MAX_CHARS (40,000)
    before the wire. The route should accept oversized content
    without error and the persisted document id should be the digest
    of the TRIMMED content — proving the trim landed before hashing.
    """
    from app.services.documents_client import (
        DOCUMENT_MAX_CHARS,
        _mock_document_id,
    )

    cid = _create_minimal_campaign(client, business="Raw Doc Truncation")
    # 60k chars — well over the 40k cap.
    oversized = "A" * 60_000
    resp = client.post(
        f"/api/campaigns/{cid}/realtime-document/raw",
        json={"name": "oversize", "content": oversized},
    )
    assert resp.status_code == 200, resp.text
    persisted_id = resp.json()["runway_document_id"]

    # The mock id is sha256 of (name + "\n" + trimmed_content)[:16].
    # Reproduce the expected id from the trimmed content; if our
    # trim path bypassed the client, this assertion would fail.
    expected_trimmed = oversized.strip()[:DOCUMENT_MAX_CHARS]
    expected_id = _mock_document_id("oversize", expected_trimmed)
    assert persisted_id == expected_id, (
        f"expected trimmed-content id {expected_id}, got {persisted_id}"
    )


# ---- PR DE — curated grounding document structure --------------
#
# The upload script's `build_payload()` is the authoring surface for
# the Character OS self-demo grounding document. PR DE rewrote it
# from a raw repo-doc dump into a curated 6-section narrative that
# explicitly separates Character OS (the hackathon product) from
# context-kit (the build tool). This test pins the structure so a
# future prose edit can't accidentally drop a required section or
# the canonical distinction line.
#
# Imported via importlib because the script lives at
# `scripts/upload-context-kit-demo-grounding.py` (hyphens in the
# filename make it un-import-able with normal `import` syntax).


def _load_uploader_module():
    """Import the upload script as a module. The script intentionally
    has zero non-stdlib deps so this works under the bare test
    venv with no extra setup."""
    import importlib.util
    from pathlib import Path
    repo_root = Path(__file__).resolve().parent.parent.parent
    script = repo_root / "scripts" / "upload-context-kit-demo-grounding.py"
    assert script.exists(), f"script missing: {script}"
    spec = importlib.util.spec_from_file_location("ck_uploader", script)
    assert spec is not None and spec.loader is not None, "spec_from_file_location returned None"
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_grounding_document_has_required_sections():
    """All six numbered sections + the preamble heading land in the
    assembled document. Catches a prose edit that drops a heading."""
    mod = _load_uploader_module()
    headings, content = mod.build_payload()

    expected = [
        "How To Answer Questions Using This Document",
        "1. What Character OS Is",
        "2. What context-kit Is",
        "3. How context-kit Helped Build Character OS",
        "4. What Character OS Can Do Today",
        "5. Demo Talking Points",
        "6. What Not To Conflate",
    ]
    assert headings == expected, headings
    # Each heading also appears in the assembled Markdown.
    for h in expected:
        assert h in content, f"section heading missing from content: {h!r}"


def test_grounding_document_carries_canonical_distinction():
    """The exact distinction line lands in the document AND is the
    value exported as CANONICAL_DISTINCTION (so the dry-run banner
    and the document stay in sync)."""
    mod = _load_uploader_module()
    _, content = mod.build_payload()

    expected = (
        "Character OS is the hackathon product. context-kit is the "
        "separate AI context-management package used to coordinate the build."
    )
    assert expected == mod.CANONICAL_DISTINCTION
    assert expected in content, "canonical distinction line missing from document"


def test_grounding_document_carries_guardrails():
    """The 'Hard rules' guardrails the spokesperson reads at the top
    must be present — these are the rules that prevent conflation."""
    mod = _load_uploader_module()
    _, content = mod.build_payload()

    for must_have in [
        "Do **not** describe Character OS as context-kit",
        "Do **not** describe context-kit as the product being demoed",
        "When asked about context-kit, say it is the separate",
        "When asked about Character OS, say it is the AI spokesperson",
    ]:
        assert must_have in content, f"guardrail line missing: {must_have!r}"


def test_grounding_document_under_cap():
    """Curated narrative is intentionally small. If a future edit
    blows past 40k chars, the script's defensive trim fires and adds
    a `[truncated]` marker — the test prefers to catch that drift
    here rather than at the wire."""
    mod = _load_uploader_module()
    _, content = mod.build_payload()
    assert len(content) <= mod.DOCUMENT_MAX_CHARS, len(content)
    assert "[truncated to 40k chars]" not in content, (
        "curated narrative grew past 40k chars; trim back or restructure"
    )


# ---- PR DF — forbid memory-layer conflation ------------------
#
# The PR DE narrative was clean *structurally* but a real demo of
# the grounded avatar surfaced a softer conflation: the spokesperson
# was describing context-kit as if it helped *the avatar* maintain
# context across the realtime conversation. PR DF tightens the
# language so that misreading is no longer available — context-kit
# is a build-time tool for AI coding sessions, full stop.
#
# These tests catch the regression in either direction: a prose edit
# that re-introduces the forbidden phrasing, or one that drops the
# stronger PR DF distinctions.


def test_grounding_document_disambiguates_avatar_memory():
    """No phrasing in the document may be quoted to mean context-kit
    is the avatar's memory layer or powers the realtime conversation
    or gives the spokesperson context at runtime."""
    mod = _load_uploader_module()
    _, content = mod.build_payload()
    lower = content.lower()

    # Phrasings that would let a realtime LLM conflate the two.
    # Substrings only — the test allows the doc to MENTION these
    # framings in negation (e.g., "context-kit is NOT the memory
    # layer for the avatars") because the negation lands as a
    # different substring.
    forbidden = [
        # Affirmative conflation — these would land verbatim if the
        # author slipped.
        "context-kit helps character os spokespeople",
        "context-kit is the memory layer for the avatars",
        "context-kit powers the spokesperson",
        "context-kit gives the avatars memory",
        "context-kit makes the avatars remember",
        # The PR DD framing that triggered this PR — replaced with
        # explicit "AI coding sessions" language in PR DF.
        "context-kit is the memory system for character os",
    ]
    for phrase in forbidden:
        assert phrase not in lower, (
            f"forbidden conflation phrase present: {phrase!r}"
        )


def test_grounding_document_carries_pr_df_distinctions():
    """The PR DF canonical phrasings + the new section-6 Q&A entries
    must land. If a prose edit drops one, the spokesperson will
    drift back toward the PR DE softness.

    Normalizes whitespace before the substring check — Markdown line
    wrapping in the script's prose otherwise breaks a phrase that
    happens to land at column 72 across two lines.
    """
    import re
    mod = _load_uploader_module()
    _, content = mod.build_payload()
    flat = re.sub(r"\s+", " ", content.lower())

    required = [
        # Two canonical lines from the preamble.
        "memory protocol for ai coding sessions",
        "not the memory system for character os spokespeople",
        "context-kit does not make the avatars remember",
        # The "how the project was built, not what the product is"
        # answer style in section 6.
        "how the project was built, not what the product is",
        # The disambiguation sentence from section 2 — names the
        # IDE-side assistants explicitly so the LLM can't generalize
        # "session" to "realtime conversation".
        "claude code",
        # The "How do you know things" answer — grounding doc +
        # knowledge sources, not context-kit.
        "campaign grounding document",
        "knowledge sources",
    ]
    for phrase in required:
        assert phrase in flat, (
            f"required PR DF distinction missing: {phrase!r}"
        )
