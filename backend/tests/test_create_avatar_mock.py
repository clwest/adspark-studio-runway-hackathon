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
