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


def generate_concepts(req: ConceptRequest, settings: Settings) -> ConceptResponse:
    fallback = _mock_concepts(req)
    if settings.openai_mock:
        return fallback

    try:
        from openai import OpenAI  # lazy import
    except ImportError:
        logger.warning("openai package not installed; returning mock concepts")
        return fallback

    try:
        client = OpenAI(api_key=settings.openai_api_key)
        completion = client.chat.completions.create(
            model=settings.openai_model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": _user_prompt(req)},
            ],
            response_format={"type": "json_object"},
            temperature=0.8,
        )
        content: Optional[str] = completion.choices[0].message.content
        if not content:
            return fallback
        payload = json.loads(content)
        return _coerce_response(payload, fallback)
    except Exception as exc:
        logger.exception("OpenAI concept generation failed: %s", exc)
        return fallback
