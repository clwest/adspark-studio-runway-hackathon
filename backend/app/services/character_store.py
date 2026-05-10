"""Character resource store (PR K).

JSON-file backed store for Characters — durable brand identities
that outlive any single campaign.  Mirrors ``CampaignStore`` shape:
single-process safe via threading.Lock, atomic writes, lazy file
creation.

A Character is the V1 wrapper around the Runway-Avatar primitive
documented in ``docs/research/CHARACTER_STUDIO_SPIKE.md``: portrait
+ persona + voice preset + Runway avatar binding, with provenance
back to the campaign that created it (when applicable).

Storage layout:

    backend/data/characters.json                     — JSON list of records
    backend/data/characters/<id>-portrait.png        — generated portrait
    backend/data/characters/<id>-avatar-thumb.jpg    — cached Runway thumb
"""
from __future__ import annotations

import json
import logging
import re
import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from ..models import Character, CharacterCreate

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()


# PR BB — cap the per-character voice repair audit trail so the
# JSON record never grows unbounded across long demo sessions.
VOICE_HISTORY_MAX = 20


def _slugify(name: str) -> str:
    """Lowercase + alphanumeric/hyphens only. Used for deterministic
    short labels and (potential future) URL paths.
    """
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s[:60] or "character"


class CharacterStore:
    """Thread-safe JSON-file store for Character records."""

    def __init__(self, data_dir: Path):
        self.path = data_dir / "characters.json"
        data_dir.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self.path.write_text("[]", encoding="utf-8")
        # Ensure cache subdirectory exists for portrait + thumbnail blobs
        self.cache_dir = data_dir / "characters"
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _read(self) -> list[dict]:
        try:
            return json.loads(self.path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            return []

    def _write(self, rows: list[dict]) -> None:
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps(rows, indent=2, default=str), encoding="utf-8")
        tmp.replace(self.path)

    def list(self) -> list[Character]:
        with _LOCK:
            rows = self._read()
        return [Character.model_validate(r) for r in rows]

    def get(self, character_id: str) -> Optional[Character]:
        with _LOCK:
            rows = self._read()
        for row in rows:
            if row.get("id") == character_id:
                return Character.model_validate(row)
        return None

    def create(self, payload: CharacterCreate) -> Character:
        now = datetime.now(timezone.utc)
        record = Character(
            id=uuid.uuid4().hex[:12],
            slug=_slugify(payload.name),
            name=payload.name,
            template=payload.template,
            subject=payload.subject,
            style=payload.style,
            personality=payload.personality,
            catchphrases=payload.catchphrases,
            voice_preset=(payload.voice_preset or "vincent").lower(),
            source_campaign_id=payload.source_campaign_id,
            created_at=now,
            updated_at=now,
        )
        with _LOCK:
            rows = self._read()
            rows.insert(0, json.loads(record.model_dump_json()))
            self._write(rows)
        return record

    def update(self, character_id: str, **fields: Any) -> Optional[Character]:
        """Patch arbitrary fields on a Character. Always bumps
        ``updated_at``. Returns ``None`` when the id isn't found.
        """
        if not fields:
            return self.get(character_id)
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == character_id:
                    for k, v in fields.items():
                        row[k] = v
                    row["updated_at"] = datetime.now(timezone.utc).isoformat()
                    self._write(rows)
                    return Character.model_validate(row)
        return None

    def append_voice_history(
        self,
        character_id: str,
        entry: dict,
        *,
        max_entries: int = VOICE_HISTORY_MAX,
    ) -> bool:
        """PR BB — append a single voice-action audit entry to the
        character's ``voice_repair_history`` list (newest first) and
        cap it at ``max_entries``. Returns True when an entry landed
        on a known character; False when the id is unknown.

        Best-effort: callers wrap this in try/except so an audit
        failure never aborts the underlying clone / apply / refresh
        flow. The append always bumps ``updated_at``.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == character_id:
                    history = list(row.get("voice_repair_history") or [])
                    # ``timestamp`` is normalised to an ISO-formatted string
                    # before insertion so the stored JSON survives
                    # round-trips through ``json.loads``.
                    history.insert(0, entry)
                    row["voice_repair_history"] = history[:max_entries]
                    row["updated_at"] = datetime.now(timezone.utc).isoformat()
                    self._write(rows)
                    return True
        return False

    # PR CX — Knowledge sources. Stored on the Character record's
    # ``knowledge_sources`` list (newest first). Cap at 20 entries to
    # keep the JSON file bounded for a long demo session.
    def append_knowledge_source(
        self,
        character_id: str,
        entry: dict,
        *,
        max_entries: int = 20,
    ) -> Optional[Character]:
        """Append a single knowledge source. Returns the updated
        Character, or ``None`` when the id is unknown.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") == character_id:
                    sources = list(row.get("knowledge_sources") or [])
                    sources.insert(0, entry)
                    row["knowledge_sources"] = sources[:max_entries]
                    row["updated_at"] = datetime.now(timezone.utc).isoformat()
                    self._write(rows)
                    return Character.model_validate(row)
        return None

    def delete_knowledge_source(
        self,
        character_id: str,
        source_id: str,
    ) -> Optional[Character]:
        """Remove one knowledge source by id. Returns the updated
        Character on success; ``None`` when neither the character nor
        the source id is found.
        """
        with _LOCK:
            rows = self._read()
            for row in rows:
                if row.get("id") != character_id:
                    continue
                sources = list(row.get("knowledge_sources") or [])
                kept = [s for s in sources if s.get("id") != source_id]
                if len(kept) == len(sources):
                    return None
                row["knowledge_sources"] = kept
                row["updated_at"] = datetime.now(timezone.utc).isoformat()
                self._write(rows)
                return Character.model_validate(row)
        return None

    def delete(self, character_id: str) -> bool:
        """Local delete — does NOT call Runway DELETE. Returns True if
        a record was removed.  Caller is responsible for clearing
        cached portrait/thumbnail files and any campaign references.
        """
        with _LOCK:
            rows = self._read()
            keep = [r for r in rows if r.get("id") != character_id]
            if len(keep) == len(rows):
                return False
            self._write(keep)
            return True

    # ---- portrait file helpers --------------------------------------

    def portrait_path(self, character_id: str) -> Path:
        return self.cache_dir / f"{character_id}-portrait.png"

    def thumbnail_path(self, character_id: str) -> Path:
        return self.cache_dir / f"{character_id}-avatar-thumb.jpg"

    def has_portrait(self, character_id: str) -> bool:
        return self.portrait_path(character_id).exists()
