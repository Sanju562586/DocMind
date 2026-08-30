from pydantic_settings import BaseSettings
from typing import Optional
from functools import lru_cache


class Settings(BaseSettings):
    app_name: str = "Document Summarizer"
    database_path: str = "./data/summarizer.db"
    upload_dir: str = "./data/uploads"
    index_dir: str = "./data/indexes"

    # LLM API keys (can be overridden per-request via headers)
    gemini_api_key: Optional[str] = None
    groq_api_key: Optional[str] = None
    openrouter_api_key: Optional[str] = None

    # Model names
    gemini_model: str = "gemini-3.6-flash"
    groq_model: str = "openai/gpt-oss-120b"
    openrouter_model: str = "anthropic/claude-3.5-haiku"

    # Server config
    host: str = "127.0.0.1"
    port: int = 8000

    # Chunking config
    parent_chunk_size: int = 512     # tokens
    child_chunk_size: int = 128      # tokens
    semantic_threshold: float = 0.35  # cosine distance threshold for topic boundary

    # Retrieval config
    retrieval_candidates: int = 50   # candidates fed to cross-encoder
    retrieval_top_k: int = 5         # final results returned

    model_config = {"env_file": ".env", "extra": "ignore"}


@lru_cache()
def get_settings() -> Settings:
    return Settings()
