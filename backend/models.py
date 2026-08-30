from pydantic import BaseModel, Field
from typing import Optional, List, Dict, Any


class ChatRequest(BaseModel):
    session_id: str
    message: str


class SessionCreate(BaseModel):
    title: Optional[str] = "New Conversation"


class SessionTitleUpdate(BaseModel):
    title: str


class DocumentResponse(BaseModel):
    doc_id: str
    session_id: str
    filename: str
    chunk_count: int
    char_count: int
    word_count: Optional[int] = 0
    file_type: Optional[str] = None
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
