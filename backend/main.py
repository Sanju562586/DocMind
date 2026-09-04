"""
FastAPI Application — DocMind Document Summarizer, User Isolation & Security Suite
"""

import asyncio
import json
import logging
import os
import re
import sys
import uuid
from contextlib import asynccontextmanager
from typing import Optional, List, Dict, Any

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import time
import aiofiles
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, Query, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse, Response
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from chunker import HierarchicalSemanticChunker
from config import get_settings
from document_parser import DocumentParser
from llm_router import LLMRouter
from models import (
    ChatRequest, SessionCreate, SessionTitleUpdate,
    UrlIngestRequest, CompareRequest, QuizRequest,
    DocumentResponse, MemoryItem, SourceItem, MessageResponse, SessionResponse
)
from retrieval import HybridRetriever
from session_store import SessionStore
from rate_limiter import UpstashRateLimiter
from auth import extract_user_identity
from storage import get_storage_backend, StorageBackend
from task_queue import AsyncTaskQueue
from metrics import metrics

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("docmind")

settings = get_settings()

parser: Optional[DocumentParser] = None
chunker: Optional[HierarchicalSemanticChunker] = None
retriever: Optional[HybridRetriever] = None
store: Optional[SessionStore] = None
router_llm: Optional[LLMRouter] = None
rate_limiter: Optional[UpstashRateLimiter] = None
storage: Optional[StorageBackend] = None
task_queue: Optional[AsyncTaskQueue] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global parser, chunker, retriever, store, router_llm, rate_limiter, storage, task_queue

    upload_dir = settings.resolved_upload_dir
    index_dir = settings.resolved_index_dir
    db_path = settings.resolved_database_path

    os.makedirs(upload_dir, exist_ok=True)
    os.makedirs(index_dir, exist_ok=True)

    logger.info("Initializing DocMind production backend components...")
    store = SessionStore(db_path=db_path, database_url=settings.database_url)
    store.initialize()

    storage = get_storage_backend(settings)
    task_queue = AsyncTaskQueue(
        max_workers=settings.max_async_workers,
        max_queue_size=settings.task_queue_max_size,
    )
    await task_queue.start()

    parser = DocumentParser()
    chunker = HierarchicalSemanticChunker(
        parent_chunk_size=settings.parent_chunk_size,
        child_chunk_size=settings.child_chunk_size,
        semantic_threshold=settings.semantic_threshold,
    )
    retriever = HybridRetriever(
        index_dir=index_dir,
        top_k=settings.retrieval_top_k,
        candidates_k=settings.retrieval_candidates,
        max_cached_sessions=settings.max_cached_sessions,
    )
    retriever.register_on_model_ready(chunker.set_embed_model)
    router_llm = LLMRouter()

    rate_limiter = UpstashRateLimiter(
        rest_url=settings.upstash_redis_rest_url,
        rest_token=settings.upstash_redis_rest_token,
        redis_url=settings.redis_url,
    )
    if rate_limiter.is_upstash_configured:
        logger.info("Upstash Redis rate limiter initialized [OK]")
    else:
        logger.info("In-memory sliding window rate limiter initialized (Upstash credentials optional) [OK]")

    logger.info("All DocMind backend components ready [OK]")
    try:
        yield
    finally:
        logger.info("DocMind backend shutting down gracefully...")
        if task_queue:
            await task_queue.stop()
        if store:
            store.close()


limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app = FastAPI(title="DocMind Document Intelligence API", version="2.3.0", lifespan=lifespan)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

cors_origins = settings.cors_origins if settings.cors_origins else ["http://localhost:3000", "http://127.0.0.1:3000"]
app.add_middleware(
    CORSMiddleware,
    allow_origins=cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def telemetry_middleware(request: Request, call_next):
    start = time.perf_counter()
    response = await call_next(request)
    duration = time.perf_counter() - start
    response.headers["X-Process-Time"] = f"{duration * 1000.0:.2f}ms"
    if settings.enable_metrics:
        metrics.record_request(request.method, request.url.path, response.status_code, duration)
    return response


@app.get("/metrics")
async def prometheus_metrics():
    """Prometheus telemetry exposition endpoint for scraping system metrics."""
    if not settings.enable_metrics:
        raise HTTPException(status_code=404, detail="Metrics disabled")
    return Response(content=metrics.generate_prometheus_text(), media_type="text/plain; version=0.0.4")


def _get_user_info(request: Request) -> Dict[str, str]:
    """Extract verified cryptographic user identity or default guest identifier."""
    user = extract_user_identity(request, settings.auth_secret)
    if store and user.get("user_id") and user["user_id"] != "default_user":
        try:
            store.upsert_user(
                user_id=user["user_id"],
                email=user.get("email", "unknown@docmind.local"),
                name=user.get("name"),
                image=user.get("image"),
                provider=user.get("provider", "credentials"),
            )
        except Exception as exc:
            logger.debug("User upsert non-critical warning: %s", exc)
    return user


def _api_keys(request: Request) -> dict:
    """Extract API keys prioritizing request headers then server environment variables."""
    def _clean(val: Optional[str]) -> Optional[str]:
        if val is None:
            return None
        v = val.strip()
        return v if v else None

    return {
        "gemini": _clean(request.headers.get("X-Gemini-Key")) or _clean(settings.gemini_api_key),
        "groq": _clean(request.headers.get("X-Groq-Key")) or _clean(settings.groq_api_key),
        "openrouter": _clean(request.headers.get("X-OpenRouter-Key")) or _clean(settings.openrouter_api_key),
    }


async def _enforce_rate_limit(request: Request, limit_str: str, resource_name: str = "api"):
    """Enforce rate limits per user/IP using Upstash Redis or sliding window memory store."""
    if not rate_limiter:
        return

    parts = limit_str.split("/")
    limit = int(parts[0]) if parts and parts[0].isdigit() else 20
    window = 60
    if len(parts) > 1:
        unit = parts[1].lower()
        if "sec" in unit:
            window = 1
        elif "min" in unit:
            window = 60
        elif "hour" in unit:
            window = 3600

    client_ip = request.client.host if request.client else "127.0.0.1"
    user_id = request.headers.get("X-User-Id") or client_ip
    key = f"{resource_name}:{user_id}"

    allowed, remaining, reset_secs, retry_after = await rate_limiter.check_async(key, limit, window)
    if not allowed:
        raise HTTPException(
            status_code=429,
            detail=f"Rate limit exceeded for {resource_name} ({limit_str}). Please wait {retry_after}s before retrying.",
            headers={
                "Retry-After": str(retry_after),
                "X-RateLimit-Limit": str(limit),
                "X-RateLimit-Remaining": "0",
                "X-RateLimit-Reset": str(reset_secs),
            }
        )


def _sse(data: dict) -> str:
    return f"data: {json.dumps(data)}\n\n"


# ──────────────────────────────────────────────
# Health & Status Endpoints
# ──────────────────────────────────────────────

@app.get("/api/health")
async def health_check():
    return {
        "status": "healthy",
        "service": "DocMind Document Intelligence API",
        "version": "2.3.0",
        "database": "postgresql" if (store and store.is_postgres) else "sqlite",
        "storage_backend": settings.storage_backend,
        "task_queue": task_queue.stats() if task_queue else {"status": "uninitialized"},
        "neural_models_ready": retriever.is_neural_ready if retriever else False,
        "rate_limiter": "upstash_redis" if (rate_limiter and rate_limiter.is_upstash_configured) else "in_memory_sliding_window",
        "providers_available": ["gemini", "groq", "openrouter"],
    }


@app.get("/api/health/live")
async def liveness():
    """Liveness probe: returns 200 if the server process is alive."""
    return {"status": "alive"}


@app.get("/api/health/ready")
async def readiness():
    """Readiness probe: returns 200 if backend database and components are initialized."""
    if store is None or retriever is None:
        return JSONResponse(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, content={"status": "initializing"})
    return {"status": "ready", "neural_ready": retriever.is_neural_ready}


# ──────────────────────────────────────────────
# System & User Statistics
# ──────────────────────────────────────────────

@app.get("/api/stats")
async def get_system_stats(request: Request):
    """Retrieve platform statistics for the authenticated user session."""
    user = _get_user_info(request)
    stats = store.get_stats(user_id=user["user_id"])
    stats["neural_models_ready"] = retriever.is_neural_ready if retriever else False
    stats["status"] = "healthy"
    stats["user_id"] = user["user_id"]
    return stats


# ──────────────────────────────────────────────
# Session Management Endpoints (User-Scoped)
# ──────────────────────────────────────────────

@app.post("/api/sessions")
async def create_session(body: SessionCreate, request: Request):
    user = _get_user_info(request)
    title = body.title or "New Conversation"
    session_id = store.create_session(title=title, user_id=user["user_id"])
    return {"id": session_id, "session_id": session_id, "title": title, "user_id": user["user_id"]}


@app.get("/api/sessions")
async def list_sessions(request: Request):
    user = _get_user_info(request)
    if store and user.get("user_id") and user["user_id"] != "default_user":
        try:
            store.claim_legacy_sessions(user["user_id"])
        except Exception as exc:
            logger.debug("Non-critical legacy session claim notice: %s", exc)
    return store.list_sessions(user_id=user["user_id"])


@app.delete("/api/sessions")
async def delete_all_sessions(request: Request):
    """Clear all sessions, documents, and indexes for the authenticated user."""
    user = _get_user_info(request)
    sessions = store.list_sessions(user_id=user["user_id"])
    for session in sessions:
        for doc in session.get("documents", []):
            if doc.get("file_path"):
                if storage:
                    await storage.delete_file(doc["file_path"])
                elif os.path.exists(doc["file_path"]):
                    try:
                        os.remove(doc["file_path"])
                    except OSError:
                        pass
        retriever.delete_session_index(session["id"])
    store.delete_all_sessions(user_id=user["user_id"])
    return {"status": "all_deleted", "user_id": user["user_id"]}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str, request: Request):
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")
    return session


@app.patch("/api/sessions/{session_id}/title")
async def update_session_title(session_id: str, body: SessionTitleUpdate, request: Request):
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")
    new_title = body.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    store.update_session_title(session_id, new_title, user_id=user["user_id"])
    return {"session_id": session_id, "title": new_title}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")
    # Clean up document files & index
    for doc in session.get("documents", []):
        if doc.get("file_path"):
            if storage:
                await storage.delete_file(doc["file_path"])
            elif os.path.exists(doc["file_path"]):
                try:
                    os.remove(doc["file_path"])
                except OSError:
                    pass
    retriever.delete_session_index(session_id)
    store.delete_session(session_id, user_id=user["user_id"])
    return {"status": "deleted", "session_id": session_id}


@app.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str, request: Request):
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")
    return store.get_messages(session_id)


# ──────────────────────────────────────────────
# Shareable Chat Link Endpoints
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/share")
async def create_session_share_link(session_id: str, request: Request):
    """Generate a secure public share link for a conversation."""
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    share_token, shared_at = store.create_share_link(session_id, user_id=user["user_id"])
    return {
        "session_id": session_id,
        "share_token": share_token,
        "share_url": f"/share/{share_token}",
        "shared_at": shared_at,
        "is_shared": True,
    }


@app.delete("/api/sessions/{session_id}/share")
async def revoke_session_share_link(session_id: str, request: Request):
    """Revoke public share link for a conversation."""
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    store.revoke_share_link(session_id, user_id=user["user_id"])
    return {"session_id": session_id, "is_shared": False, "status": "revoked"}


@app.get("/api/shared/{share_token}")
async def get_public_shared_chat(share_token: str):
    """Public endpoint to fetch shared conversation transcript (no auth required)."""
    shared = store.get_shared_session(share_token)
    if not shared:
        raise HTTPException(
            status_code=404,
            detail="Shared conversation not found or public access has been revoked by the author.",
        )
    return shared


# ──────────────────────────────────────────────
# Global Cross-Session Memory Management (User-Scoped)
# ──────────────────────────────────────────────

@app.get("/api/memory")
async def list_global_memories(request: Request):
    """List all global cross-session memories for the authenticated user."""
    user = _get_user_info(request)
    return store.get_all_global_memories(user_id=user["user_id"])


@app.delete("/api/memory/{memory_id}")
async def delete_memory_item(memory_id: str, request: Request):
    """Delete a specific global memory item."""
    user = _get_user_info(request)
    store.delete_global_memory(memory_id, user_id=user["user_id"])
    return {"status": "deleted", "memory_id": memory_id}


@app.delete("/api/memory")
async def clear_all_memories(request: Request):
    """Clear all global cross-session memories for the authenticated user."""
    user = _get_user_info(request)
    store.clear_all_global_memory(user_id=user["user_id"])
    return {"status": "all_cleared", "user_id": user["user_id"]}


# ──────────────────────────────────────────────
# Session-Scoped Document Upload & Management
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/documents")
async def upload_document_to_session(
    session_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    # Enforce Upstash / in-memory rate limiting
    await _enforce_rate_limit(request, settings.rate_limit_upload, resource_name="upload")

    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    # Read uploaded bytes with size bounds checking
    content = await file.read()

    # Server-side validation and sanitization
    try:
        clean_filename, ext = DocumentParser.validate_upload(
            file_bytes=content,
            raw_filename=file.filename or "document.txt",
            max_size_bytes=settings.max_file_size_bytes
        )
    except ValueError as val_err:
        raise HTTPException(status_code=400, detail=str(val_err))

    doc_id = str(uuid.uuid4())
    safe_name = f"{session_id}_{doc_id}_{clean_filename}"

    if storage:
        file_path = await storage.save_file(content=content, destination_name=safe_name)
    else:
        file_path = os.path.join(settings.upload_dir, safe_name)
        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

    file_type = ext.lstrip(".")
    # Save to database immediately with status="processing"
    store.save_document(
        doc_id=doc_id,
        session_id=session_id,
        filename=clean_filename,
        chunk_count=0,
        char_count=0,
        word_count=0,
        file_type=file_type,
        file_path=file_path,
        status="processing",
    )

    # Automatically update session title if default
    if session["title"] in ("New Conversation", "New Chat") or len(session.get("documents", [])) == 0:
        clean_title = clean_filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ")
        store.update_session_title(session_id, clean_title[:60], user_id=user["user_id"])

    # Background async processing with timeout protection
    async def _process_document_background(d_id: str, s_id: str, f_path: str, f_name: str):
        try:
            logger.info("Background processing started for '%s' (id: %s)", f_name, d_id)
            doc_text, metadata = await asyncio.wait_for(
                asyncio.to_thread(parser.parse, f_path, f_name),
                timeout=settings.parse_timeout,
            )
            chunks = await asyncio.wait_for(
                asyncio.to_thread(chunker.chunk_document, doc_text, d_id, s_id, metadata),
                timeout=settings.parse_timeout,
            )
            await asyncio.wait_for(
                asyncio.to_thread(retriever.index_session_chunks, s_id, chunks),
                timeout=settings.index_timeout,
            )

            w_count = metadata.get("word_count", len(doc_text.split()))
            store.update_document_processed(
                doc_id=d_id,
                chunk_count=len(chunks),
                char_count=len(doc_text),
                word_count=w_count,
                status="ready",
            )
            if settings.enable_metrics:
                metrics.record_document_processed(file_type, "success")
            logger.info("Background processing complete for '%s' [OK] (%d chunks indexed)", f_name, len(chunks))
        except asyncio.TimeoutError:
            logger.error("Processing timed out for document '%s'", f_name)
            store.update_document_processed(
                doc_id=d_id, chunk_count=0, char_count=0, word_count=0, status="error"
            )
            if settings.enable_metrics:
                metrics.record_document_processed(file_type, "timeout")
        except Exception as exc:
            logger.exception("Background processing failed for '%s': %s", f_name, exc)
            store.update_document_processed(
                doc_id=d_id, chunk_count=0, char_count=0, word_count=0, status="error"
            )
            if settings.enable_metrics:
                metrics.record_document_processed(file_type, "error")

    if task_queue and task_queue._running:
        await task_queue.enqueue(
            f"process_document_{doc_id}",
            _process_document_background,
            doc_id,
            session_id,
            file_path,
            clean_filename,
        )
    else:
        background_tasks.add_task(_process_document_background, doc_id, session_id, file_path, clean_filename)

    return {
        "id": doc_id,
        "doc_id": doc_id,
        "session_id": session_id,
        "filename": clean_filename,
        "chunk_count": 0,
        "char_count": 0,
        "word_count": 0,
        "file_type": file_type,
        "status": "processing",
        "message": "Successfully uploaded document",
    }


@app.get("/api/sessions/{session_id}/documents")
async def list_session_documents(session_id: str, request: Request):
    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")
    return store.list_session_documents(session_id)


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str, request: Request):
    user = _get_user_info(request)
    doc = store.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    session = store.get_session(doc["session_id"], user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=403, detail="Unauthorized document access")

    session_id = doc["session_id"]
    store.delete_document(doc_id)
    retriever.remove_document_from_session(session_id, doc_id)
    if doc.get("file_path"):
        if storage:
            await storage.delete_file(doc["file_path"])
        elif os.path.exists(doc["file_path"]):
            try:
                os.remove(doc["file_path"])
            except OSError:
                pass
    return {"status": "deleted", "session_id": session_id}


# ──────────────────────────────────────────────
# Chat & Global Cross-Session Memory Streaming
# ──────────────────────────────────────────────

SYSTEM_PROMPT_TEMPLATE = """You are DocMind, an intelligent document assistant designed to provide summaries, analyses, and answers in a standard, formal, and structured manner using simple and easily understandable words.

## PRIMARY GOAL: STANDARD & FORMAL TONE IN SIMPLE, UNDERSTANDABLE WORDS
Your top priority is to communicate in a **standard, formal, and professional manner**, while ensuring every explanation is written in **simple, clear, and plain language**.
- **Standard & Formal Demeanor**: Maintain an objective, professional, and well-organized tone. Avoid slang, overly colloquial phrasing, or hyper-casual expressions.
- **Simple, Clear Vocabulary**: Use plain, straightforward words and concise sentence structures. Avoid dense academic jargon, overly complex phrasing, or convoluted terminology.
- **Explain Essential Technical Terms**: If a specialized term from the context is necessary to include, provide an immediate explanation in simple, everyday words.
- **Synthesize Information**: Do NOT copy raw chunks or long paragraphs verbatim. Synthesize and organize the key facts clearly in your own words.
- **Direct & Accurate**: State the facts directly and accurately, strictly grounded in the document context.

## RESPONSE STYLE & STRUCTURE
1. **Executive Overview / Direct Summary**: Begin with a standard, formal, and clear summary of the core answer or topic in simple words.
2. **Key Points & Structured Findings**: Present major concepts, facts, or steps using clean, organized bullet points with simple explanations.
3. **Contextual & Practical Clarity**: Explain the logic and implications clearly so the information is effortless to follow.
4. **Conclusion & Key Takeaways**: Provide a concise, formal wrap-up highlighting the most important takeaways.
5. **Clean Markdown Formatting**:
   - Always put a blank line before and after section headings (e.g., `\n\n### Section Title\n\n`). Never attach a heading directly to previous text or bold markers.
   - Always include a space after markdown hashes (e.g. `### Heading`, never `###Heading`).
   - Always close bold tags `**text**` cleanly before starting any new section or list.
   - Separate bullet lists, code blocks, and tables with clean blank lines for pristine readability.
   - **CRITICAL — Never split italic or bold across paragraph breaks.** An italic or bold span MUST open AND close on the same paragraph.
   - Use **`-`** for all bullet list items. NEVER use `*` or literal bullet characters as bullet markers.
   - For key definitions, always format cleanly as `- **Term Name:** Clear explanation.` on a single line.
   - Format document citations cleanly as `[Document.docx]` directly attached to sentences without trailing spaces before punctuation.

## DOCUMENT-GROUNDING PROTOCOL
Follow this decision flow for every user query:

### STEP 1 — Grounding in Received Context
Answer primarily using the facts and information present in the CURRENT CHAT DOCUMENT CONTEXT and CROSS-SESSION GLOBAL MEMORY.
- Explain the facts accurately based on the context, formatted in a standard and formal manner with simple words.
- Mention the source simply if helpful (e.g. `[Document Name]`).

### STEP 2 — If the Answer is NOT in the Documents
If the user asks about something not mentioned in the provided documents, begin your response with this exact disclosure block:

---
⚠️ **This information is not present in the provided document(s).**
The following answer is provided in a standard, formal manner based on general knowledge using simple words.

---

Then provide a standard, formal explanation in plain and understandable language.

============================================================
CURRENT CHAT DOCUMENT CONTEXT:
{doc_context}
============================================================

CROSS-SESSION GLOBAL MEMORY (Context from past conversations):
{memory_context}
============================================================
"""


@app.post("/api/chat")
async def chat(request: Request, body: ChatRequest):
    # Enforce Upstash / in-memory rate limiting
    await _enforce_rate_limit(request, settings.rate_limit_chat, resource_name="chat")

    user = _get_user_info(request)
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(
            status_code=400,
            detail="No API keys configured on server or in request. Please configure Gemini, Groq, or OpenRouter keys.",
        )

    session = store.get_session(body.session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    query = body.message.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    use_global = getattr(body, "use_global_memory", True)

    # 1. Retrieve document chunks (either global across all user documents or current chat only)
    if use_global:
        try:
            all_user_sessions = store.list_sessions(user_id=user["user_id"])
            other_session_ids = [s["id"] for s in all_user_sessions if s["id"] != body.session_id]
        except Exception:
            other_session_ids = []

        retrieved_chunks = await asyncio.to_thread(
            retriever.retrieve, body.session_id, query, additional_session_ids=other_session_ids
        )

        # 2. Retrieve user-isolated global cross-session memory
        all_other_memories = store.get_all_global_memories(user_id=user["user_id"], exclude_session_id=body.session_id)
        recalled_memories = await asyncio.to_thread(
            retriever.retrieve_global_memory, query, all_other_memories, top_k=3
        )
    else:
        # Strictly session-only memory: only documents and chat history in this current conversation
        retrieved_chunks = await asyncio.to_thread(
            retriever.retrieve, body.session_id, query, additional_session_ids=None
        )
        recalled_memories = []

    # Build Document Context
    if retrieved_chunks:
        doc_parts = []
        for i, r in enumerate(retrieved_chunks, 1):
            doc_name = r["metadata"].get("title") or r["metadata"].get("source") or "Document"
            section = r["metadata"].get("section", "Section")
            doc_parts.append(f"[Source {i} | Doc: {doc_name} | {section}]\n{r['parent_text']}")
        doc_context = "\n\n".join(doc_parts)
    else:
        if use_global:
            doc_context = "(No documents attached to this chat session or previous sessions yet.)"
        else:
            doc_context = "(No documents attached to this current chat session yet. Current Chat Only mode active.)"

    # Build Global Memory Context
    if recalled_memories:
        mem_parts = []
        for m in recalled_memories:
            mem_parts.append(f"- [From Previous Chat: \"{m['session_title']}\"]: {m['content']}")
        memory_context = "\n".join(mem_parts)
    else:
        if use_global:
            memory_context = "(No relevant past cross-session memory found for this query.)"
        else:
            memory_context = "(Current Chat Only mode active. Global memory and past session insights are excluded.)"

    # System instruction
    system_prompt = SYSTEM_PROMPT_TEMPLATE.format(
        doc_context=doc_context,
        memory_context=memory_context,
    )

    # Build message array
    history = store.get_messages(body.session_id)
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history[-10:]:
        if msg["role"] in ("user", "assistant"):
            messages.append({"role": msg["role"], "content": msg["content"]})
    messages.append({"role": "user", "content": query})

    # Save user message & user-isolated memory
    store.save_message(body.session_id, "user", query)
    store.save_global_memory(body.session_id, session["title"], "user", query, user_id=user["user_id"])

    # If first message, auto-update title
    if len(history) == 0 and session["title"] in ("New Conversation", "New Chat"):
        new_title = query[:40] + ("…" if len(query) > 40 else "")
        store.update_session_title(body.session_id, new_title, user_id=user["user_id"])

    # ── Streaming Generator ──
    async def generate():
        full_response = ""
        sources_payload = [
            {
                "child_text": r["child_text"],
                "section": r["metadata"].get("section", "Document"),
                "doc_id": r.get("doc_id") or r["metadata"].get("doc_id"),
                "title": r["metadata"].get("title") or r["metadata"].get("source") or "Document",
                "page_number": r["metadata"].get("page_number"),
                "rerank_score": r["rerank_score"],
                "bm25_score": r["bm25_score"],
                "dense_score": r["dense_score"],
            }
            for r in retrieved_chunks
        ]
        memory_payload = recalled_memories

        # Emit active memory scope metadata
        yield _sse({
            "type": "meta",
            "use_global_memory": use_global,
            "scope": "global" if use_global else "session_only",
        })

        # Send recalled memory & sources metadata to frontend
        if memory_payload:
            yield _sse({"type": "memory_recalled", "memories": memory_payload})
        if sources_payload:
            yield _sse({"type": "sources", "sources": sources_payload})

        try:
            async for token in router_llm.stream(
                messages,
                gemini_key=keys["gemini"],
                groq_key=keys["groq"],
                openrouter_key=keys["openrouter"],
                gemini_model=settings.gemini_model,
                groq_model=settings.groq_model,
                openrouter_model=settings.openrouter_model,
            ):
                full_response += token
                yield _sse({"type": "token", "content": token})

            # Save assistant response & memory
            if full_response.strip():
                if settings.enable_metrics:
                    metrics.record_tokens("llm_stream", max(1, len(full_response) // 4))
                store.save_message(
                    body.session_id,
                    "assistant",
                    full_response,
                    sources=sources_payload,
                    memory_recalled=memory_payload,
                )
                store.save_global_memory(
                    body.session_id,
                    session["title"],
                    "assistant",
                    full_response[:500],
                    user_id=user["user_id"],
                )

            yield _sse({"type": "done"})

        except Exception as exc:
            logger.exception("Chat generation error: %s", exc)
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────────────────────────
# Session Document Summarization
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/summarize")
async def summarize_session(session_id: str, request: Request):
    await _enforce_rate_limit(request, settings.rate_limit_summarize, resource_name="summarize")

    user = _get_user_info(request)
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(status_code=400, detail="No API keys configured.")

    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    docs = session.get("documents", [])
    if not docs:
        raise HTTPException(status_code=400, detail="No documents attached to this chat to summarize.")

    retrieved = await asyncio.to_thread(
        retriever.retrieve, session_id, "overview main points summary key findings conclusions", top_k=10, candidates_k=80
    )
    context = "\n\n".join(r["parent_text"] for r in retrieved) if retrieved else "Document content is empty."

    messages = [
        {
            "role": "system",
            "content": (
                "You are DocMind. Generate a comprehensive, well-structured document summary in a standard, formal, and professional manner, using simple and easily understandable words.\n\n"
                "Summary Guidelines:\n"
                "- Tone & Style: Maintain an objective, formal, and standard tone while strictly using simple, clear, and plain language.\n"
                "- Vocabulary: Avoid dense academic jargon or overly complex phrasing. If a specialized term is necessary, explain it immediately in simple words.\n"
                "- Synthesis: Synthesize the material logically and concisely rather than copying raw text verbatim.\n\n"
                "Structure your summary with:\n"
                "1. 📌 Executive Overview (a standard, formal overview of the document in simple, clear terms)\n"
                "2. 📋 Key Findings & Core Topics (structured, easy-to-understand bullet points covering the main points)\n"
                "3. 💡 Detailed Analysis & Explanations (step-by-step breakdown of essential concepts in plain words)\n"
                "4. 🎯 Conclusion & Key Takeaways (the most crucial takeaways and conclusions presented clearly)\n\n"
                "Format using clean Markdown with bold terms and organized bullet points.\n\n"
                f"DOCUMENTS CONTENT:\n{context}"
            ),
        },
        {"role": "user", "content": "Please provide a standard and formal summary of the attached document(s) in simple, understandable words."},
    ]

    async def generate():
        full = ""
        try:
            async for token in router_llm.stream(
                messages,
                gemini_key=keys["gemini"],
                groq_key=keys["groq"],
                openrouter_key=keys["openrouter"],
                gemini_model=settings.gemini_model,
                groq_model=settings.groq_model,
                openrouter_model=settings.openrouter_model,
            ):
                full += token
                yield _sse({"type": "token", "content": token})

            if full.strip():
                if settings.enable_metrics:
                    metrics.record_tokens("llm_stream", max(1, len(full) // 4))
                store.save_message(session_id, "user", "Please provide a standard and formal summary of the attached document(s) in simple, understandable words.")
                store.save_message(session_id, "assistant", full)
                store.save_global_memory(
                    session_id,
                    session["title"],
                    "assistant",
                    full[:500],
                    user_id=user["user_id"],
                )

            yield _sse({"type": "done"})
        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────────────────────────
# Web URL Ingestion Endpoint
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/url")
async def ingest_url_to_session(
    session_id: str,
    request: Request,
    body: UrlIngestRequest,
    background_tasks: BackgroundTasks
):
    await _enforce_rate_limit(request, settings.rate_limit_url, resource_name="url_ingest")

    user = _get_user_info(request)
    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    url = body.url.strip()
    doc_id = str(uuid.uuid4())
    domain_name = url.split("//")[-1].split("/")[0]
    clean_filename = f"URL_{domain_name}_{doc_id[:6]}"

    try:
        url_text, metadata = parser.parse_url(url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to ingest URL: {exc}")

    store.save_document(
        doc_id=doc_id,
        session_id=session_id,
        filename=metadata.get("title") or clean_filename,
        chunk_count=0,
        char_count=len(url_text),
        word_count=len(url_text.split()),
        file_type="url",
        file_path=url,
        status="processing",
    )

    async def _process_url_background(d_id: str, s_id: str, text: str, meta: dict):
        try:
            chunks = await asyncio.wait_for(
                asyncio.to_thread(chunker.chunk_document, text, d_id, s_id, meta),
                timeout=settings.parse_timeout,
            )
            await asyncio.wait_for(
                asyncio.to_thread(retriever.index_session_chunks, s_id, chunks),
                timeout=settings.index_timeout,
            )
            store.update_document_processed(
                doc_id=d_id,
                chunk_count=len(chunks),
                char_count=len(text),
                word_count=len(text.split()),
                status="ready",
            )
            if settings.enable_metrics:
                metrics.record_document_processed("url", "success")
            logger.info("URL processing complete for '%s' [OK] (%d chunks indexed)", url, len(chunks))
        except Exception as exc:
            logger.exception("URL background processing failed for '%s': %s", url, exc)
            store.update_document_processed(
                doc_id=d_id, chunk_count=0, char_count=0, word_count=0, status="error"
            )
            if settings.enable_metrics:
                metrics.record_document_processed("url", "error")

    if task_queue and task_queue._running:
        await task_queue.enqueue(
            f"process_url_{doc_id}",
            _process_url_background,
            doc_id,
            session_id,
            url_text,
            metadata,
        )
    else:
        background_tasks.add_task(_process_url_background, doc_id, session_id, url_text, metadata)

    return {
        "id": doc_id,
        "doc_id": doc_id,
        "session_id": session_id,
        "filename": metadata.get("title") or clean_filename,
        "file_type": "url",
        "status": "processing",
        "message": "Successfully initiated URL ingestion",
    }


# ──────────────────────────────────────────────
# Multi-Document Comparison Matrix Endpoint
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/compare")
async def compare_documents(session_id: str, request: Request, body: CompareRequest):
    await _enforce_rate_limit(request, settings.rate_limit_compare, resource_name="compare")

    user = _get_user_info(request)
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(status_code=400, detail="No API keys configured.")

    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    docs = session.get("documents", [])
    if not docs:
        raise HTTPException(status_code=400, detail="No documents uploaded in this chat session to compare.")

    selected_docs = [
        d for d in docs
        if not body.doc_ids or (d.get("doc_id") in body.doc_ids or d.get("id") in body.doc_ids)
    ]
    if len(selected_docs) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 documents are required for comparison. Please upload another file.",
        )

    doc_contexts = []
    for d in selected_docs[:4]:
        chunks = await asyncio.to_thread(
            retriever.retrieve, session_id, f"overview key points {body.focus_topic}", top_k=5
        )
        target_id = d.get("doc_id") or d.get("id")
        doc_chunks = [
            c for c in chunks
            if (c.get("doc_id") == target_id or c.get("metadata", {}).get("doc_id") == target_id)
        ]
        if not doc_chunks:
            doc_chunks = chunks[:3]
        text_summary = "\n".join([c["child_text"] for c in doc_chunks])
        doc_contexts.append(f"### DOCUMENT: {d['filename']}\n{text_summary}")

    comparison_prompt = (
        f"You are DocMind. Compare these documents in a standard, formal, and structured manner using simple and easily understandable words.\n"
        f"Focus Area: {body.focus_topic}\n\n"
        f"DOCUMENT CONTENTS:\n" + "\n\n".join(doc_contexts) + "\n\n"
        f"Provide your output in clean Markdown with:\n"
        f"1. 📌 Overview of the Comparison (formal yet simple overview)\n"
        f"2. 📊 Structured Comparison Table (clear and easy to read)\n"
        f"3. 💡 Key Similarities & Notable Differences (explained in plain, simple language)\n"
        f"4. 🎯 Summary & Key Takeaways (standard, formal conclusion in everyday terms)"
    )

    messages = [
        {"role": "system", "content": "You are a helpful document assistant that explains comparisons in a standard, formal manner using simple, clear, and understandable language."},
        {"role": "user", "content": comparison_prompt},
    ]

    async def generate():
        try:
            async for token in router_llm.stream(
                messages,
                gemini_key=keys["gemini"],
                groq_key=keys["groq"],
                openrouter_key=keys["openrouter"],
                gemini_model=settings.gemini_model,
                groq_model=settings.groq_model,
                openrouter_model=settings.openrouter_model,
            ):
                yield _sse({"type": "token", "content": token})
            yield _sse({"type": "done"})
        except Exception as exc:
            yield _sse({"type": "error", "message": str(exc)})

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


# ──────────────────────────────────────────────
# Interactive Quiz & Flashcard Generator
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/quiz")
async def generate_quiz(session_id: str, request: Request, body: QuizRequest):
    await _enforce_rate_limit(request, settings.rate_limit_quiz, resource_name="quiz")

    user = _get_user_info(request)
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(status_code=400, detail="No API keys configured.")

    session = store.get_session(session_id, user_id=user["user_id"])
    if not session:
        raise HTTPException(status_code=404, detail="Session not found or unauthorized")

    docs = session.get("documents", [])
    if not docs:
        raise HTTPException(status_code=400, detail="No documents found in session to generate quiz.")

    retrieved = await asyncio.to_thread(
        retriever.retrieve, session_id, "key concepts definitions important facts formulas summary", top_k=10
    )
    context = "\n\n".join(r["parent_text"] for r in retrieved) if retrieved else "Document content preview."

    prompt = (
        f"Based on the following document context, generate exactly {body.num_questions} interactive multiple-choice quiz questions.\n"
        f"Format your response as a valid JSON array of objects with keys:\n"
        f'- "question": string\n'
        f'- "options": array of 4 strings\n'
        f'- "correct_index": integer (0, 1, 2, or 3)\n'
        f'- "explanation": string explaining why the answer is correct\n\n'
        f"DOCUMENT CONTEXT:\n{context}\n\n"
        f"Return ONLY valid JSON without markdown quotes."
    )

    messages = [
        {"role": "system", "content": "You are an expert quiz generator. Return only raw JSON arrays."},
        {"role": "user", "content": prompt},
    ]

    try:
        raw_json = await router_llm.generate_complete(
            messages,
            gemini_key=keys["gemini"],
            groq_key=keys["groq"],
            openrouter_key=keys["openrouter"],
            gemini_model=settings.gemini_model,
            groq_model=settings.groq_model,
            openrouter_model=settings.openrouter_model,
        )

        clean_str = re.sub(r"^```(?:json)?", "", raw_json.strip(), flags=re.IGNORECASE)
        clean_str = re.sub(r"```$", "", clean_str.strip()).strip()
        try:
            quiz_data = json.loads(clean_str)
        except json.JSONDecodeError:
            array_match = re.search(r"\[[\s\S]*\]", clean_str)
            if array_match:
                quiz_data = json.loads(array_match.group(0))
            else:
                raise
        return {"session_id": session_id, "quiz": quiz_data}
    except Exception as exc:
        logger.exception("Quiz generation error: %s", exc)
        raise HTTPException(status_code=500, detail=f"Failed to generate quiz: {exc}")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True, app_dir=backend_dir)
