"""Runway documents client (PR AI).

Tiny helper around ``/v1/documents`` for the Avatar `documentIds` /
realtime grounding flow. Documents carry plain-text or Markdown
campaign knowledge that the realtime avatar can reference instead of
relying solely on the inline ``personality`` string.

Per ``docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md`` §2.6 + §5:
- ``POST /v1/documents`` body: ``{name, content}``.
- ``PATCH /v1/avatars/{id}`` body: ``{documentIds: [...]}`` (best-effort
  binding; Character OS currently prefers the per-session ``documentIds``
  field on ``/v1/realtime_sessions`` to keep document scope per-campaign).
- Up to 50,000 tokens of plain text + Markdown per avatar.

Mock mode short-circuits with deterministic ids so the smoke + offline
demo flows can flip the grounding badge on without burning credits.
The realtime broker treats a mock document id like any other id and
includes it in the session body; Runway will reject the unknown id at
session-create time, at which point the broker's existing 400-fallback
retries the bare body. So mock-mode grounding is "wired and visible"
without ever pretending the live realtime session is grounded.
"""
from __future__ import annotations

import hashlib
import logging
from dataclasses import dataclass
from typing import Optional

import httpx

from ..config import Settings

logger = logging.getLogger(__name__)

# Runway hard cap. We trim well under it so the wire never sees a
# rejection on size. The personality cap (10k chars) lives in the
# realtime broker; the document cap is the wider knowledge surface.
DOCUMENT_MAX_CHARS = 40_000
DOCUMENT_NAME_MAX = 120


@dataclass
class DocumentResult:
    """Result of a ``POST /v1/documents`` create. Mock-mode runs always
    return ``status="mock"``; real runs return ``"ready"`` on success
    and ``"failed"`` on any HTTP / network error.
    """

    status: str  # "ready" | "failed" | "mock"
    document_id: Optional[str] = None
    error: Optional[str] = None
    mock_mode: bool = False


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


def _mock_document_id(name: str, content: str) -> str:
    """Deterministic mock id so re-runs in mock mode are stable across
    a probe / smoke / replay cycle. Hash both name + content so a
    re-attach with edited content gets a new id.
    """
    digest = hashlib.sha256(f"{name}\n{content}".encode("utf-8")).hexdigest()[:16]
    return f"mock_doc_{digest}"


def create_document(
    name: str,
    content: str,
    settings: Settings,
    *,
    timeout: float = 20.0,
) -> DocumentResult:
    """Create a Runway document for the given ``name`` + ``content``.
    Returns a ``DocumentResult`` carrying the new document id (real or
    mock) plus a status the caller can persist on the campaign record.

    Never raises — caller inspects the result. Real-mode HTTP errors
    surface as ``status="failed"`` so the route can fall back cleanly
    to the personality-only realtime path.
    """
    name = (name or "Campaign Brief").strip()[:DOCUMENT_NAME_MAX]
    content = (content or "").strip()[:DOCUMENT_MAX_CHARS]
    if not content:
        return DocumentResult(
            status="failed",
            error="document content is empty",
            mock_mode=settings.runway_mock,
        )

    if settings.runway_mock:
        return DocumentResult(
            status="mock",
            document_id=_mock_document_id(name, content),
            mock_mode=True,
        )

    url = f"{settings.runway_api_base}/v1/documents"
    body = {"name": name, "content": content}
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, headers=_runway_headers(settings), json=body)
        if resp.status_code not in (200, 201):
            return DocumentResult(
                status="failed",
                error=f"document create rc={resp.status_code}: {resp.text[:200]}",
            )
        payload = resp.json()
    except httpx.HTTPError as exc:
        return DocumentResult(
            status="failed",
            error=f"http error: {exc!s}"[:200],
        )
    except ValueError as exc:
        return DocumentResult(
            status="failed",
            error=f"non-json response: {exc!s}"[:200],
        )

    doc_id = payload.get("id") or payload.get("documentId")
    if not doc_id:
        return DocumentResult(
            status="failed",
            error=f"create response missing id: {str(payload)[:200]}",
        )
    return DocumentResult(status="ready", document_id=doc_id)


def attach_documents_to_avatar(
    avatar_id: str,
    document_ids: "list[str]",
    settings: Settings,
    *,
    timeout: float = 15.0,
) -> bool:
    """Best-effort ``PATCH /v1/avatars/{id}`` to bind one or more
    document ids to the avatar resource. Used for the secondary
    persistence path: a brand that just hits ``/v1/realtime_sessions``
    against the avatar without a campaign-scoped session body still
    sees the documents.

    Returns ``True`` on a 2xx, ``False`` for mock mode, missing avatar
    id, or any HTTP / network error. Never raises — the caller logs
    the warning and continues; Character OS's primary grounding path is the
    per-session ``documentIds`` field on the realtime session create
    body, so a PATCH failure here does not break realtime.
    """
    if settings.runway_mock or not avatar_id or not document_ids:
        return False
    url = f"{settings.runway_api_base}/v1/avatars/{avatar_id}"
    body = {"documentIds": list(dict.fromkeys(document_ids))}  # de-dupe, preserve order
    try:
        with httpx.Client(timeout=timeout) as client:
            resp = client.patch(url, headers=_runway_headers(settings), json=body)
    except httpx.HTTPError as exc:
        logger.warning("avatar PATCH http error for %s: %s", avatar_id, exc)
        return False
    if resp.status_code >= 400:
        logger.warning(
            "avatar PATCH non-2xx for %s: %s %s",
            avatar_id, resp.status_code, resp.text[:200],
        )
        return False
    return True


def build_campaign_brief_markdown(campaign: dict, character: Optional[dict]) -> tuple[str, str]:
    """Compose a small Markdown brand brief from the saved campaign +
    optional attached character. Returns ``(name, content)`` ready for
    ``create_document``. Lives in this module so the same shape can be
    re-used by future "regenerate brief" flows without bouncing through
    a route layer.

    Sections (all conditional on data presence):
    - Header line with brand + product
    - Audience / tone
    - Selected concept (hook / caption / CTA / visual)
    - Saved Commercial Script
    - Character (name / template / voice / personality / catchphrases)
    - Behavioural rules (always added — small, explicit guidance for
      the avatar's grounded answers)
    """
    business = (campaign.get("business") or "").strip()
    product = (campaign.get("product") or "").strip()
    audience = (campaign.get("audience") or "").strip()
    tone = (campaign.get("tone") or "").strip()
    runway_prompt = (campaign.get("runway_prompt") or "").strip()
    commercial_script = (campaign.get("commercial_script") or "").strip()
    concept = campaign.get("selected_concept") or {}
    hook = (concept.get("hook") or "").strip()
    caption = (concept.get("caption") or "").strip()
    cta = (concept.get("cta") or "").strip()
    visual = (concept.get("visual") or "").strip()

    lines: list[str] = []
    if business:
        title = f"# {business}"
        if product:
            title += f" · {product}"
        lines.append(title)
        lines.append("")

    bullets: list[str] = []
    if audience:
        bullets.append(f"- **Audience:** {audience}")
    if tone:
        bullets.append(f"- **Tone:** {tone}")
    if bullets:
        lines.extend(bullets)
        lines.append("")

    if hook or caption or cta or visual:
        lines.append("## Selected concept")
        if hook:
            lines.append(f"- **Hook:** {hook}")
        if caption:
            lines.append(f"- **Caption:** {caption}")
        if cta:
            lines.append(f"- **Call to action:** {cta}")
        if visual:
            lines.append(f"- **Visual direction:** {visual}")
        lines.append("")

    if commercial_script:
        lines.append("## Commercial script")
        lines.append(commercial_script)
        lines.append("")
    elif runway_prompt:
        lines.append("## Visual prompt (silent cinematic context only)")
        lines.append(runway_prompt)
        lines.append("")

    if character:
        char_name = (character.get("name") or "").strip()
        char_template = (character.get("template") or "").strip()
        char_voice = (character.get("voice_preset") or "").strip()
        char_personality = (character.get("personality") or "").strip()
        catchphrases = [
            c for c in (character.get("catchphrases") or []) if (c or "").strip()
        ]
        if any([char_name, char_template, char_voice, char_personality, catchphrases]):
            lines.append("## Character")
            if char_name:
                lines.append(f"- **Name:** {char_name}")
            if char_template:
                lines.append(f"- **Template:** {char_template}")
            if char_voice:
                lines.append(f"- **Voice preset:** {char_voice}")
            if char_personality:
                lines.append(f"- **Personality:** {char_personality}")
            if catchphrases:
                quoted = ", ".join(f"\"{c}\"" for c in catchphrases[:8])
                lines.append(f"- **Catchphrases:** {quoted}")
            lines.append("")

    lines.append("## Behaviour")
    lines.append(
        "- Answer questions about the business, product, audience, and "
        "campaign concept above using only the facts in this brief.")
    lines.append(
        "- Speak in the saved tone and personality. Stay concise and "
        "brand-honest.")
    lines.append(
        "- If asked something not covered here, redirect politely back "
        "to the campaign or say you don't have that information.")

    name_bits = [b for b in [business or "Campaign", "Brief"] if b]
    name = " · ".join(name_bits)
    content = "\n".join(lines).strip()
    return name, content
