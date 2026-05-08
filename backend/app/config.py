from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

# Single source of local secrets: <repo-root>/.env
# config.py lives at backend/app/config.py → parents[2] is the repo root.
PROJECT_ROOT = Path(__file__).resolve().parents[2]
ROOT_ENV_FILE = PROJECT_ROOT / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(ROOT_ENV_FILE),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    runway_api_key: str = ""
    runway_api_base: str = "https://api.dev.runwayml.com"
    runway_api_version: str = "2024-11-06"
    runway_model: str = "gen4_turbo"
    # PR F — Character Host
    runway_host_voice_preset: str = "vincent"
    # Default Unsplash portrait for the curated stock host. Overridable via
    # env so a brand-specific portrait can replace it without code changes.
    runway_host_portrait_url: str = (
        "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=512&q=80"
    )

    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"

    allowed_origins: str = "http://localhost:5173"
    data_dir: str = "./data"

    @property
    def openai_mock(self) -> bool:
        return not self.openai_api_key.strip()

    @property
    def runway_mock(self) -> bool:
        return not self.runway_api_key.strip()

    @property
    def origins_list(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def data_path(self) -> Path:
        return Path(self.data_dir).resolve()


@lru_cache
def get_settings() -> Settings:
    return Settings()
