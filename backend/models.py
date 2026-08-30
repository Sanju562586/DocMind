from pydantic import BaseModel, Field, field_validator
from typing import Optional, List, Dict, Any
import re

# UUID4 pattern for session/doc IDs
_UUID_RE = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$", re.I)


class ChatRequest(BaseModel):
    session_id: str = Field(..., min_length=36, max_length=36)
    message: str = Field(..., min_length=1, max_length=8_000)

    @field_validator("session_id")
    @classmethod
    def validate_session_id(cls, v: str) -> str:
        if not _UUID_RE.match(v):
            raise ValueError("session_id must be a valid UUID")
        return v

    @field_validator("message")
    @classmethod
    def validate_message(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("message cannot be blank")
        return stripped


class SessionCreate(BaseModel):
    title: Optional[str] = Field(default="New Conversation", max_length=200)


class SessionTitleUpdate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)

    @field_validator("title")
    @classmethod
    def validate_title(cls, v: str) -> str:
        stripped = v.strip()
        if not stripped:
            raise ValueError("title cannot be blank")
        return stripped


class DocumentResponse(BaseModel):
    doc_id: str
    session_id: str
    filename: str
    chunk_count: int
    char_count: int
    word_count: Optional[int] = 0
    file_type: Optional[str] = None
    status: Optional[str] = None
    created_at: Optional[str] = None


class MemoryItem(BaseModel):
    session_id: str
    session_title: str
    role: str
    content: str
    score: Optional[float] = 0.0


class SourceItem(BaseModel):
    child_text: str
    section: str
    rerank_score: float
    bm25_score: float
    dense_score: float


class MessageResponse(BaseModel):
    id: str
    session_id: str
    role: str
    content: str
    created_at: str
    sources: Optional[List[SourceItem]] = None
    memory_recalled: Optional[List[MemoryItem]] = None


class SessionResponse(BaseModel):
    id: str
    title: str
    created_at: str
    updated_at: str
    documents: List[DocumentResponse] = Field(default_factory=list)
    message_count: int = 0
