from functools import lru_cache
from pathlib import Path

from pydantic import Field, SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Worker configuration (env vars; see README)."""

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Postgres (Supabase pooler, session mode) — used for the job queue.
    database_url: SecretStr
    # Supabase Storage REST
    supabase_url: str
    supabase_service_role_key: SecretStr

    # FLAME assets (licensed separately — see README "Licensing"). Converted by
    # scripts/convert_flame.py into plain NumPy archives.
    flame_dir: Path = Path("/models/flame")

    # Web notification webhook (HMAC-signed)
    web_url: str = "https://twinme.ai"
    recon_webhook_secret: SecretStr

    worker_id: str = Field(default_factory=lambda: __import__("socket").gethostname())
    device: str = "cuda"
    atlas_size: int = 2048
    fit_resolution: int = 512
    heartbeat_seconds: int = 30


@lru_cache
def settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
