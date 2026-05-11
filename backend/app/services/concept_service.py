import json
import logging
from typing import Optional

from ..config import Settings
from ..models import AdConcept, ConceptRequest, ConceptResponse

logger = logging.getLogger(__name__)


SYSTEM_PROMPT = (
    "You are a senior creative director generating short cinematic ad concepts. "
    "Return strictly valid JSON matching the requested schema. No prose."
)


def _user_prompt(req: ConceptRequest) -> str:
    return (
        "Generate 3 distinct cinematic short-ad concepts for the following.\n"
        f"Business: {req.business}\n"
        f"Product/service: {req.product or 'n/a'}\n"
        f"Tone: {req.tone or 'cinematic'}\n"
        f"Audience: {req.audience or 'general'}\n\n"
        "Return JSON with this exact schema:\n"
        "{\n"
        '  "concepts": [\n'
        '    {"title": str, "hook": str, "visual": str, "caption": str, "cta": str}\n'
        "  ],  // exactly 3 items\n"
        '  "recommended_index": int (0-2),\n'
        '  "runway_prompt": str  // single cinematic video prompt for the recommended concept,\n'
        "                        // 1-2 sentences, vivid camera + lighting + subject + motion\n"
        "}\n"
    )


def _mock_concepts(req: ConceptRequest) -> ConceptResponse:
    biz = req.business.strip() or "the brand"
    product = req.product.strip() or "the product"
    tone = req.tone.strip() or "cinematic"
    audience = req.audience.strip() or "modern customers"

    concepts = [
        AdConcept(
            title=f"Origin Spark — {biz}",
            hook=f"Where {product} began.",
            visual=(
                f"Slow push-in on a single craftsman's hands shaping {product}, "
                f"warm tungsten light, dust motes drifting; cuts to a finished hero shot."
            ),
            caption=f"Built for {audience}. Made to last.",
            cta="Discover the story →",
        ),
        AdConcept(
            title=f"Daily Ritual — {biz}",
            hook=f"Your day, upgraded by {product}.",
            visual=(
                f"Fast-cut montage of {audience} weaving {product} into morning, work, "
                f"and night routines, neon-and-glass color palette, kinetic camera."
            ),
            caption=f"From sunrise to skyline — {biz} keeps up.",
            cta="Try it today →",
        ),
        AdConcept(
            title=f"Frontier — {biz}",
            hook=f"What {product} unlocks next.",
            visual=(
                f"Wide aerial of a vast landscape at golden hour, lone figure activating "
                f"{product}, light blooms outward, score swells; ends on logo."
            ),
            caption=f"For {audience} ready to move first.",
            cta="Step forward →",
        ),
    ]
    runway_prompt = (
        f"Cinematic {tone} ad for {biz}: slow dolly-in on hero {product}, "
        f"golden-hour rim light, shallow depth of field, subtle particle haze, "
        f"smooth handheld motion, final beat reveals brand mark."
    )
    return ConceptResponse(
        concepts=concepts,
        recommended_index=1,
        runway_prompt=runway_prompt,
        mock_mode=True,
    )


def _coerce_response(payload: dict, fallback: ConceptResponse) -> ConceptResponse:
    raw = payload.get("concepts") or []
    concepts: list[AdConcept] = []
    for item in raw[:3]:
        try:
            concepts.append(AdConcept(**item))
        except Exception:
            continue
    if len(concepts) != 3:
        return fallback
    idx = payload.get("recommended_index", 0)
    if not isinstance(idx, int) or not 0 <= idx <= 2:
        idx = 0
    runway_prompt = payload.get("runway_prompt") or fallback.runway_prompt
    return ConceptResponse(
        concepts=concepts,
        recommended_index=idx,
        runway_prompt=runway_prompt,
        mock_mode=False,
    )


# ---- PR EJ — short spoken-ad script generation --------------------
#
# Different prompt shape from `generate_concepts`: produces ONE
# natural-spoken script (the kind the avatar will read aloud) sized
# to fit Runway's 300-char `speech.text` cap. The concept endpoint
# returns hook/visual/caption metadata — useful for thinking about
# the ad but not directly speakable. This produces a script the
# operator can paste straight into Step 2's variant.

SCRIPT_SYSTEM_PROMPT_SHORT = (
    "You write punchy spoken ad scripts for an AI brand spokesperson. "
    "The script will be read aloud by an avatar on camera, so write "
    "in natural spoken English. No stage directions. No parenthetical "
    "asides. No quotation marks around the whole script. No 'voiceover' "
    "labels. Just the words the avatar will say. "
    "Target length: 200-260 characters (the avatar API caps the line "
    "at 300 chars total). Open with a hook in the first 10 words. "
    "Deliver value in the middle. End with one clear, specific "
    "call-to-action."
)


SCRIPT_SYSTEM_PROMPT_LONG = (
    "You write longer-form spoken ad scripts for an AI brand "
    "spokesperson. The script will be read aloud by an avatar on "
    "camera AND chunked at sentence boundaries for rendering — so "
    "use SHORT, SELF-CONTAINED SENTENCES. Each sentence should "
    "stand on its own. Avoid run-ons or sentences that depend on "
    "the previous one. No stage directions. No parenthetical "
    "asides. No quotation marks around the script. No 'voiceover' "
    "labels. Just the spoken words. "
    "Target length: 1000-1400 characters total (roughly 35-50 "
    "seconds when read aloud). Structure: open with a 1-2 sentence "
    "hook, three or four micro-beats of substance / proof in the "
    "middle, close with one clear call-to-action. Treat each "
    "sentence as a distinct beat — the renderer cuts on sentence "
    "boundaries."
)


def _script_user_prompt(
    business: str,
    product: str,
    audience: str,
    tone: str,
    *,
    mode: str = "short",
    spin: Optional[str] = None,
) -> str:
    extra = f"\nAngle hint: {spin}" if spin and spin.strip() else ""
    target = (
        "1000-1400 chars (35-50 seconds spoken)"
        if mode == "long"
        else "200-260 chars (one Runway avatar_videos line)"
    )
    return (
        f"Write ONE spoken ad script, target length {target}:\n"
        f"Business: {business or '(unspecified)'}\n"
        f"Product / service: {product or '(unspecified)'}\n"
        f"Audience: {audience or 'general'}\n"
        f"Tone: {tone or 'punchy'}{extra}\n\n"
        "Return ONLY the spoken script as plain text. No JSON, no "
        "markdown, no labels, no surrounding quotation marks. "
        "Just the words to be spoken."
    )


def _clean_script_output(raw: str) -> str:
    """Strip the most common LLM ornamentation: wrapping quotes,
    stray 'Script:' labels, leading dashes, surrounding code fences."""
    if not raw:
        return ""
    text = raw.strip()
    # Strip code fences
    for fence in ("```", "~~~"):
        if text.startswith(fence):
            text = text.lstrip("`~ \n")
        if text.endswith(fence):
            text = text.rstrip("`~ \n")
    # Strip leading "Here is the script:" / "Here's the ad:" / etc.
    # ornaments that smaller open models add despite instructions.
    for prefix in (
        "Here is the script:",
        "Here's the script:",
        "Here is the ad:",
        "Here's the ad:",
        "Here is the spoken script:",
        "Here's the spoken script:",
        "Script:",
        "Ad:",
        "Script -",
        "Ad -",
    ):
        if text.lower().startswith(prefix.lower()):
            text = text[len(prefix):].lstrip()
    # Strip wrapping quotes
    if len(text) >= 2 and text[0] in {'"', "'", "“", "‘"} and text[-1] in {'"', "'", "”", "’"}:
        text = text[1:-1].strip()
    return text


def generate_ad_script(
    business: str,
    product: str,
    audience: str,
    tone: str,
    settings: Settings,
    *,
    mode: str = "short",
    spin: Optional[str] = None,
) -> dict:
    """Generate one spoken ad script for the supplied brief.

    ``mode``:
      - ``"short"`` (default) — 200-260 chars, fits one
        `avatar_videos` call (Runway's 300-char cap).
      - ``"long"``  — 1000-1400 chars, ~35-50s of speech, fed into
        the long_ad_service's chunk-and-stitch pipeline.

    Returns a dict with ``script`` (the cleaned text), ``provider``
    (which LLM produced it), ``model``, ``mode``, and ``mock_mode``
    (True when no real LLM was reachable and we returned a
    templated fallback).

    Never raises. Falls back to a templated script when the LLM is
    unreachable, returns malformed output, or the openai_mock gate
    fires for the cloud provider.
    """
    provider = (settings.llm_provider or "openai").strip().lower()
    mode_norm = (mode or "short").strip().lower()
    if mode_norm not in {"short", "long"}:
        mode_norm = "short"

    def _mock_script() -> dict:
        biz = (business or "").strip() or "our brand"
        prod = (product or "").strip() or "this product"
        aud = (audience or "").strip() or "you"
        if mode_norm == "long":
            # Multi-beat fallback ~1200 chars. Short sentences so the
            # long-ad chunker has clean cut points.
            sentences = [
                f"Hey {aud}. I want to tell you about {biz}.",
                f"We built {prod} because we got tired of the old way.",
                "The old way is slow. The old way is generic. The old way wastes your time.",
                f"With {biz}, you stop fighting tools and start shipping work.",
                "It learns your context, your voice, and your brand.",
                "Every output stays consistent. Every campaign feels yours.",
                f"You skip the busywork, and {prod} handles the rest.",
                "Founders use it to move faster. Teams use it to stay aligned.",
                f"Try {biz} today. See the difference in one afternoon.",
                "Visit our site, watch a real demo, and see for yourself.",
            ]
            script = " ".join(sentences)
        else:
            script = (
                f"Hey {aud} — meet {biz}. {prod} done right, no fluff. "
                f"Built to ship, designed to last. See it for yourself today."
            )
            if len(script) > 260:
                script = script[:257].rstrip() + "..."
        return {
            "script": script,
            "provider": provider,
            "model": "(template fallback)",
            "mode": mode_norm,
            "mock_mode": True,
        }

    if provider == "openai" and settings.openai_mock:
        return _mock_script()

    try:
        from openai import OpenAI
    except ImportError:
        logger.warning("openai package not installed; returning mock script")
        return _mock_script()

    if provider == "ollama":
        client = OpenAI(
            api_key="ollama",
            base_url=settings.ollama_base_url,
        )
        model = settings.ollama_model
    else:
        client = OpenAI(api_key=settings.openai_api_key)
        model = settings.openai_model

    system_prompt = (
        SCRIPT_SYSTEM_PROMPT_LONG if mode_norm == "long" else SCRIPT_SYSTEM_PROMPT_SHORT
    )

    try:
        logger.info(
            "ad script generation via %s model=%s mode=%s",
            provider, model, mode_norm,
        )
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": system_prompt},
                {
                    "role": "user",
                    "content": _script_user_prompt(
                        business, product, audience, tone,
                        mode=mode_norm, spin=spin,
                    ),
                },
            ],
            # Higher temperature → more variation across re-rolls.
            temperature=0.95,
        )
        raw: Optional[str] = completion.choices[0].message.content
        cleaned = _clean_script_output(raw or "")
        if not cleaned:
            logger.warning("ad script generation returned empty content")
            return _mock_script()
        # Soft length guard — different ceilings per mode. Short
        # mode is hard-bounded by Runway's avatar_videos 300-char
        # cap; long mode is bounded by the AdVariant.long_script
        # 1500-char cap.
        ceiling = 1500 if mode_norm == "long" else 280
        if len(cleaned) > ceiling:
            cut = cleaned[:ceiling]
            for sep in (". ", "! ", "? "):
                idx = cut.rfind(sep)
                if idx > 100:
                    cleaned = cut[: idx + 1].rstrip()
                    break
            else:
                cleaned = cut.rstrip() + "..."
        return {
            "script": cleaned,
            "provider": provider,
            "model": model,
            "mode": mode_norm,
            "mock_mode": False,
        }
    except Exception as exc:
        logger.exception(
            "ad script generation failed (provider=%s model=%s mode=%s): %s",
            provider, model, mode_norm, exc,
        )
        return _mock_script()


def generate_concepts(req: ConceptRequest, settings: Settings) -> ConceptResponse:
    """PR EH — provider-aware concept generation. Branches on
    `settings.llm_provider`:

      - `openai` (default) — chat.completions against the OpenAI
        cloud API. Requires OPENAI_API_KEY; falls back to mock when
        the key is empty (`settings.openai_mock=True`).
      - `ollama` — chat.completions against a local Ollama server
        via its OpenAI-compatible endpoint (default
        http://localhost:11434/v1). No API key needed. Falls back to
        mock when Ollama is unreachable or the model returns junk.

    Both paths use the same OpenAI Python client — Ollama implements
    the chat.completions API surface byte-for-byte. The only change
    is the base_url + model name.
    """
    fallback = _mock_concepts(req)
    provider = (settings.llm_provider or "openai").strip().lower()

    # OpenAI cloud path stays gated on the API key (existing
    # behaviour). Mock returns immediately when no key is set.
    if provider == "openai" and settings.openai_mock:
        return fallback

    try:
        from openai import OpenAI  # lazy import — same client for both providers
    except ImportError:
        logger.warning("openai package not installed; returning mock concepts")
        return fallback

    # Provider-specific client construction. The body shape below is
    # identical for both providers — Ollama implements
    # chat.completions byte-for-byte including `response_format`.
    if provider == "ollama":
        client = OpenAI(
            api_key="ollama",  # any non-empty string; ignored by Ollama
            base_url=settings.ollama_base_url,
        )
        model = settings.ollama_model
        logger.info(
            "concept generation via ollama model=%s base=%s",
            model, settings.ollama_base_url,
        )
    else:
        client = OpenAI(api_key=settings.openai_api_key)
        model = settings.openai_model

    try:
        completion = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _user_prompt(req)},
            ],
            response_format={"type": "json_object"},
            temperature=0.8,
        )
        content: Optional[str] = completion.choices[0].message.content
        if not content:
            logger.warning("concept generation returned empty content (provider=%s)", provider)
            return fallback
        payload = json.loads(content)
        return _coerce_response(payload, fallback)
    except Exception as exc:
        logger.exception("concept generation failed (provider=%s): %s", provider, exc)
        return fallback
