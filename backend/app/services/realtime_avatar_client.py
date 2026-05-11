"""Runway realtime avatar session broker (PR I).

Three-party broker for the "Talk to your Brand Spokesperson" feature.
Creates a /v1/realtime_sessions session, polls until READY, then
returns ONLY the client-safe payload (session id, session key, expiry)
to the browser.  ``RUNWAY_API_KEY`` never leaves FastAPI.

Mock mode short-circuits with a structured "unavailable" error; the
router maps it to HTTP 503 so the frontend can render a disabled
button instead of attempting WebRTC.

Realtime is **strictly additive** — every other Character OS flow keeps
working when this surface is unavailable. The broker assumes the
campaign already has a READY Brand Spokesperson Avatar (PR F V2);
the router enforces the gate.

See ``docs/research/RUNWAY_REALTIME_SPOKESPERSON_SPIKE.md`` for the
locked schema and the rationale behind every choice in this module.

PR AE — campaign context injection. The session-create body now
carries ``personality`` + ``startScript`` overrides composed from
the saved campaign + character + commercial_script so the live
avatar opens with brand-aware context instead of a generic greeting.
The overrides are documented in
``docs/research/RUNWAY_AVATAR_API_DEEP_REVIEW.md`` §5.
"""
from __future__ import annotations

import logging
import re
import time
from dataclasses import dataclass
from typing import Optional

import httpx

from ..config import Settings
from ..models import Campaign
from .character_host_client import active_avatar_id, active_avatar_status

logger = logging.getLogger(__name__)

_REALTIME_MODEL = "gwm1_avatars"

# Empirical: NOT_READY → READY in ~1.5 s. Allow generous slack for
# upstream variability without blocking the request indefinitely.
_READY_POLL_INTERVAL_S = 0.5
# PR EM-h — bumped from 60→150s. On hackathon submission day the
# Runway dev API stays stuck on NOT_READY well past the 60s cap
# (verified: 96 polls / NOT_READY across the full window, then a
# fresh POST + GET would succeed). 150s gives the upstream room to
# flip without the operator having to re-click. We pay for this
# only on cold/under-load sessions — when Runway is healthy the
# very first poll returns READY and the cap is irrelevant.
#
# Prior history: PR EM-e3 went 30→60s. PR I shipped at 30s.
_READY_POLL_TIMEOUT_S = 150.0

# PR AE — Runway documents personality up to 10,000 chars.
# Cap below that on a sentence boundary so we never bump the wire.
_PERSONALITY_MAX = 9500
# Empirical avatar_videos limit; safe ceiling for an opening line.
_START_SCRIPT_MAX = 280
_SENTENCE_SPLIT = re.compile(r"(?<=[.!?])\s+")


@dataclass
class RealtimeSession:
    """Client-safe shape returned by the broker. Mirrors what
    ``@runwayml/avatars-react`` consumes via ``<AvatarCall>``.
    """

    session_id: str
    session_key: str  # JWT-shaped opaque token; safe for the browser
    expires_at: Optional[str] = None
    avatar_id: Optional[str] = None


class RealtimeUnavailableError(RuntimeError):
    """Raised when realtime cannot proceed — mock mode, missing avatar,
    or persistent upstream failure. Router maps to 503 / 409 / 502.
    """


def _redact(text: str, limit: int = 200) -> str:
    """Defensive log-safety helper. Strips Bearer tokens, sessionKey
    JWT-shaped strings, and `key_…`/`rwk_…` patterns before truncating
    to ``limit`` chars. Used for any external-response text we log so a
    misbehaving upstream can never leak credentials into the log file.
    """
    if not text:
        return ""
    cleaned = re.sub(r"Bearer\s+[A-Za-z0-9._\-]+", "Bearer <redacted>", text)
    cleaned = re.sub(
        r"\b(?:sk_|rwk_|key_|sessionKey)[A-Za-z0-9._\-]+", "<redacted>", cleaned,
    )
    cleaned = re.sub(r"\beyJ[A-Za-z0-9._\-]{20,}", "<redacted-jwt>", cleaned)
    cleaned = cleaned.replace("\n", " ").strip()
    return cleaned[:limit]


def _runway_headers(settings: Settings) -> dict[str, str]:
    return {
        "Authorization": f"Bearer {settings.runway_api_key}",
        "X-Runway-Version": settings.runway_api_version,
        "Content-Type": "application/json",
    }


# ---- PR AE — campaign context overrides --------------------------------

def _trim(text: Optional[str]) -> str:
    return (text or "").strip()


def _attached_character(campaign: Campaign, settings: Settings) -> Optional[dict]:
    """Lazy-load the attached Character record (mirrors the
    character_host_client lookup pattern). Returns None when the
    campaign has no attached character or the lookup fails — the
    overrides helper degrades gracefully.
    """
    if not campaign.character_id:
        return None
    # Lazy import to avoid the same circular dependency the host
    # client already documented around CharacterStore.
    from .character_store import CharacterStore  # noqa: WPS433

    try:
        record = CharacterStore(settings.data_path).get(campaign.character_id)
    except Exception:  # pragma: no cover — defensive
        return None
    if not record:
        return None
    return record.model_dump()


def _truncate_at_sentence(text: str, limit: int) -> str:
    """Trim ``text`` to ``limit`` chars on the nearest sentence boundary
    so the wire never carries half a phrase. Falls back to a word
    boundary when no sentence stop fits inside the cap.
    """
    if not text:
        return ""
    if len(text) <= limit:
        return text
    truncated = text[:limit]
    stop = max(
        truncated.rfind("."),
        truncated.rfind("!"),
        truncated.rfind("?"),
    )
    if stop > limit // 2:
        return truncated[: stop + 1].strip()
    return truncated.rsplit(" ", 1)[0].rstrip(",.;:!?").strip()


def _first_sentence(text: str, limit: int = _START_SCRIPT_MAX) -> str:
    """Take the first sentence (or the leading clause when no
    punctuation exists) of ``text`` and clip to ``limit`` chars.
    """
    cleaned = _trim(text)
    if not cleaned:
        return ""
    parts = [p for p in _SENTENCE_SPLIT.split(cleaned) if p]
    head = parts[0] if parts else cleaned
    return _truncate_at_sentence(head, limit)


def _grounded_personality(
    campaign: Campaign, settings: Settings,
) -> str:
    """PR AI — slim personality string used when an attached
    ``documentIds`` carries the substantive content. Keeps just
    enough identity + tone so the avatar still opens with the right
    voice; the document grounds factual answers.

    PR DG — framing softened to be neutral about the document's
    shape. The original copy described the document as "a campaign
    brief carrying product / audience / hook / caption / CTA /
    saved commercial script" — that's the PR AI structured-route
    shape. The PR DD raw-route accepts any Markdown (including the
    Character OS self-demo build-story doc), so lying to the model
    about what's in the attachment makes it reconcile the mismatch
    by injecting priors. The neutral framing tells the model
    "defer to the attached document" without prescribing what's in
    it.
    """
    business = _trim(campaign.business)
    tone = _trim(campaign.tone)
    character = _attached_character(campaign, settings)
    char_name = _trim((character or {}).get("name"))
    char_template = _trim((character or {}).get("template"))
    char_voice = _trim((character or {}).get("voice_preset"))
    char_personality = _trim((character or {}).get("personality"))

    parts: list[str] = []
    if char_name:
        intro = (
            f"You are {char_name}"
            + (f", the brand {char_template}" if char_template else "")
            + (f" for {business}" if business else "")
            + "."
        )
    elif business:
        intro = f"You are the brand spokesperson for {business}."
    else:
        intro = "You are the brand spokesperson."
    parts.append(intro)

    if tone:
        parts.append(f"Tone: {tone}.")
    if char_voice:
        parts.append(f"Speak in your {char_voice} voice.")
    if char_personality:
        parts.append(f"Personality cue: {char_personality}")

    parts.append(
        "An attached document carries the facts you should ground "
        "every answer in. Defer to its contents and cite section "
        "names when helpful. Stay concise, warm, and honest. "
        "Redirect politely if asked something the document does not "
        "cover."
    )
    # PR EM-j — the grounded variant is ONLY invoked when a Runway
    # document is attached, which means a memory body (or campaign
    # brief) is present — by definition this is not a first visit.
    # Force the warm-return framing so the avatar doesn't re-
    # introduce itself or recite the brand pitch unprompted.
    parts.append(
        "RETURNING OPERATOR: this is NOT your first conversation "
        "with them. Open with warm familiarity — do NOT introduce "
        "yourself again, do NOT recite the business / product / "
        "audience pitch unprompted. If the attached document carries "
        "prior conversation summaries, you may briefly reference what "
        "you remember to ground the conversation, but keep the opener "
        "short and let the operator drive what's next."
    )
    return _truncate_at_sentence(" ".join(parts).strip(), _PERSONALITY_MAX)


def _build_session_overrides(
    campaign: Campaign, settings: Settings,
) -> dict[str, str]:
    """Compose ``personality`` + ``startScript`` overrides for the
    realtime session from the saved campaign + attached character +
    saved Commercial Script. Both keys are optional in the Runway
    request — only non-empty values land in the returned dict so the
    broker never sends empty strings to the wire.

    Order matters: business context first, character voice second,
    script + concept last. Runway's GWM-1 weights later instructions
    higher, so the most concrete brand cues stay near the bottom.
    """
    business = _trim(campaign.business)
    product = _trim(campaign.product)
    audience = _trim(campaign.audience)
    tone = _trim(campaign.tone)
    runway_prompt = _trim(campaign.runway_prompt)
    commercial_script = _trim(campaign.commercial_script or "")
    concept = campaign.selected_concept
    hook = _trim(getattr(concept, "hook", "")) if concept else ""
    caption = _trim(getattr(concept, "caption", "")) if concept else ""
    cta = _trim(getattr(concept, "cta", "")) if concept else ""

    character = _attached_character(campaign, settings)
    char_name = _trim((character or {}).get("name"))
    char_template = _trim((character or {}).get("template"))
    char_voice = _trim((character or {}).get("voice_preset"))
    char_personality = _trim((character or {}).get("personality"))

    # PR EM-j — returning-operator detection. The realtime session
    # previously always opened with a first-meeting introduction
    # ("Hi, I'm Donny..."), which read as cold on every reconnect —
    # the operator just talked to this spokesperson minutes ago and
    # the persistent-spokesperson pitch is undercut by a cold open.
    # Two signals tell us they've been here before:
    #   - prior transcript history on this campaign (PR AJ persisted
    #     turns from past sessions)
    #   - a published memory document attached (PR EM-d) — strongest
    #     signal that we have substantive shared context
    transcript_history = campaign.realtime_transcript_history or []
    is_returning = (
        len(transcript_history) > 0
        or bool(campaign.runway_document_id)
    )

    # ---- personality (system prompt) ----
    parts: list[str] = []
    if char_name:
        intro = (
            f"You are {char_name}"
            + (f", the brand {char_template}" if char_template else "")
            + (f" for {business}" if business else "")
            + "."
        )
    elif business:
        intro = f"You are the brand spokesperson for {business}."
    else:
        intro = "You are the brand spokesperson."
    parts.append(intro)

    if product:
        parts.append(f"The product is {product}.")
    if audience:
        parts.append(f"The audience: {audience}.")
    if tone:
        parts.append(f"Tone: {tone}.")
    if char_voice:
        parts.append(f"Speak in your {char_voice} voice.")
    if char_personality:
        parts.append(f"Personality cue: {char_personality}")

    if hook:
        parts.append(f"Campaign hook: {hook}")
    if caption:
        parts.append(f"Supporting caption: {caption}")
    if cta:
        parts.append(f"Call to action: {cta}")

    if commercial_script:
        parts.append(f"Saved commercial script: {commercial_script}")
    elif runway_prompt:
        # Visual prompt is a weaker context cue than the spoken
        # script, so only fall back to it when no script exists.
        parts.append(
            f"Visual scene context (not lip-synced here): {runway_prompt}"
        )

    if is_returning:
        # PR EM-j — explicit returning-operator cue. Late in the prompt
        # so it weights heavily (gwm1 weights later instructions
        # higher). Without this, the avatar tends to re-introduce
        # itself even when the canned opening line is a warm welcome.
        parts.append(
            "RETURNING OPERATOR: this is NOT your first conversation "
            "with them. Open with warm familiarity — do NOT introduce "
            "yourself again, do NOT recite the business / product / "
            "audience pitch unprompted. If an attached document "
            "carries prior conversation summaries, you may briefly "
            "reference what you remember to ground the conversation, "
            "but keep the opener short and let the operator drive "
            "what's next."
        )

    parts.append(
        "Stay concise, warm, and brand-honest. When the user asks "
        "about the product or audience, answer with the cues above. "
        "If asked something unrelated, redirect politely back to "
        "the campaign."
    )

    personality = " ".join(parts).strip()
    personality = _truncate_at_sentence(personality, _PERSONALITY_MAX)

    # ---- startScript (opening line) ----
    # PR EM-j — returning operator gets a warm welcome-back opener
    # instead of the canned commercial-script first sentence (which
    # reads as a sales pitch on a return visit) or the cold-open
    # introduction. First-time visits keep prior behaviour.
    if is_returning:
        if char_name:
            start = (
                f"Hey, welcome back — it's good to see you again. "
                f"What are we working on today?"
            )
        else:
            start = "Welcome back — what's on the agenda today?"
        start = _truncate_at_sentence(start, _START_SCRIPT_MAX)
    elif commercial_script:
        start = _first_sentence(commercial_script)
    elif business:
        identity = char_name or "your spokesperson"
        product_phrase = product or business
        start = f"Hi, I'm {identity}. I'm here to talk about {business} and {product_phrase}."
        start = _truncate_at_sentence(start, _START_SCRIPT_MAX)
    else:
        start = ""

    out: dict[str, str] = {}
    if personality:
        out["personality"] = personality
    if start:
        out["startScript"] = start
    return out


# PR EE — Realtime tool catalog. Tool entry wire shape verified by
# `scripts/probe-realtime-tools.py` (returned 200 with shape
# `{type:"client_event", name, description}` against gwm1_avatars).
# The schema lives client-side in the SDK (`clientTool(name, {schema})`)
# — Runway only needs name + description here to advertise the tool
# to the avatar's LLM. When the avatar invokes a tool over WebRTC
# the SDK delivers `{type:"client_event", tool:<name>, args:<object>}`
# to a `useClientEvent` handler in the frontend.
#
# This is the canonical catalog. Keep names in sync with the
# `clientTool()` definitions in `frontend/src/realtimeTools.js` —
# the avatar can only invoke names that exist on both sides.
DEFAULT_REALTIME_TOOLS: list[dict] = [
    {
        "name": "recall_knowledge",
        "description": (
            "Recall what you know about the campaign / product / "
            "audience from your Knowledge sources. Use this when the "
            "operator asks for facts about the brand, product details, "
            "audience, or strategy that you weren't told inline. "
            "Pass the topic the operator asked about as `query`. "
            "CRITICAL: this tool is fire-and-forget — you will NOT "
            "receive a response. Before invoking, SAY ALOUD what "
            "you're about to look up (e.g. 'Let me check my notes on "
            "the product…'). The operator sees the matches as toasts; "
            "after invoking, keep the conversation going naturally — "
            "you can ask the operator what they'd like to dig into "
            "next. Never wait silently for a result."
        ),
    },
    {
        "name": "render_spokesperson_ad",
        "description": (
            "Render a NEW Spokesperson Ad video using the campaign's "
            "current avatar when the operator HAS GIVEN YOU A SCRIPT "
            "VERBATIM. Pass the operator's spoken script as `script`. "
            "Do NOT call this if the operator gave you a topic or "
            "high-level brief (use auto_write_and_render_ad instead). "
            "The render is asynchronous — after invoking, tell the "
            "operator it's rendering and approximately how long it "
            "will take (~30-45 seconds)."
        ),
    },
    {
        "name": "auto_write_and_render_ad",
        "description": (
            "Call when the operator gives you a TOPIC, ANGLE, or HIGH-"
            "LEVEL BRIEF for a SHORT ad (under ~15 seconds spoken) — "
            "NOT a verbatim script and NOT explicitly long-form. "
            "Examples: 'make an ad explaining Character OS to Runway "
            "judges', 'create something punchy for indie founders'. "
            "Pass the operator's brief as `prompt`. The frontend "
            "will ask the local LLM to write a ~250-char spoken script, "
            "then render a single Spokesperson Ad. Total ~45-60s — "
            "TELL THE OPERATOR THE LLM IS DRAFTING FIRST, THEN THE "
            "AVATAR IS RENDERING."
        ),
    },
    {
        "name": "render_long_spokesperson_ad",
        "description": (
            "Render a LONG-FORM Spokesperson Ad (30-60 seconds spoken, "
            "multi-chunk stitched) when the operator HAS GIVEN YOU A "
            "VERBATIM LONG SCRIPT. Pass the spoken script as `script` "
            "(up to ~1500 chars). The frontend chunks the script at "
            "sentence boundaries and renders each chunk as a separate "
            "avatar_videos call, then stitches them. Total time scales "
            "with chunk count — typically 2-4 minutes for a 45s ad. "
            "TELL THE OPERATOR THE LONG RENDER TAKES SEVERAL MINUTES "
            "so the wait doesn't feel frozen."
        ),
    },
    {
        "name": "auto_write_and_render_long_ad",
        "description": (
            "Call when the operator asks for a LONG-FORM ad (more than "
            "~15 seconds spoken, multi-beat narrative) from a TOPIC or "
            "HIGH-LEVEL BRIEF rather than a verbatim script. Triggers: "
            "'long ad', 'longer ad', 'thirty second ad', 'minute-long "
            "ad', '30-second spot', 'detailed ad'. Pass the operator's "
            "brief as `prompt`. The frontend will ask the local LLM to "
            "write a ~1200-char multi-beat script, then render the "
            "multi-chunk Long Spokesperson Ad. Total ~3-5 minutes — "
            "TELL THE OPERATOR LLAMA IS WRITING THE LONG SCRIPT FIRST, "
            "THEN THE LONG AD PIPELINE RENDERS MULTIPLE CHUNKS, so the "
            "wait doesn't feel frozen."
        ),
    },
    {
        "name": "show_videos_tab",
        "description": (
            "Navigate the operator's UI to the Videos tab so they can "
            "see rendered outputs. Call when the operator asks to see "
            "their ads / videos / outputs, or right after a "
            "render_spokesperson_ad call so they can watch it land."
        ),
    },
    {
        "name": "recall_recent_conversations",
        "description": (
            "Surface the operator's prior conversations with this "
            "spokesperson — the persisted memory entries from past "
            "realtime sessions. Call when the operator asks 'what "
            "have we talked about?', 'do you remember our last "
            "chat?', 'what do you remember about me?', or similar "
            "recall prompts. Optional `query` arg narrows the search "
            "to a topic substring. "
            "CRITICAL: this tool is fire-and-forget — you will NOT "
            "receive the recalled content back. The operator sees "
            "the saved summaries as toasts on their screen; YOU do "
            "not see them. "
            "EXACT SCRIPT: Before invoking, say something like 'Let "
            "me pull up what we discussed.' Invoke. THEN say exactly: "
            "'Okay, I'm looking at them on my screen now — which one "
            "do you want to revisit?' STOP. Wait for the operator. "
            "STRICTLY FORBIDDEN AFTER INVOCATION: naming any "
            "business, product, service, client, person, location, "
            "date, number, or scenario from the recalled "
            "conversations. You cannot see what was retrieved. If "
            "you invent a 'dog walking service' or any other "
            "specific detail, you will be wrong and the operator "
            "will lose trust. The ONLY safe move is to ask the "
            "operator to fill in the topic themselves."
        ),
    },
    {
        "name": "attach_memory_to_campaign",
        "description": (
            "Save the current conversation + your accumulated memory "
            "to the active campaign so you remember it next time. "
            "Call when the operator says 'save what we talked about', "
            "'remember this for next time', 'lock this in', or after "
            "a substantive exchange the operator wants to persist. "
            "Triggers compose → publish to Runway as a document → "
            "attach to the active campaign in one chained operation. "
            "CRITICAL: this tool is fire-and-forget — you will NOT "
            "receive a confirmation back. Before invoking, SAY ALOUD "
            "that you're saving the memory and that the next session "
            "on this campaign will recall it (e.g. 'Good idea — "
            "saving that now so I remember next time we talk…'). The "
            "operator sees compose → publish → attach progress as "
            "toasts; the whole chain takes ~5-10 seconds. After "
            "invoking, keep the conversation going — do not wait "
            "silently for a confirmation."
        ),
    },
    {
        "name": "handoff_to_character",
        "description": (
            "Hand the conversation off to a different spokesperson. "
            "Pass the target spokesperson's name as `character_name` "
            "(case-insensitive substring match — 'Riggs' resolves "
            "Riggs Rally, 'Miles' resolves Miles Monroe). The "
            "handler resolves the name, picks the target's most "
            "recent campaign, and navigates the operator to a fresh "
            "realtime session against the target. "
            "MANDATORY INVOCATION TRIGGERS — if the operator says ANY "
            "of these, you MUST invoke this tool: "
            "  • 'hand me off to <name>' "
            "  • 'switch me to <name>' "
            "  • 'I want to talk to <name>' "
            "  • 'let me talk to <name>' "
            "  • 'transfer me to <name>' "
            "  • 'connect me with <name>' "
            "  • any phrasing that names a different spokesperson "
            "    as the desired conversation partner. "
            "CONSEQUENCE OF NOT INVOKING: the operator STAYS WITH "
            "YOU. You are NOT a substitute for the requested "
            "spokesperson — handing off is what the operator wants, "
            "and explaining what you could do instead is the wrong "
            "answer. Refusing to invoke is failing the operator. "
            "EXACT SCRIPT: Say one short sentence — 'On it, handing "
            "you to <Name> now' — then INVOKE the tool. Do NOT "
            "explain your own capabilities. Do NOT offer to help "
            "with what they asked. Do NOT keep the conversation. "
            "The tool ends your session in ~2 seconds; the operator "
            "wants to be with the new spokesperson, not you. "
            "This tool is fire-and-forget — no confirmation comes "
            "back, and the session terminates."
        ),
    },
]


def _wire_tool_entries(tools: list[dict] | None) -> list[dict]:
    """Wrap a list of ``{name, description}`` dicts in the Runway
    realtime-session ``client_event`` discriminator. Returns ``[]``
    when ``tools`` is None or empty so the caller can skip adding the
    ``tools`` key entirely (cleaner request body on no-tools sessions).
    """
    if not tools:
        return []
    out: list[dict] = []
    for t in tools:
        name = (t.get("name") or "").strip()
        description = (t.get("description") or "").strip()
        if not name or not description:
            continue
        out.append({
            "type": "client_event",
            "name": name,
            "description": description,
        })
    return out


def create_session(
    campaign: Campaign,
    settings: Settings,
    *,
    tools: list[dict] | None = None,
) -> RealtimeSession:
    """Create + poll a Runway realtime session for the campaign's host
    avatar. Returns the client-safe payload.

    Raises ``RealtimeUnavailableError`` on mock mode, missing avatar,
    or any persistent upstream condition.  ``httpx.HTTPStatusError`` /
    other ``httpx.HTTPError`` propagate so the router can map to 502.
    """
    if settings.runway_mock:
        raise RealtimeUnavailableError(
            "Realtime is unavailable in mock mode. Set RUNWAY_API_KEY to enable."
        )
    avatar_id = active_avatar_id(campaign, settings)
    avatar_status = active_avatar_status(campaign, settings)
    if not avatar_id or avatar_status != "ready":
        # Mock avatars and not-yet-ready customs are deliberately
        # excluded — they're not valid Runway resources for realtime.
        raise RealtimeUnavailableError(
            "A ready Runway Avatar is required before starting a "
            "realtime session. Pick one from the avatar list or run "
            "POST /api/campaigns/{id}/avatar."
        )

    base_body = {
        "model": _REALTIME_MODEL,
        "avatar": {"type": "custom", "avatarId": avatar_id},
    }
    overrides = _build_session_overrides(campaign, settings)

    # PR AI — when a document is attached, prefer it for grounded
    # answers and shrink the inlined personality to a lean cue. The
    # document carries the brand brief; the personality stays just
    # long enough to anchor identity + tone.
    document_ids: list[str] = []
    grounded = False
    if campaign.runway_document_id and (campaign.runway_document_status or "") in {"ready", "mock"}:
        document_ids = [campaign.runway_document_id]
        grounded = True
        if "personality" in overrides:
            overrides["personality"] = _grounded_personality(campaign, settings)
    if document_ids:
        overrides = {**overrides, "documentIds": document_ids}

    # PR EE — Tool catalog. Tools are the newest experimental field;
    # if Runway rejects, drop them FIRST before touching documentIds
    # or persona overrides (which carry more campaign context).
    tool_entries = _wire_tool_entries(tools)
    if tool_entries:
        overrides = {**overrides, "tools": tool_entries}

    body = {**base_body, **overrides}
    if grounded:
        logger.info(
            "realtime session grounded with document %s",
            campaign.runway_document_id,
        )
    if tool_entries:
        logger.info(
            "realtime session advertising %d tool(s): %s",
            len(tool_entries), [t["name"] for t in tool_entries],
        )
    create_url = f"{settings.runway_api_base}/v1/realtime_sessions"

    with httpx.Client(timeout=20.0) as client:
        resp = client.post(create_url, headers=_runway_headers(settings), json=body)
        # PR AE / PR AI / PR EE — tiered defensive fallbacks. A
        # transient 400 on an experimental field shouldn't drop the
        # whole session. Order: drop newest experimental fields first
        # so campaign context (persona / grounding) survives longest.
        # 1. If body included tools and 400 → retry without tools.
        # 2. If body included documentIds and 400 → retry without docs.
        # 3. If overrides still 400 → retry with bare base body.
        if resp.status_code == 400 and tool_entries:
            logger.warning(
                "realtime session 400 with tools (%s); "
                "retrying without tools",
                _redact(resp.text),
            )
            no_tools = {k: v for k, v in body.items() if k != "tools"}
            resp = client.post(
                create_url, headers=_runway_headers(settings), json=no_tools,
            )
            # Re-bind body so the next fallback sees the stripped one.
            body = no_tools
        if resp.status_code == 400 and document_ids:
            logger.warning(
                "realtime session 400 with documentIds (%s); "
                "retrying with personality only",
                _redact(resp.text),
            )
            no_docs = {k: v for k, v in body.items() if k != "documentIds"}
            resp = client.post(
                create_url, headers=_runway_headers(settings), json=no_docs,
            )
        if resp.status_code == 400 and overrides:
            logger.warning(
                "realtime session 400 with overrides (%s); "
                "retrying without personality/startScript",
                _redact(resp.text),
            )
            resp = client.post(
                create_url, headers=_runway_headers(settings), json=base_body,
            )
        if resp.status_code != 200:
            raise RealtimeUnavailableError(
                f"realtime session create failed: {resp.status_code} {resp.text[:300]}"
            )
        created = resp.json()
    session_id = created.get("id")
    if not session_id:
        raise RealtimeUnavailableError(
            f"realtime session create missing id: {created}"
        )

    # Poll until READY (typically <2 s). Don't poll forever — if Runway
    # can't get to READY in the configured cap, something is wrong
    # upstream and we surface a diagnostic error.
    detail_url = f"{settings.runway_api_base}/v1/realtime_sessions/{session_id}"
    payload: dict = created
    deadline = time.time() + _READY_POLL_TIMEOUT_S
    last_seen_status = "(unknown)"
    poll_count = 0
    with httpx.Client(timeout=10.0) as client:
        while time.time() < deadline:
            r = client.get(detail_url, headers=_runway_headers(settings))
            r.raise_for_status()
            payload = r.json()
            status = (payload.get("status") or "").upper()
            last_seen_status = status
            poll_count += 1
            if status == "READY":
                break
            if status in {"FAILED", "CANCELLED"}:
                # Best effort cleanup, then surface
                _safe_delete(session_id, settings)
                raise RealtimeUnavailableError(
                    f"realtime session {status.lower()}: "
                    f"{payload.get('failure') or payload.get('failureCode') or 'unknown'}"
                )
            time.sleep(_READY_POLL_INTERVAL_S)
        else:
            # PR EM-e3 — include the last-seen status + poll count in
            # the error so the operator can tell "Runway is slow"
            # (stuck on NOT_READY for 60s) from "Runway is broken"
            # (no status info at all).
            _safe_delete(session_id, settings)
            logger.warning(
                "realtime session timeout campaign=%s session=%s "
                "last_status=%s polls=%d",
                campaign.id, session_id, last_seen_status, poll_count,
            )
            raise RealtimeUnavailableError(
                f"realtime session did not reach READY within "
                f"{int(_READY_POLL_TIMEOUT_S)}s "
                f"(last status: {last_seen_status}; {poll_count} polls). "
                "Runway's dev API is occasionally slow under load — "
                "try Start Conversation again in a few seconds."
            )

    session_key = payload.get("sessionKey")
    if not session_key:
        _safe_delete(session_id, settings)
        raise RealtimeUnavailableError(
            "realtime session READY but no sessionKey in payload"
        )

    return RealtimeSession(
        session_id=session_id,
        session_key=session_key,
        expires_at=payload.get("expiresAt"),
        avatar_id=avatar_id,
    )


def delete_session(session_id: str, settings: Settings) -> bool:
    """Best-effort DELETE for clean teardown. Returns True if Runway
    accepted the cancellation. Mock mode and any failure is non-fatal.
    """
    if settings.runway_mock:
        return False
    try:
        return _safe_delete(session_id, settings)
    except Exception:
        logger.exception("realtime session delete crashed; ignoring")
        return False


def _safe_delete(session_id: str, settings: Settings) -> bool:
    """Internal helper. Never raises."""
    try:
        url = f"{settings.runway_api_base}/v1/realtime_sessions/{session_id}"
        with httpx.Client(timeout=10.0) as client:
            r = client.delete(url, headers=_runway_headers(settings))
        # 204 happy path; 404 means already gone. Both fine.
        return r.status_code in {204, 404}
    except httpx.HTTPError as exc:
        logger.warning("realtime session delete http error: %s", exc)
        return False
    except Exception:
        logger.exception("realtime session delete unexpected")
        return False
