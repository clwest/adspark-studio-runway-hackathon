"""MemoryOrchestrator — the only thing routes call.

Wires up the default storage backend, default sources, and default
composer for a given Settings. Provides two methods routes need:

  ingest_from_all_sources(character_id, *, campaign_id=None) -> int
      Runs every registered source, adds new entries to the store,
      returns the count of new entries.

  compose_and_publish(character_id, *, campaign_id=None) -> dict
      Composes a Runway document body from the accumulated memory,
      uploads via the existing documents_client (PR AI), attaches the
      resulting documentId to the campaign (when campaign_id given).
      Returns a diagnostic dict with the new document id + included
      entry count + dropped entry count.

Swap sources / store / composer via the keyword arguments to
``build_orchestrator``. Tests and future RAG flows pass custom
implementations; production routes use the defaults.
"""
from __future__ import annotations

import logging
from functools import lru_cache
from typing import Optional

from ...config import Settings
from .composer import MemoryComposer, RecencyWeightedComposer
from .models import MemoryEntry
from .sources import (
    MemorySource,
    OperatorNoteSource,
    TranscriptMemorySource,
)
from .store import MemoryStore, build_default_store


logger = logging.getLogger(__name__)


class MemoryOrchestrator:
    """Coordinates the pluggable pieces. Construction wires the
    defaults; callers (tests, future routes) can override any of
    them."""

    def __init__(
        self,
        *,
        store: MemoryStore,
        sources: list[MemorySource],
        composer: MemoryComposer,
    ) -> None:
        self._store = store
        self._sources = sources
        self._composer = composer

    @property
    def store(self) -> MemoryStore:
        """Routes may want direct read access for listing /
        diagnostics; mutations should go through ingest_*."""
        return self._store

    def register_source(self, source: MemorySource) -> None:
        """Add a new source after construction — useful for tests
        or runtime-discovered external feeds."""
        self._sources.append(source)

    # ---- ingest ------------------------------------------------------

    def ingest_from_all_sources(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        settings: Optional[Settings] = None,
    ) -> dict:
        """Pull from every registered source and persist new entries.

        Returns a diagnostic dict::

            {
                "added": int,                        # total entries persisted
                "per_source": {name: count, ...},
                "errors": [{"source": str, "err": str}, ...],
            }
        """
        added = 0
        per_source: dict[str, int] = {}
        errors: list[dict] = []
        for source in self._sources:
            count = 0
            try:
                candidates = source.fetch_entries(
                    character_id,
                    campaign_id=campaign_id,
                    settings=settings,
                )
            except Exception as exc:
                logger.warning(
                    "memory source %s failed: %s", source.name, exc,
                )
                errors.append({"source": source.name, "err": str(exc)[:200]})
                continue
            for entry in candidates:
                try:
                    self._store.add(entry)
                    count += 1
                except Exception as exc:
                    logger.warning(
                        "memory store add failed for %s: %s",
                        source.name, exc,
                    )
                    errors.append({
                        "source": source.name, "err": str(exc)[:200],
                    })
            per_source[source.name] = count
            added += count
        return {
            "added": added,
            "per_source": per_source,
            "errors": errors,
        }

    # ---- compose + publish ------------------------------------------

    def compose_document_body(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        character_label: Optional[str] = None,
    ) -> tuple[str, list[MemoryEntry]]:
        """Pure compose — no Runway upload. Useful for previewing in
        the UI or for tests."""
        return self._composer.compose(
            self._store,
            character_id,
            campaign_id=campaign_id,
            character_label=character_label,
        )

    def compose_and_publish(
        self,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        character_label: Optional[str] = None,
        settings: Optional[Settings] = None,
        publisher=None,
    ) -> dict:
        """Compose the memory document, hand it to the supplied
        ``publisher`` callable to upload to Runway, return diagnostics.

        ``publisher`` signature::

            publisher(name: str, content: str, settings: Settings)
                -> {"document_id": str, "status": str}

        Defaults to None — callers pass the existing
        ``documents_client.create_document`` (PR AI) in production.
        Tests can pass a recorder.

        When publisher is None we return the composed body without
        uploading; useful for unit tests and for the future UI
        preview path.
        """
        body, included = self.compose_document_body(
            character_id,
            campaign_id=campaign_id,
            character_label=character_label,
        )
        result: dict = {
            "character_id": character_id,
            "campaign_id": campaign_id,
            "included_count": len(included),
            "body_chars": len(body),
            "document_id": None,
            "published": False,
        }
        if publisher is None or not settings:
            return result
        try:
            uploaded = publisher(
                f"memory:{character_id}", body, settings,
            )
            result["document_id"] = (uploaded or {}).get("document_id")
            result["published"] = bool(result["document_id"])
        except Exception as exc:
            logger.warning(
                "memory publish failed for character=%s: %s",
                character_id, exc,
            )
            result["error"] = str(exc)[:200]
        return result


# ---- factory + cached singleton -----------------------------------


def build_orchestrator(
    settings: Settings,
    *,
    store: Optional[MemoryStore] = None,
    sources: Optional[list[MemorySource]] = None,
    composer: Optional[MemoryComposer] = None,
    character_lookup=None,
) -> MemoryOrchestrator:
    """Construct an orchestrator with the supplied implementations,
    falling back to the Phase 1 defaults.

    ``character_lookup`` is required for OperatorNoteSource (when no
    custom ``sources`` list is supplied). It's a callable
    ``(character_id) -> dict | None`` that reads the Character row.
    Lazy-imported below to avoid a circular dependency on
    CharacterStore.
    """
    store = store or build_default_store(settings.data_path)
    composer = composer or RecencyWeightedComposer()

    if sources is None:
        # Build the Phase 1 default source list. character_lookup is
        # only required when OperatorNoteSource is included.
        if character_lookup is None:
            from ..character_store import CharacterStore

            cs = CharacterStore(settings.data_path)

            def _lookup(character_id: str):
                rec = cs.get(character_id)
                return rec.model_dump() if rec else None
            character_lookup = _lookup
        sources = [OperatorNoteSource(character_lookup=character_lookup)]
        # TranscriptMemorySource needs three callables; lazy-construct
        # so test setups that don't need transcripts don't fail.
        sources.append(_build_default_transcript_source(settings))

    return MemoryOrchestrator(
        store=store, sources=sources, composer=composer,
    )


def _build_default_transcript_source(settings: Settings) -> TranscriptMemorySource:
    """Wire the TranscriptMemorySource to the campaign's existing
    ``realtime_transcript_history`` audit trail (PR BC) — the turns
    are already inline on each entry, so no Runway re-fetch is
    needed. Summariser uses Llama via the OpenAI-compatible endpoint
    (PR EH).

    All three callables are constructed lazily so test setups that
    don't need the transcript source can override before construction.
    """

    def _session_lookup(character_id: str, campaign_id: Optional[str]):
        """Return conversation_ids from the campaign's realtime
        transcript history. Today sessions are tied to campaigns;
        when no campaign is supplied we return an empty list and the
        caller is expected to iterate per-campaign separately."""
        if not campaign_id:
            return []
        from ..storage import CampaignStore
        cs = CampaignStore(settings.data_path)
        camp = cs.get(campaign_id)
        if not camp:
            return []
        history = camp.realtime_transcript_history or []
        return [
            entry.conversation_id
            for entry in history
            if entry.conversation_id and (entry.status or "") == "ok"
        ]

    def _fetch_transcript(conversation_id: str, _settings: Optional[Settings]):
        """The transcript turns are stored inline in
        ``realtime_transcript_history`` — find the matching entry
        across campaigns and stringify its turns. No Runway call."""
        from ..storage import CampaignStore
        cs = CampaignStore(_settings.data_path if _settings else settings.data_path)
        # Linear scan campaigns for the matching conversation_id.
        # OK at hackathon scale; replaceable with an index later.
        for camp in cs.list():
            for entry in (camp.realtime_transcript_history or []):
                if entry.conversation_id == conversation_id:
                    return "\n".join(
                        f"{(t.role or '').upper()}: {t.text}"
                        for t in (entry.turns or [])
                        if (t.text or "").strip()
                    )
        return None

    def _summarise(transcript: str, character_id: str, _settings: Optional[Settings]):
        """Llama-summarise the transcript into ≤280 chars. Falls
        back to a head-slice when Llama is unreachable."""
        s = _settings or settings
        try:
            # Reuse the same OpenAI-compatible client wiring the
            # concept service uses (PR EH). The summariser prompt
            # is dedicated rather than hijacked from generate_ad_script
            # since we want third-person prose, not first-person ad copy.
            from openai import OpenAI  # type: ignore
            provider = (s.llm_provider or "openai").strip().lower()
            if provider == "ollama":
                client = OpenAI(api_key="ollama", base_url=s.ollama_base_url)
                model = s.ollama_model
            elif not s.openai_mock:
                client = OpenAI(api_key=s.openai_api_key)
                model = s.openai_model
            else:
                # Mock mode — deterministic head-slice fallback.
                return transcript[:280]
            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": (
                            "Summarise the following conversation "
                            "transcript into ONE single ≤280-char "
                            "memory note describing what the "
                            "spokesperson discussed and any facts "
                            "or commitments they shared. Write in "
                            "third person about the spokesperson "
                            "and the operator. No preamble, no "
                            "JSON, just the prose summary."
                        ),
                    },
                    {"role": "user", "content": transcript[:8000]},
                ],
                temperature=0.4,
            )
            content = completion.choices[0].message.content or ""
            return content.strip()[:280]
        except Exception:
            return transcript[:280]

    return TranscriptMemorySource(
        session_lookup=_session_lookup,
        transcript_fetcher=_fetch_transcript,
        summariser=_summarise,
    )


@lru_cache(maxsize=1)
def get_orchestrator(settings: Settings) -> MemoryOrchestrator:
    """Cached singleton for FastAPI dependency injection. Routes do
    ``orchestrator = get_orchestrator(get_settings())`` and reuse the
    same instance across requests.

    Cache is keyed on the Settings object (hashable via its
    pydantic-settings shape). Tests that need a fresh orchestrator
    call ``get_orchestrator.cache_clear()``.
    """
    return build_orchestrator(settings)
