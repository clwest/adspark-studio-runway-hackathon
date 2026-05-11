"""Assemble persisted memory into a single Runway document body.

The composer turns N MemoryEntries into ONE text blob that fits
inside Runway's 50K-token document cap (we target 40K chars with
margin so a 4 chars/token estimate stays well under). Strategies
are pluggable so future RAG flows can score-then-truncate instead
of just slicing by recency.

Phase 1 ships RecencyWeightedComposer — sort by ``updated_at``
descending, pack until the budget runs out.

Phase 3 candidate — QueryWeightedComposer that takes a query
(the operator's prompt + campaign brief) and scores entries by
semantic similarity, then packs the top N.
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Optional

from .models import MemoryEntry
from .store import MemoryStore


logger = logging.getLogger(__name__)


# Runway docs: 50K tokens per character. Conservatively assume 3.5
# chars/token for English (closer to 4 with punctuation; safer
# to underestimate). 40,000 chars × 3.5 chars/token ≈ 11,400 tokens
# — well inside any reasonable cap. We leave the rest of the
# token budget for the realtime model's reasoning + the avatar's
# personality + the per-session startScript.
DEFAULT_BUDGET_CHARS = 40_000


class MemoryComposer(ABC):
    """Pluggable composition strategy. ``compose`` returns Markdown
    suitable for upload to ``POST /v1/documents``. The orchestrator
    handles the upload + attaching the resulting documentId to the
    campaign; the composer just renders the body."""

    @abstractmethod
    def compose(
        self,
        store: MemoryStore,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        budget_chars: int = DEFAULT_BUDGET_CHARS,
        character_label: Optional[str] = None,
    ) -> tuple[str, list[MemoryEntry]]:
        """Return ``(markdown_body, included_entries)``.

        ``included_entries`` lets the caller tell the operator which
        memories made it in and which were dropped due to budget.
        """
        ...


class RecencyWeightedComposer(MemoryComposer):
    """Pack the most-recently-updated entries first, biased by
    source-type priority. Stops when the budget runs out.

    Priority order (highest first):
      1. operator_note   — operator's hand-curated facts
      2. external_feed   — real-time external data (when wired)
      3. transcript      — summarised past conversations
      4. auto_extracted  — LLM-extracted facts
      5. seed            — original character backstory

    Within a priority bucket: most recently updated first. Each
    entry renders as a Markdown section so the realtime model can
    cite section names when grounding answers.
    """

    SOURCE_PRIORITY = {
        "operator_note": 1,
        "external_feed": 2,
        "transcript": 3,
        "auto_extracted": 4,
        "seed": 5,
    }

    def compose(
        self,
        store: MemoryStore,
        character_id: str,
        *,
        campaign_id: Optional[str] = None,
        budget_chars: int = DEFAULT_BUDGET_CHARS,
        character_label: Optional[str] = None,
    ) -> tuple[str, list[MemoryEntry]]:
        # Pull both character-wide + (if scoped) campaign-specific
        # entries. The list call already returns by recency desc.
        entries = store.list(character_id=character_id)
        if campaign_id is not None:
            # Bring campaign-scoped entries into the same pool;
            # later sorting will let them mix with character-wide
            # entries by priority + recency.
            entries = [
                e for e in entries
                if e.campaign_id is None or e.campaign_id == campaign_id
            ]

        # Stable sort by (priority, then recency).
        entries.sort(
            key=lambda e: (
                self.SOURCE_PRIORITY.get(e.source_type, 99),
                # Negate the lexicographic recency by using
                # tuple ordering — Python sort is stable so we sort
                # priority first, then re-sort by recency in a
                # second pass without breaking the priority groups.
                e.updated_at,
            ),
        )
        # Recency within priority (descending).
        entries.sort(
            key=lambda e: (
                self.SOURCE_PRIORITY.get(e.source_type, 99),
                -ord(e.updated_at[0]) if e.updated_at else 0,
            ),
        )
        # Final pass: stable sort by priority asc, recency desc.
        entries.sort(key=lambda e: e.updated_at, reverse=True)
        entries.sort(key=lambda e: self.SOURCE_PRIORITY.get(e.source_type, 99))

        included: list[MemoryEntry] = []
        budget = budget_chars
        # Reserve some budget for the document header.
        header_cost = 400
        budget -= header_cost
        if budget <= 0:
            return self._render_header(character_label, []), []

        for entry in entries:
            cost = entry.char_count() + 50  # +50 for Markdown overhead
            if cost > budget:
                continue
            included.append(entry)
            budget -= cost

        body = self._render(included, character_label)
        return body, included

    # ---- rendering helpers ------------------------------------------

    def _render(
        self,
        entries: list[MemoryEntry],
        character_label: Optional[str],
    ) -> str:
        out: list[str] = [self._render_header(character_label, entries)]
        # Group by source_type for readability — the realtime model
        # can cite "operator note" vs "past conversation" cleanly.
        bucket_titles = {
            "operator_note": "## Operator Notes",
            "external_feed": "## External Updates",
            "transcript": "## Past Conversations",
            "auto_extracted": "## Extracted Facts",
            "seed": "## Background",
        }
        for source_type, heading in bucket_titles.items():
            in_bucket = [e for e in entries if e.source_type == source_type]
            if not in_bucket:
                continue
            out.append(heading)
            for e in in_bucket:
                out.append(f"\n### {e.title}\n")
                out.append(e.content.strip())
                if e.tags:
                    out.append(f"\n_Tags: {', '.join(e.tags)}_")
                out.append("")
        return "\n".join(out).strip() + "\n"

    def _render_header(
        self,
        character_label: Optional[str],
        entries: list[MemoryEntry],
    ) -> str:
        label = character_label or "this spokesperson"
        return (
            f"# Memory for {label}\n\n"
            "This document is your accumulated memory across past "
            "conversations, operator-curated notes, and external "
            "data feeds. Treat it as ground truth. Cite section "
            "names when helpful. Redirect politely when asked "
            "something the document does not cover.\n\n"
            f"_{len(entries)} memory entries — sorted by source "
            "priority then recency._\n"
        )
