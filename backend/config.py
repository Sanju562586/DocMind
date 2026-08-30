from pydantic_settings import BaseSettings
from typing import Optional, List
from functools import lru_cache


class Settings(BaseSettings):
    app_name: str = "DocMind Document Intelligence"

    # Storage paths
    database_path: str = "./data/summarizer.db"
    upload_dir: str = "./data/uploads"
    index_dir: str = "./data/indexes"

    # LLM API keys (can be overridden per-request via headers)
    gemini_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None

    # Model names
    gemini_model: str = "gemini-2.0-flash"
    groq_model: str = "llama-3.3-70b-versatile"
    openrouter_model: str = "anthropic/claude-3.5-haiku"

    # Server config
    host: str = "127.0.0.1"
    port: int = 8000

    # CORS — comma-separated list of allowed origins
    # Override via env: ALLOWED_ORIGINS=https://myapp.com,http://localhost:3000
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    # Upload limits
    max_file_size_bytes: int = 52_428_800  # 50 MB

    # Rate limiting strings (slowapi format)
    rate_limit_chat: str = "20/minute"
    rate_limit_summarize: str = "10/minute"

    # Chunking config
    parent_chunk_size: int = 512      # tokens
    child_chunk_size: int = 128       # tokens
    semantic_threshold: float = 0.35  # cosine distance threshold for topic boundary

    # Retrieval config
    retrieval_candidates: int = 50    # candidates fed to cross-encoder
    retrieval_top_k: int = 5          # final results returned

    # In-memory LRU cache max for session indexes
    max_cached_sessions: int = 30

    # Background processing timeouts (seconds)
    parse_timeout: float = 120.0
    index_timeout: float = 180.0

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
