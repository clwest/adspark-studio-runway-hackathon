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


def test_default_path_still_includes_style(client: TestClient):
    """Counter-test: when `safe_retry=False` (default), character.style
    is still composed into the resolved prompt. This pins the
    behaviour so a future cleanup doesn't accidentally drop style
    from the happy path.
    """
    resp = client.post(
        "/api/characters",
        json={
            "name": "Default Path Donkey",
            "template": "mascot",
            "subject": "an anthropomorphic donkey",
            "style": "muted palette, premium modern hoodie",
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
    assert "muted palette" in prompt.lower(), prompt
    assert "premium modern hoodie" in prompt.lower(), prompt
