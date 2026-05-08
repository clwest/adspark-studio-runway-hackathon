from fastapi import APIRouter, Depends

from ..config import Settings, get_settings
from ..models import ConceptRequest, ConceptResponse
from ..services.concept_service import generate_concepts

router = APIRouter(prefix="/api/concepts", tags=["concepts"])


@router.post("", response_model=ConceptResponse)
def post_concepts(req: ConceptRequest, settings: Settings = Depends(get_settings)) -> ConceptResponse:
    return generate_concepts(req, settings)
