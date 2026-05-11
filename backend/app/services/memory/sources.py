"""Pluggable memory sources — INPUT side of the memory loop.

Each source knows how to fetch new memory candidates for a
character (with optional campaign scope) and produce ``MemoryEntry``
instances. Sources are stateless except for whatever upstream
pointers they need to dedupe re-ingests; the orchestrator handles
persistence.

Add a new source = implement the ABC + register it on the
orchestrator. No core code changes.

Phase 1 ships:
  - ``OperatorNoteSource`` — mirrors the character's existing
    ``knowledge_sources`` list into MemoryEntries. The Knowledge
    tab keeps working unchanged; this just exposes that content
    through the memory pipeline so the composer can include it.

  - ``TranscriptMemorySource`` — pulls past Runway conversation
    transcripts via the existing transcript_client (PR AJ) and
    summarises each via Llama (PR EH) into one ~300-char memory
    entry per session.

Phase 3 sketches:
  - ``ExternalFeedSource`` — placeholder showing the contract a
    future "your other app sends real-time data" pipeline implements.
"""
from __future__ import annotations

import hashlib
import logging
from abc import ABC, abstractmethod
from typing import Optional

from ...config import Settings
from .models import MemoryEntry, MemorySourceType
from .store import MemoryStore


logger = logging.getLogger(__name__)


class MemorySource(ABC):
    """A pluggable input to the memory pipeline.

    Concrete subclasses implement ``fetch_entries`` returning every
    candidate ``MemoryEntry`` for a character + optional campaign
    scope. The orchestrator decides whether each candidate is new
    (via ``source_type`` + ``source_id`` deduplication in the store)
    and persists accordingly.
    """

    name: str = "base"
    source_type: MemorySourceType = "operator_note"

    @abstractmethod
    def fetch_entries(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        settings: Optional[Settings] = None,
    ) -> list[MemoryEntry]:
        ...


# ---- 1. Operator notes (Character.knowledge_sources mirror) ---------


class OperatorNoteSource(MemorySource):
    """Mirrors the character's existing ``knowledge_sources`` list
    (PR CX) into MemoryEntries. The Knowledge tab UI keeps writing
    to ``character.knowledge_sources``; this source ingests from
    there so the composer can include those notes alongside
    transcript-derived memories.

    Idempotent: re-running ingest overwrites any prior entry with
    the same source_id (the knowledge_source.id), so operator edits
    flow through cleanly.
    """

    name = "operator_notes"
    source_type: MemorySourceType = "operator_note"

    def __init__(self, character_lookup):
        """``character_lookup`` is a callable
        ``(character_id) -> dict | None`` that returns the
        Character row. Injected at orchestrator setup so we don't
        couple this module to CharacterStore directly."""
        self._lookup = character_lookup

    def fetch_entries(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        settings: Optional[Settings] = None,
    ) -> list[MemoryEntry]:
        record = self._lookup(character_id)
        if not record:
            return []
        sources = record.get("knowledge_sources") or []
        out: list[MemoryEntry] = []
        for s in sources:
            sid = s.get("id")
            title = (s.get("title") or "Untitled note").strip()[:200]
            content = (s.get("content") or "").strip()[:4000]
            if not content:
                continue
            out.append(
                MemoryEntry(
                    id=MemoryStore.new_id(),
                    character_id=character_id,
                    campaign_id=None,  # character-wide
                    source_type=self.source_type,
                    source_id=sid,
                    title=title,
                    content=content,
                    tags=["knowledge", s.get("source_type", "brand_note")],
                )
            )
        return out


# ---- 2. Transcript memories (summarised realtime conversations) ----


class TranscriptMemorySource(MemorySource):
    """Pull past Runway conversation transcripts via the existing
    transcript_client (PR AJ) and summarise each into a single
    ~300-char memory entry via Llama.

    Designed to be invoked AFTER a realtime session ends. The
    orchestrator iterates over a campaign's
    ``realtime_session_history`` (list of session_ids) and asks this
    source to ingest each.

    Idempotent via ``source_id = session_id`` — re-ingesting the
    same session replaces the prior summary instead of duplicating.
    """

    name = "transcripts"
    source_type: MemorySourceType = "transcript"

    def __init__(
        self,
        *,
        session_lookup,
        transcript_fetcher,
        summariser,
    ):
        """Three callables, injected for test friendliness:

        - ``session_lookup(character_id, campaign_id) -> list[str]``
          returns recent session_ids for the character + campaign.
        - ``transcript_fetcher(session_id, settings) -> str | None``
          returns the raw transcript text or None on miss.
        - ``summariser(transcript, character_name, settings) -> str``
          returns a ≤300-char summary. Falls back to a deterministic
          template when the LLM is unreachable.
        """
        self._sessions = session_lookup
        self._fetch = transcript_fetcher
        self._summarise = summariser

    def fetch_entries(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        settings: Optional[Settings] = None,
    ) -> list[MemoryEntry]:
        session_ids = self._sessions(character_id, campaign_id) or []
        if not session_ids:
            return []
        out: list[MemoryEntry] = []
        for sid in session_ids:
            try:
                transcript = self._fetch(sid, settings)
            except Exception as exc:
                logger.warning(
                    "transcript fetch failed for session=%s: %s", sid, exc,
                )
                continue
            if not transcript or not transcript.strip():
                continue
            try:
                summary = self._summarise(transcript, character_id, settings)
            except Exception as exc:
                logger.warning(
                    "transcript summarise failed for session=%s: %s",
                    sid, exc,
                )
                # Deterministic fallback: take the first 280 chars.
                summary = transcript.strip()[:280]
            if not summary.strip():
                continue
            digest = hashlib.sha256(sid.encode("utf-8")).hexdigest()[:8]
            out.append(
                MemoryEntry(
                    id=MemoryStore.new_id(),
                    character_id=character_id,
                    campaign_id=campaign_id,
                    source_type=self.source_type,
                    source_id=sid,
                    title=f"Conversation {digest}",
                    content=summary[:4000],
                    tags=["transcript", "conversation"],
                    metadata={
                        "session_id": sid,
                        "transcript_chars": len(transcript),
                    },
                )
            )
        return out


# ---- 3. External feed placeholder ----------------------------------


class ExternalFeedSource(MemorySource):
    """Stub for the operator's "other app that already streams
    real-time data" (per the submission video discussion).

    Anything the operator's external system wants to ingest into a
    character's memory implements this contract: takes the
    character_id (and optional campaign_id), returns MemoryEntries.

    The actual data ingestion is up to the implementer — this stub
    just shows the wire-in shape. Reasonable patterns:
      - poll an HTTP endpoint
      - tail a webhook queue
      - subscribe to a pub/sub topic

    Phase 3 candidate. Today this class is just here as the
    aspirational example.
    """

    name = "external_feed"
    source_type: MemorySourceType = "external_feed"

    def __init__(self, *, fetcher=None, feed_name: str = "external"):
        self._fetcher = fetcher
        self._feed_name = feed_name

    def fetch_entries(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        settings: Optional[Settings] = None,
    ) -> list[MemoryEntry]:
        if not self._fetcher:
            return []
        try:
            raw_items = self._fetcher(character_id, campaign_id) or []
        except Exception as exc:
            logger.warning(
                "external feed %s fetch failed: %s", self._feed_name, exc,
            )
            return []
        out: list[MemoryEntry] = []
        for item in raw_items:
            sid = str(item.get("id") or "").strip()
            title = (item.get("title") or "External update").strip()[:200]
            content = (item.get("content") or "").strip()[:4000]
            if not content:
                continue
            out.append(
                MemoryEntry(
                    id=MemoryStore.new_id(),
                    character_id=character_id,
                    campaign_id=campaign_id,
                    source_type=self.source_type,
                    source_id=sid or None,
                    title=title,
                    content=content,
                    tags=item.get("tags") or [self._feed_name],
                    metadata={
                        "feed_name": self._feed_name,
                        **(item.get("metadata") or {}),
                    },
                )
            )
        return out
