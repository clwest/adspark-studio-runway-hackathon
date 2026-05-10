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
