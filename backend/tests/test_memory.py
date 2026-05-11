"""Tests for the cross-session memory layer (PR EM).

Phase 1 coverage: MemoryEntry shape, JsonMemoryStore CRUD + search,
OperatorNoteSource ingestion, RecencyWeightedComposer ordering + size
budget, MemoryOrchestrator end-to-end with custom plugins.

The Phase 1 ABCs are exercised via the concrete implementations
here; Phase 3's PgVectorMemoryStore + semantic-search tests will
mirror the same shape.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from app.services.memory import (
    JsonMemoryStore,
    MemoryEntry,
    MemoryOrchestrator,
    OperatorNoteSource,
    RecencyWeightedComposer,
    TranscriptMemorySource,
)


def _entry(
    character_id: str = "char-test-aaaa",
    title: str = "test note",
    content: str = "test content body",
    **kwargs,
) -> MemoryEntry:
    """Test-friendly factory with sensible defaults."""
    return MemoryEntry(
        id=JsonMemoryStore.new_id(),
        character_id=character_id,
        title=title,
        content=content,
        **kwargs,
    )


# ---- JsonMemoryStore --------------------------------------------------


def test_memory_store_add_and_get_roundtrip(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    entry = _entry(content="Riggs argues against feature bloat.")
    store.add(entry)
    fetched = store.get(entry.id)
    assert fetched is not None
    assert fetched.character_id == entry.character_id
    assert fetched.content == "Riggs argues against feature bloat."


def test_memory_store_dedupes_on_source_id(tmp_path: Path):
    """Re-ingesting the same upstream record (same source_type +
    source_id) replaces the prior row, doesn't duplicate it."""
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(
        source_type="operator_note",
        source_id="ks-1",
        content="first content",
    ))
    store.add(_entry(
        source_type="operator_note",
        source_id="ks-1",
        content="second content (replaces first)",
    ))
    listed = store.list(character_id="char-test-aaaa")
    assert len(listed) == 1
    assert listed[0].content == "second content (replaces first)"


def test_memory_store_delete(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    e = store.add(_entry())
    assert store.delete(e.id) is True
    assert store.get(e.id) is None
    # Second delete is a no-op (returns False).
    assert store.delete(e.id) is False


def test_memory_store_update(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    e = store.add(_entry(title="old title", content="old content"))
    updated = store.update(e.id, title="new title")
    assert updated is not None
    assert updated.title == "new title"
    assert updated.content == "old content"
    # updated_at should advance (string-comparable ISO timestamps).
    assert updated.updated_at >= e.updated_at


def test_memory_store_search_keyword(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(title="Hackathon Build Process", content="context-kit kept the builders aligned"))
    store.add(_entry(title="Voice Notes", content="we cloned a real voice once"))
    store.add(_entry(title="Unrelated", content="recipe for sourdough"))
    hits = store.search("context-kit", character_id="char-test-aaaa")
    assert len(hits) == 1
    assert "Hackathon" in hits[0].title


def test_memory_store_list_filters(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(source_type="operator_note", tags=["brand"]))
    store.add(_entry(source_type="transcript", tags=["conversation"]))
    store.add(_entry(source_type="operator_note", tags=["voice"]))
    by_type = store.list(
        character_id="char-test-aaaa", source_type="operator_note",
    )
    assert len(by_type) == 2
    by_tag = store.list(character_id="char-test-aaaa", tags=["voice"])
    assert len(by_tag) == 1


def test_memory_store_total_chars(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(title="ti", content="content"))
    store.add(_entry(title="ti2", content="more content"))
    # title + content + 10-char framing per entry
    expected = (len("ti") + len("content") + 10) + (len("ti2") + len("more content") + 10)
    assert store.total_chars("char-test-aaaa") == expected


# ---- OperatorNoteSource -----------------------------------------------


def test_operator_note_source_ingests_knowledge_sources(tmp_path: Path):
    """OperatorNoteSource mirrors Character.knowledge_sources into
    MemoryEntries with stable source_ids for deduplication."""
    fake_character = {
        "id": "char-test-aaaa",
        "knowledge_sources": [
            {
                "id": "ks-1",
                "title": "Brand voice",
                "content": "Punchy, confident, fast pace.",
                "source_type": "brand_note",
            },
            {
                "id": "ks-2",
                "title": "Empty",
                "content": "",  # should be skipped
                "source_type": "brand_note",
            },
            {
                "id": "ks-3",
                "title": "Build process",
                "content": "context-kit kept sessions aligned.",
                "source_type": "build_note",
            },
        ],
    }
    source = OperatorNoteSource(character_lookup=lambda cid: fake_character)
    entries = source.fetch_entries("char-test-aaaa")
    assert len(entries) == 2  # the empty one was skipped
    assert {e.source_id for e in entries} == {"ks-1", "ks-3"}
    assert all(e.source_type == "operator_note" for e in entries)


# ---- TranscriptMemorySource ------------------------------------------


def test_transcript_source_handles_empty(tmp_path: Path):
    source = TranscriptMemorySource(
        session_lookup=lambda cid, camp: [],
        transcript_fetcher=lambda sid, settings: None,
        summariser=lambda t, c, s: t[:280],
    )
    assert source.fetch_entries("char-test-aaaa") == []


def test_transcript_source_summarises_per_session(tmp_path: Path):
    """Each session_id yields one MemoryEntry; source_id stays the
    session_id for dedupe; the summariser produces the content."""
    transcripts = {
        "sess-1": "USER: hi\nAVATAR: hello back",
        "sess-2": "USER: what is character os\nAVATAR: persistent ai spokespeople",
    }
    source = TranscriptMemorySource(
        session_lookup=lambda cid, camp: list(transcripts.keys()),
        transcript_fetcher=lambda sid, settings: transcripts.get(sid),
        summariser=lambda t, c, s: f"summary: {t[:40]}",
    )
    entries = source.fetch_entries("char-test-aaaa", campaign_id="camp-x")
    assert len(entries) == 2
    assert {e.source_id for e in entries} == {"sess-1", "sess-2"}
    assert all(e.content.startswith("summary:") for e in entries)
    assert all(e.campaign_id == "camp-x" for e in entries)


# ---- RecencyWeightedComposer -----------------------------------------


def test_composer_assembles_markdown_with_sections(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(
        title="Brand voice",
        content="Punchy.",
        source_type="operator_note",
    ))
    store.add(_entry(
        title="Convo 1",
        content="Asked about the platform.",
        source_type="transcript",
    ))
    body, included = RecencyWeightedComposer().compose(
        store, "char-test-aaaa", character_label="Donny",
    )
    assert len(included) == 2
    assert "# Memory for Donny" in body
    assert "## Operator Notes" in body
    assert "## Past Conversations" in body
    assert "Brand voice" in body
    assert "Convo 1" in body


def test_composer_respects_budget(tmp_path: Path):
    """Tiny budget → only the highest-priority entry survives."""
    store = JsonMemoryStore(tmp_path)
    # Operator note (priority 1) should be picked over transcript
    # (priority 3) when budget is tight.
    store.add(_entry(
        title="Operator note", content="x" * 200,
        source_type="operator_note",
    ))
    store.add(_entry(
        title="Old conversation", content="y" * 200,
        source_type="transcript",
    ))
    # 400-char header + a 260-char operator note fits; transcript
    # gets cut.
    body, included = RecencyWeightedComposer().compose(
        store, "char-test-aaaa", budget_chars=800,
    )
    titles = [e.title for e in included]
    assert "Operator note" in titles
    assert "Old conversation" not in titles


def test_composer_filters_by_campaign(tmp_path: Path):
    """Character-wide entries + campaign-scoped entries for that
    campaign are included; other campaigns' entries are excluded."""
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(title="char-wide note", content="abc"))
    store.add(_entry(
        title="for camp-A", content="def", campaign_id="camp-A",
    ))
    store.add(_entry(
        title="for camp-B", content="ghi", campaign_id="camp-B",
    ))
    body, included = RecencyWeightedComposer().compose(
        store, "char-test-aaaa", campaign_id="camp-A",
    )
    titles = {e.title for e in included}
    assert "char-wide note" in titles
    assert "for camp-A" in titles
    assert "for camp-B" not in titles


# ---- MemoryOrchestrator end-to-end ----------------------------------


def test_orchestrator_ingests_from_registered_sources(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    composer = RecencyWeightedComposer()

    fake_character = {
        "id": "char-test-aaaa",
        "knowledge_sources": [
            {"id": "ks-1", "title": "Note A", "content": "alpha"},
            {"id": "ks-2", "title": "Note B", "content": "beta"},
        ],
    }
    op_source = OperatorNoteSource(character_lookup=lambda cid: fake_character)
    orch = MemoryOrchestrator(
        store=store, sources=[op_source], composer=composer,
    )

    result = orch.ingest_from_all_sources("char-test-aaaa")
    assert result["added"] == 2
    assert result["per_source"]["operator_notes"] == 2
    assert result["errors"] == []

    # Idempotent — second run replaces existing entries (same source_ids).
    result2 = orch.ingest_from_all_sources("char-test-aaaa")
    assert result2["added"] == 2
    assert store.list(character_id="char-test-aaaa")
    assert len(store.list(character_id="char-test-aaaa")) == 2


def test_orchestrator_compose_document_body_returns_markdown(tmp_path: Path):
    store = JsonMemoryStore(tmp_path)
    store.add(_entry(title="Test note", content="Some content."))
    orch = MemoryOrchestrator(
        store=store,
        sources=[],
        composer=RecencyWeightedComposer(),
    )
    body, included = orch.compose_document_body(
        "char-test-aaaa", character_label="TestChar",
    )
    assert "TestChar" in body
    assert "Test note" in body
    assert len(included) == 1


def test_orchestrator_register_source_adds_to_pipeline(tmp_path: Path):
    """register_source lets runtime-discovered feeds plug in without
    reconstructing the orchestrator."""
    store = JsonMemoryStore(tmp_path)
    orch = MemoryOrchestrator(
        store=store, sources=[], composer=RecencyWeightedComposer(),
    )
    from app.services.memory.sources import ExternalFeedSource

    feed = ExternalFeedSource(
        fetcher=lambda cid, camp: [{
            "id": "ext-1",
            "title": "External insight",
            "content": "Real-time signal",
        }],
        feed_name="test_feed",
    )
    orch.register_source(feed)
    result = orch.ingest_from_all_sources("char-test-aaaa")
    assert result["added"] == 1
    listed = store.list(character_id="char-test-aaaa")
    assert listed[0].source_type == "external_feed"
    assert listed[0].source_id == "ext-1"
