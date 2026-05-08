import logging

from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import Settings, get_settings
from .routers.campaigns import router as campaigns_router
from .routers.concepts import router as concepts_router
from .routers.runway import router as runway_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

app = FastAPI(title="AdSpark Studio API", version="0.1.0")

settings = get_settings()
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.origins_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(concepts_router)
app.include_router(runway_router)
app.include_router(campaigns_router)


@app.get("/health")
def health(s: Settings = Depends(get_settings)) -> dict:
    return {
        "status": "ok",
        "service": "adspark-studio",
        "openai_mock": s.openai_mock,
        "runway_mock": s.runway_mock,
        "any_mock": s.openai_mock or s.runway_mock,
    }
