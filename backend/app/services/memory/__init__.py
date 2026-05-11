"""Cross-session memory for Character OS spokespeople (PR EM).

Public API for the memory layer. Importers see a clean surface;
implementation details (storage backends, source plugins, composer
strategies) live in sibling modules and stay pluggable.

Quick tour:

    from app.services.memory import (
        MemoryEntry,
        get_orchestrator,
    )

    orchestrator = get_orchestrator(settings)

    # 1. Pull new entries from every registered source for a character
    new_count = orchestrator.ingest_from_all_sources(character_id)

    # 2. Compose the accumulated memory into a single Runway document
    #    body, upload to Runway, attach to the campaign so the next
    #    realtime session has full memory.
    doc_id = orchestrator.compose_and_publish(character_id, campaign_id)

The orchestrator is the only thing routes call. Tests can replace
the storage backend, source list, or composer strategy via the
factory functions in this module.

PR EM-a — Phase 1: foundation + JSON store + transcript / operator
sources + recency composer.

PR EM-b (planned) — routes + frontend Memory tab + auto-ingest after
realtime session end.

PR EM-c (planned) — PgVectorMemoryStore + Ollama embedding source
+ semantic search.
"""
from __future__ import annotations

from .models import MemoryEntry, MemorySourceType
from .orchestrator import MemoryOrchestrator, get_orchestrator
from .store import MemoryStore, JsonMemoryStore
from .sources import (
    MemorySource,
    OperatorNoteSource,
    TranscriptMemorySource,
)
from .composer import MemoryComposer, RecencyWeightedComposer


__all__ = [
    "MemoryEntry",
    "MemorySourceType",
    "MemoryOrchestrator",
    "MemoryStore",
    "JsonMemoryStore",
    "MemorySource",
    "OperatorNoteSource",
    "TranscriptMemorySource",
    "MemoryComposer",
    "RecencyWeightedComposer",
    "get_orchestrator",
]
