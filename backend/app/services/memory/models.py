"""MemoryEntry — the atom every source produces and every store
persists.

Designed to be portable across storage backends. Today
JsonMemoryStore ignores ``embedding`` + ``embedding_model``; the
future PgVectorMemoryStore reads / generates them. The shape itself
doesn't change, which means a backend swap doesn't require entry
migration — just re-embed the existing rows.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, Optional

from pydantic import BaseModel, Field


# Source provenance. The list is fixed-vocab for filtering /
# UI grouping, but adding new values is a one-line change here +
# a new concrete MemorySource subclass — no other code needs to
# know.
MemorySourceType = Literal[
    "operator_note",     # operator-typed knowledge_source on the Character
    "transcript",        # summarised realtime conversation transcript
    "auto_extracted",    # LLM-extracted facts from an ad render or chat
    "external_feed",     # operator's other app pushed this in
    "seed",              # came in with the character at seed time
]


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class MemoryEntry(BaseModel):
    """One unit of memory for a Character (or Campaign-scoped).

    Storage-agnostic: JsonMemoryStore writes the whole BaseModel to
    JSON; a future PgVectorMemoryStore would project the same fields
    onto Postgres columns + a vector column for ``embedding``.

    Size guidance: keep ``content`` under ~500 chars per entry. The
    composer concatenates many entries into Runway's 50K-token doc
    cap — small atomic entries compose more cleanly than monolithic
    blobs.
    """

    id: str = Field(..., min_length=8, max_length=64)
    character_id: str = Field(..., min_length=8, max_length=64)
    # Optional campaign scope. None = character-wide memory; set =
    # campaign-specific memory that only surfaces when that campaign
    # is the active context.
    campaign_id: Optional[str] = Field(default=None)
    source_type: MemorySourceType = "operator_note"
    # Pointer back to the upstream object that produced this entry —
    # session_id for transcripts, knowledge_source.id for operator
    # notes, whatever for external feeds. Lets the orchestrator
    # dedupe re-ingests of the same upstream record.
    source_id: Optional[str] = Field(default=None)

    title: str = Field(..., min_length=1, max_length=200)
    content: str = Field(..., min_length=1, max_length=4000)

    # Soft tags for filtering ("brand", "voice", "build-process") —
    # operator-curated, optional. Avoids a strict taxonomy.
    tags: list[str] = Field(default_factory=list)

    # Vector embedding produced by an embedding model. None until
    # PgVectorMemoryStore (or another semantic backend) generates one
    # for this row. JsonMemoryStore never populates this field.
    embedding: Optional[list[float]] = Field(default=None)
    embedding_model: Optional[str] = Field(default=None)

    # Free-form provenance bag. The TranscriptMemorySource might
    # stash the original session id, line count, etc. here. Keeps
    # the typed surface narrow without losing diagnostic detail.
    metadata: dict = Field(default_factory=dict)

    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)

    def is_character_wide(self) -> bool:
        return self.campaign_id is None

    def char_count(self) -> int:
        # Used by the composer's size budget. Title + content + a
        # newline-or-three of framing in the composed output.
        return len(self.title) + len(self.content) + 10
