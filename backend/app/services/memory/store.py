"""Pluggable memory storage backends.

The ABC defines what every backend must support; concrete classes
fill in the persistence + search details. Swap is a constructor
call away — no callers change when we add PgVectorMemoryStore.

Phase 1 ships JsonMemoryStore (file-backed, keyword fallback search).
Phase 3 adds PgVectorMemoryStore (Postgres + pgvector + cosine
similarity via Ollama-generated embeddings).
"""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from abc import ABC, abstractmethod
from pathlib import Path
from typing import Optional

from .models import MemoryEntry, MemorySourceType, _now_iso


logger = logging.getLogger(__name__)


class MemoryStore(ABC):
    """Abstract storage backend. Concrete subclasses MUST implement
    every method.

    The interface is intentionally CRUD + a single search verb so
    naive (substring) and semantic (vector) backends both fit. Search
    semantics: caller passes a free-text query; backend returns the
    rows it considers most relevant up to ``limit``. JsonMemoryStore
    interprets relevance as substring match score; PgVectorMemoryStore
    will interpret it as cosine similarity over embeddings.

    Backends MUST NOT mutate MemoryEntry instances they return —
    callers may rely on the value object semantics.
    """

    @abstractmethod
    def add(self, entry: MemoryEntry) -> MemoryEntry:
        ...

    @abstractmethod
    def update(self, entry_id: str, **fields) -> Optional[MemoryEntry]:
        ...

    @abstractmethod
    def delete(self, entry_id: str) -> bool:
        ...

    @abstractmethod
    def get(self, entry_id: str) -> Optional[MemoryEntry]:
        ...

    @abstractmethod
    def list(
        self,
        *,
        character_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        source_type: Optional[MemorySourceType] = None,
        tags: Optional[list[str]] = None,
        limit: Optional[int] = None,
    ) -> list[MemoryEntry]:
        ...

    @abstractmethod
    def search(
        self,
        query: str,
        *,
        character_id: Optional[str] = None,
        limit: int = 10,
    ) -> list[MemoryEntry]:
        ...

    @abstractmethod
    def total_chars(self, character_id: str) -> int:
        """Sum of every entry's ``char_count`` for one character.
        The composer reads this to know if it's near Runway's
        document cap."""
        ...

    # ---- helpers shared across backends -----------------------------

    @staticmethod
    def new_id() -> str:
        return uuid.uuid4().hex[:16]


class JsonMemoryStore(MemoryStore):
    """File-backed store. One JSON file per character at
    ``<data_dir>/memory/character-<id>.json``. All operations take a
    process-wide lock so concurrent FastAPI workers don't trample
    each other (same pattern as CampaignStore in storage.py).

    Search is naive: case-insensitive substring scoring on
    title + content + tags. Good enough for hackathon-sized memory
    sets (<1000 entries per character). When we hit the limits of
    keyword search, swap to PgVectorMemoryStore — same interface.
    """

    def __init__(self, data_dir: Path) -> None:
        self._dir = Path(data_dir).resolve() / "memory"
        self._dir.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()

    # ---- file IO ----------------------------------------------------

    def _path(self, character_id: str) -> Path:
        # Defensive: prevent path traversal via crafted character ids.
        if "/" in character_id or ".." in character_id or not character_id:
            raise ValueError(f"unsafe character_id: {character_id!r}")
        return self._dir / f"character-{character_id}.json"

    def _read(self, character_id: str) -> list[MemoryEntry]:
        path = self._path(character_id)
        if not path.exists():
            return []
        try:
            payload = json.loads(path.read_text())
        except (json.JSONDecodeError, OSError) as exc:
            logger.warning("memory file unreadable for %s: %s", character_id, exc)
            return []
        if not isinstance(payload, list):
            logger.warning("memory file shape unexpected for %s", character_id)
            return []
        entries: list[MemoryEntry] = []
        for raw in payload:
            try:
                entries.append(MemoryEntry(**raw))
            except Exception as exc:  # pragma: no cover — corrupt rows
                logger.warning(
                    "memory row dropped for %s: %s", character_id, exc,
                )
        return entries

    def _write(self, character_id: str, entries: list[MemoryEntry]) -> None:
        path = self._path(character_id)
        tmp = path.with_suffix(path.suffix + ".tmp")
        payload = [e.model_dump() for e in entries]
        tmp.write_text(json.dumps(payload, indent=2, default=str))
        tmp.replace(path)

    def _find_owner(self, entry_id: str) -> Optional[str]:
        """Linear scan across every character file for ``entry_id``.
        Cheap for hackathon scale; replaceable by an index in a
        future backend."""
        for path in self._dir.glob("character-*.json"):
            try:
                payload = json.loads(path.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            if not isinstance(payload, list):
                continue
            for raw in payload:
                if raw.get("id") == entry_id:
                    return raw.get("character_id")
        return None

    # ---- MemoryStore implementation ---------------------------------

    def add(self, entry: MemoryEntry) -> MemoryEntry:
        with self._lock:
            entries = self._read(entry.character_id)
            # Dedupe on source_id when the source supplies one — re-
            # ingesting the same upstream object replaces the prior
            # row, doesn't duplicate it.
            if entry.source_id:
                entries = [
                    e for e in entries
                    if not (
                        e.source_type == entry.source_type
                        and e.source_id == entry.source_id
                    )
                ]
            entries.append(entry)
            self._write(entry.character_id, entries)
        return entry

    def update(self, entry_id: str, **fields) -> Optional[MemoryEntry]:
        owner = self._find_owner(entry_id)
        if not owner:
            return None
        with self._lock:
            entries = self._read(owner)
            for i, e in enumerate(entries):
                if e.id == entry_id:
                    updated = e.model_copy(
                        update={**fields, "updated_at": _now_iso()},
                    )
                    entries[i] = updated
                    self._write(owner, entries)
                    return updated
        return None

    def delete(self, entry_id: str) -> bool:
        owner = self._find_owner(entry_id)
        if not owner:
            return False
        with self._lock:
            entries = self._read(owner)
            next_entries = [e for e in entries if e.id != entry_id]
            if len(next_entries) == len(entries):
                return False
            self._write(owner, next_entries)
            return True

    def get(self, entry_id: str) -> Optional[MemoryEntry]:
        owner = self._find_owner(entry_id)
        if not owner:
            return None
        for e in self._read(owner):
            if e.id == entry_id:
                return e
        return None

    def list(
        self,
        *,
        character_id: Optional[str] = None,
        campaign_id: Optional[str] = None,
        source_type: Optional[MemorySourceType] = None,
        tags: Optional[list[str]] = None,
        limit: Optional[int] = None,
    ) -> list[MemoryEntry]:
        if character_id is None:
            # Cross-character listing — read every file. Expensive but
            # only used for diagnostics in this backend.
            entries: list[MemoryEntry] = []
            for path in self._dir.glob("character-*.json"):
                cid = path.stem.removeprefix("character-")
                entries.extend(self._read(cid))
        else:
            entries = self._read(character_id)

        if campaign_id is not None:
            entries = [e for e in entries if e.campaign_id == campaign_id]
        if source_type is not None:
            entries = [e for e in entries if e.source_type == source_type]
        if tags:
            tag_set = {t.lower() for t in tags}
            entries = [
                e for e in entries
                if tag_set.issubset({t.lower() for t in e.tags})
            ]

        # Most recent first — recency is the default ordering signal.
        entries.sort(key=lambda e: e.updated_at, reverse=True)
        if limit is not None:
            entries = entries[:limit]
        return entries

    def search(
        self,
        query: str,
        *,
        character_id: Optional[str] = None,
        limit: int = 10,
    ) -> list[MemoryEntry]:
        """Naive keyword scoring. Each entry gets a score based on
        substring occurrences of the query tokens in title + content
        + tags. Ties broken by recency."""
        q = (query or "").strip().lower()
        if not q:
            return self.list(character_id=character_id, limit=limit)

        tokens = [t for t in re.findall(r"\w+", q) if len(t) >= 2]
        if not tokens:
            return self.list(character_id=character_id, limit=limit)

        candidates = self.list(character_id=character_id)
        scored: list[tuple[int, str, MemoryEntry]] = []
        for e in candidates:
            haystack = (
                f"{e.title}\n{e.content}\n{' '.join(e.tags)}".lower()
            )
            score = sum(haystack.count(tok) for tok in tokens)
            if score > 0:
                scored.append((score, e.updated_at, e))
        # Higher score first; recency breaks ties.
        scored.sort(key=lambda row: (-row[0], row[1]), reverse=False)
        scored.sort(key=lambda row: row[0], reverse=True)
        return [row[2] for row in scored[:limit]]

    def total_chars(self, character_id: str) -> int:
        return sum(e.char_count() for e in self._read(character_id))


def build_default_store(data_dir: Path) -> MemoryStore:
    """Factory for the default backend in this phase. Routes call
    this; swapping the backend is one line."""
    return JsonMemoryStore(data_dir)
