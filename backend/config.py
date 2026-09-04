import os
from pydantic_settings import BaseSettings
from typing import Optional, List
from functools import lru_cache

_BACKEND_DIR = os.path.dirname(os.path.abspath(__file__))
_DEFAULT_DB_PATH = os.path.join(_BACKEND_DIR, "data", "summarizer.db")
_DEFAULT_UPLOAD_DIR = os.path.join(_BACKEND_DIR, "data", "uploads")
_DEFAULT_INDEX_DIR = os.path.join(_BACKEND_DIR, "data", "indexes")


class Settings(BaseSettings):
    app_name: str = "DocMind Document Intelligence"

    # Storage & Database configuration
    database_path: str = _DEFAULT_DB_PATH
    database_url: Optional[str] = None  # e.g., postgresql://user:password@localhost:5432/docmind
    upload_dir: str = _DEFAULT_UPLOAD_DIR
    index_dir: str = _DEFAULT_INDEX_DIR

    @property
    def resolved_database_path(self) -> str:
        if os.path.isabs(self.database_path):
            return self.database_path
        candidate = os.path.join(_BACKEND_DIR, self.database_path.lstrip("./"))
        if os.path.exists(candidate) or os.path.exists(os.path.dirname(candidate)):
            return candidate
        return os.path.abspath(self.database_path)

    @property
    def resolved_upload_dir(self) -> str:
        if os.path.isabs(self.upload_dir):
            return self.upload_dir
        candidate = os.path.join(_BACKEND_DIR, self.upload_dir.lstrip("./"))
        if os.path.exists(candidate) or os.path.exists(os.path.dirname(candidate)):
            return candidate
        return os.path.abspath(self.upload_dir)

    @property
    def resolved_index_dir(self) -> str:
        if os.path.isabs(self.index_dir):
            return self.index_dir
        candidate = os.path.join(_BACKEND_DIR, self.index_dir.lstrip("./"))
        if os.path.exists(candidate) or os.path.exists(os.path.dirname(candidate)):
            return candidate
        return os.path.abspath(self.index_dir)

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

    # Upstash Redis & Rate Limiting
    upstash_redis_rest_url: Optional[str] = None
    upstash_redis_rest_token: Optional[str] = None
    redis_url: Optional[str] = None

    # Rate limiting strings
    rate_limit_chat: str = "20/minute"
    rate_limit_upload: str = "10/minute"
    rate_limit_summarize: str = "10/minute"
    rate_limit_compare: str = "10/minute"
    rate_limit_quiz: str = "15/minute"
    rate_limit_url: str = "10/minute"

    # Authentication & Session Security
    auth_secret: str = "docmind_jwt_secret_dev_key_change_in_production"
    jwt_algorithm: str = "HS256"
    jwt_expire_minutes: int = 43200  # 30 days
    google_client_id: Optional[str] = None
    google_client_secret: Optional[str] = None
    github_client_id: Optional[str] = None
    github_client_secret: Optional[str] = None

    # Storage backend configuration
    storage_backend: str = "local"  # "local" or "s3"
    s3_endpoint_url: Optional[str] = None
    s3_bucket_name: Optional[str] = None
    s3_access_key: Optional[str] = None
    s3_secret_key: Optional[str] = None
    s3_region: str = "us-east-1"

    # Async task worker queue settings
    max_async_workers: int = 4
    task_queue_max_size: int = 100

    # Observability & Metrics
    enable_metrics: bool = True
    log_format: str = "text"  # "text" or "json"

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

    model_config = {
        "env_file": (
            os.path.join(_BACKEND_DIR, ".env"),
            ".env",
        ),
        "extra": "ignore",
    }


@lru_cache()
def get_settings() -> Settings:
    return Settings()
