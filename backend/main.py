"""
FastAPI Application — DocMind Document Summarizer & Global Memory System
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

import aiofiles
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, Query, BackgroundTasks, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
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

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(name)s: %(message)s")
logger = logging.getLogger("docmind")

settings = get_settings()

parser: Optional[DocumentParser] = None
chunker: Optional[HierarchicalSemanticChunker] = None
retriever: Optional[HybridRetriever] = None
store: Optional[SessionStore] = None
router_llm: Optional[LLMRouter] = None


@asynccontextmanager
async def lifespan(app: FastAPI):
    global parser, chunker, retriever, store, router_llm

    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.index_dir, exist_ok=True)

    logger.info("Initializing DocMind production backend components...")
    store = SessionStore(db_path=settings.database_path)
    store.initialize()

    parser = DocumentParser()
    chunker = HierarchicalSemanticChunker(
        parent_chunk_size=settings.parent_chunk_size,
        child_chunk_size=settings.child_chunk_size,
        semantic_threshold=settings.semantic_threshold,
    )
    retriever = HybridRetriever(
        index_dir=settings.index_dir,
        top_k=settings.retrieval_top_k,
        candidates_k=settings.retrieval_candidates,
        max_cached_sessions=settings.max_cached_sessions,
    )
    retriever.register_on_model_ready(chunker.set_embed_model)
    router_llm = LLMRouter()
    logger.info("All DocMind backend components ready ✓")
    try:
        yield
    finally:
        logger.info("DocMind backend shutting down gracefully...")


limiter = Limiter(key_func=get_remote_address, default_limits=["120/minute"])
app = FastAPI(title="DocMind Document Intelligence API", version="2.0.0", lifespan=lifespan)
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


def _api_keys(request: Request) -> dict:
    return {
        "gemini": request.headers.get("X-Gemini-Key") or settings.gemini_api_key,
        "groq": request.headers.get("X-Groq-Key") or settings.groq_api_key,
        "openrouter": request.headers.get("X-OpenRouter-Key") or settings.openrouter_api_key,
    }


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
        "version": "2.0.0",
        "neural_models_ready": retriever.is_neural_ready if retriever else False,
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
@app.get("/api/stats")
async def get_system_stats():
    """Retrieve global platform statistics."""
    stats = store.get_stats()
    stats["neural_models_ready"] = retriever.is_neural_ready if retriever else False
    stats["status"] = "healthy"
    return stats


# ──────────────────────────────────────────────
# Session Management Endpoints
# ──────────────────────────────────────────────

@app.post("/api/sessions")
async def create_session(body: SessionCreate):
    title = body.title or "New Conversation"
    session_id = store.create_session(title=title)
    return {"session_id": session_id, "title": title}


@app.get("/api/sessions")
async def list_sessions():
    return store.list_sessions()


@app.delete("/api/sessions")
async def delete_all_sessions():
    """Clear all sessions, documents, and indexes."""
    sessions = store.list_sessions()
    for session in sessions:
        for doc in session.get("documents", []):
            if doc.get("file_path") and os.path.exists(doc["file_path"]):
                try:
                    os.remove(doc["file_path"])
                except OSError:
                    pass
        retriever.delete_session_index(session["id"])
    store.delete_all_sessions()
    return {"status": "all_deleted"}


@app.get("/api/sessions/{session_id}")
async def get_session(session_id: str):
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.patch("/api/sessions/{session_id}/title")
async def update_session_title(session_id: str, body: SessionTitleUpdate):
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    new_title = body.title.strip()
    if not new_title:
        raise HTTPException(status_code=400, detail="Title cannot be empty")
    store.update_session_title(session_id, new_title)
    return {"session_id": session_id, "title": new_title}


@app.delete("/api/sessions/{session_id}")
async def delete_session(session_id: str):
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    # Clean up document files & index
    for doc in session.get("documents", []):
        if doc.get("file_path") and os.path.exists(doc["file_path"]):
            try:
                os.remove(doc["file_path"])
            except OSError:
                pass
    retriever.delete_session_index(session_id)
    store.delete_session(session_id)
    return {"status": "deleted"}


@app.get("/api/sessions/{session_id}/messages")
async def get_messages(session_id: str):
    return store.get_messages(session_id)


# ──────────────────────────────────────────────
# Global Cross-Session Memory Management
# ──────────────────────────────────────────────

@app.get("/api/memory")
async def list_global_memories():
    """List all global cross-session memories."""
    return store.get_all_global_memories()


@app.delete("/api/memory/{memory_id}")
async def delete_memory_item(memory_id: str):
    """Delete a specific global memory item."""
    store.delete_global_memory(memory_id)
    return {"status": "deleted", "memory_id": memory_id}


@app.delete("/api/memory")
async def clear_all_memories():
    """Clear all global cross-session memories."""
    store.clear_all_global_memory()
    return {"status": "all_cleared"}


# ──────────────────────────────────────────────
# Session-Scoped Document Upload & Management
# ──────────────────────────────────────────────

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".txt", ".md", ".html", ".htm", ".csv", ".xlsx"}


@app.post("/api/sessions/{session_id}/documents")
async def upload_document_to_session(
    session_id: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...)
):
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    raw_filename = os.path.basename(file.filename or "document.txt")
    ext = os.path.splitext(raw_filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Sanitize filename against path traversal
    clean_filename = re.sub(r"[^\w.\-]", "_", raw_filename)
    if not clean_filename or clean_filename.startswith("."):
        clean_filename = f"upload_{clean_filename}"

    content = await file.read()
    if len(content) > settings.max_file_size_bytes:
        max_mb = settings.max_file_size_bytes / (1024 * 1024)
        raise HTTPException(
            status_code=413,
            detail=f"File size exceeds maximum allowed limit of {max_mb:.0f} MB.",
        )

    doc_id = str(uuid.uuid4())
    safe_name = f"{session_id}_{doc_id}_{clean_filename}"
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
        store.update_session_title(session_id, clean_title[:60])

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
            logger.info("Background processing complete for '%s' ✓ (%d chunks indexed)", f_name, len(chunks))
        except asyncio.TimeoutError:
            logger.error("Processing timed out for document '%s'", f_name)
            store.update_document_processed(
                doc_id=d_id,
                chunk_count=0,
                char_count=0,
                word_count=0,
                status="error",
            )
        except Exception as exc:
            logger.exception("Background processing failed for '%s': %s", f_name, exc)
            store.update_document_processed(
                doc_id=d_id,
                chunk_count=0,
                char_count=0,
                word_count=0,
                status="error",
            )

    background_tasks.add_task(_process_document_background, doc_id, session_id, file_path, clean_filename)

    return {
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
async def list_session_documents(session_id: str):
    return store.list_session_documents(session_id)


@app.delete("/api/documents/{doc_id}")
async def delete_document(doc_id: str):
    doc = store.get_document(doc_id)
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    session_id = doc["session_id"]
    store.delete_document(doc_id)
    retriever.remove_document_from_session(session_id, doc_id)
    if doc.get("file_path") and os.path.exists(doc["file_path"]):
        try:
            os.remove(doc["file_path"])
        except OSError:
            pass
    return {"status": "deleted", "session_id": session_id}


# ──────────────────────────────────────────────
# Chat & Global Cross-Session Memory Streaming
# ──────────────────────────────────────────────

SYSTEM_PROMPT_TEMPLATE = """You are DocMind, a strict document-grounded intelligence assistant.

## PRIMARY RULE — Document-First Answering
You MUST answer EXCLUSIVELY from the information contained in the CURRENT CHAT DOCUMENT CONTEXT and CROSS-SESSION GLOBAL MEMORY provided below.
Do NOT use your pre-trained knowledge or training data to answer questions about the document content.

## STRICT RESPONSE PROTOCOL
Follow this exact decision flow for every user question:

### STEP 1 — Search the Documents
Look carefully through the CURRENT CHAT DOCUMENT CONTEXT for information that directly answers the query.
Also check the CROSS-SESSION GLOBAL MEMORY for relevant past context.

### STEP 2A — If the answer IS found in the documents:
- Answer directly and precisely, quoting or paraphrasing only from the document content.
- Cite the source section where the information was found (e.g., "According to [Document Name / Section]...").
- Do NOT add extra information from your training data.

### STEP 2B — If the answer is NOT found in the documents:
You MUST begin your response with this exact disclosure block:

---
⚠️ **This information is not present in the provided document(s).**
The following answer is based on my general internet knowledge and training data — not from your uploaded files.

---

Then provide the best general answer you can from your knowledge.

## ADDITIONAL RULES
- Never silently blend document content with pre-trained knowledge without the disclosure.
- If the query is partially answered by the document, answer the documented part first (citing it), then use the disclosure block for the remainder.
- If no documents are uploaded, always use the disclosure block before any answer.
- Use clean, well-structured Markdown with headings, bullet points, and code formatting where relevant.
- For mathematical expressions and formulas, use standard LaTeX syntax:
  * Inline formulas: `$variable$` (e.g. `$w_t$`, `$\eta$`, `$g_t$`, `$v_{{t+1}}$`), always with NO space immediately following the opening `$` or preceding the closing `$`.
  * Standalone display equations: Put `$$` on its own separate line before and after the formula.
  * Never wrap Markdown headings (e.g. `###`, `####`), bold labels, or tables inside dollar signs.

============================================================
CURRENT CHAT DOCUMENT CONTEXT:
{doc_context}
============================================================

CROSS-SESSION GLOBAL MEMORY (Context from past conversations):
{memory_context}
============================================================
"""


@app.post("/api/chat")
@limiter.limit(settings.rate_limit_chat)
async def chat(request: Request, body: ChatRequest):
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(
            status_code=400,
            detail="No API keys found. Please add at least one key (Gemini, Groq, or OpenRouter) in Settings.",
        )

    session = store.get_session(body.session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    query = body.message.strip()
    if not query:
        raise HTTPException(status_code=400, detail="Message cannot be empty")

    # 1. Retrieve session document chunks
    retrieved_chunks = await asyncio.to_thread(retriever.retrieve, body.session_id, query)

    # 2. Retrieve global cross-session memory
    all_other_memories = store.get_all_global_memories(exclude_session_id=body.session_id)
    recalled_memories = await asyncio.to_thread(
        retriever.retrieve_global_memory, query, all_other_memories, top_k=3
    )

    # Build Document Context
    if retrieved_chunks:
        doc_parts = []
        for i, r in enumerate(retrieved_chunks, 1):
            doc_name = r["metadata"].get("title") or r["metadata"].get("source") or "Document"
            section = r["metadata"].get("section", "Section")
            doc_parts.append(f"[Source {i} | Doc: {doc_name} | {section}]\n{r['parent_text']}")
        doc_context = "\n\n".join(doc_parts)
    else:
        doc_context = "(No documents attached to this chat session yet. Relying on user input and global cross-session memory.)"

    # Build Global Memory Context
    if recalled_memories:
        mem_parts = []
        for m in recalled_memories:
            mem_parts.append(f"- [From Previous Chat: \"{m['session_title']}\"]: {m['content']}")
        memory_context = "\n".join(mem_parts)
    else:
        memory_context = "(No relevant past cross-session memory found for this query.)"

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

    # Save user message & memory
    store.save_message(body.session_id, "user", query)
    store.save_global_memory(body.session_id, session["title"], "user", query)

    # If first message, auto-update title
    if len(history) == 0 and session["title"] in ("New Conversation", "New Chat"):
        new_title = query[:40] + ("…" if len(query) > 40 else "")
        store.update_session_title(body.session_id, new_title)

    # ── Streaming Generator ──
    async def generate():
        full_response = ""
        sources_payload = [
            {
                "child_text": r["child_text"],
                "section": r["metadata"].get("section", "Document"),
                "doc_id": r["metadata"].get("doc_id"),
                "title": r["metadata"].get("title") or r["metadata"].get("source") or "Document",
                "page_number": r["metadata"].get("page_number"),
                "rerank_score": r["rerank_score"],
                "bm25_score": r["bm25_score"],
                "dense_score": r["dense_score"],
            }
            for r in retrieved_chunks
        ]
        memory_payload = recalled_memories

        # Immediately send recalled memory & sources metadata to frontend
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
@limiter.limit(settings.rate_limit_summarize)
async def summarize_session(session_id: str, request: Request):
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(status_code=400, detail="No API keys configured.")

    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

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
                "You are DocMind. Generate a comprehensive, executive-level summary of the attached document(s). "
                "Structure your response with:\n"
                "1. Executive Overview\n"
                "2. Core Concepts & Findings\n"
                "3. Key Takeaways & Actionable Insights\n"
                "Use clean Markdown with bold highlights and bullet points.\n\n"
                f"DOCUMENTS CONTENT:\n{context}"
            ),
        },
        {"role": "user", "content": "Please generate a complete and structured executive summary of this chat's documents."},
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
    body: UrlIngestRequest,
    background_tasks: BackgroundTasks
):
    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    url = body.url.strip()
    doc_id = str(uuid.uuid4())
    domain_name = url.split("//")[-1].split("/")[0]
    clean_filename = f"URL_{domain_name}_{doc_id[:6]}"

    # Fetch and parse URL text synchronously/async
    try:
        url_text, metadata = parser.parse_url(url)
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Failed to ingest URL: {exc}")

    # Save to database immediately
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

    # Background async chunking & indexing
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
            logger.info("URL processing complete for '%s' ✓ (%d chunks indexed)", url, len(chunks))
        except Exception as exc:
            logger.exception("URL background processing failed for '%s': %s", url, exc)
            store.update_document_processed(
                doc_id=d_id, chunk_count=0, char_count=0, word_count=0, status="error"
            )

    background_tasks.add_task(_process_url_background, doc_id, session_id, url_text, metadata)

    return {
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
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(status_code=400, detail="No API keys configured.")

    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

    docs = session.get("documents", [])
    if not docs:
        raise HTTPException(status_code=400, detail="No documents uploaded in this chat session to compare.")

    selected_docs = [d for d in docs if not body.doc_ids or d["doc_id"] in body.doc_ids]
    if len(selected_docs) < 2:
        raise HTTPException(
            status_code=400,
            detail="At least 2 documents are required for comparison. Please upload another file.",
        )

    # Retrieve context chunks for each document
    doc_contexts = []
    for d in selected_docs[:4]:  # Max 4 docs for comparison matrix
        chunks = await asyncio.to_thread(
            retriever.retrieve, session_id, f"overview key points {body.focus_topic}", top_k=5
        )
        # Filter chunks for this doc if doc_id matches
        doc_chunks = [c for c in chunks if c.get("metadata", {}).get("doc_id") == d["doc_id"]]
        if not doc_chunks:
            doc_chunks = chunks[:3]
        text_summary = "\n".join([c["child_text"] for c in doc_chunks])
        doc_contexts.append(f"### DOCUMENT: {d['filename']}\n{text_summary}")

    comparison_prompt = (
        f"You are DocMind. Generate a comprehensive Side-by-Side Comparison Matrix analyzing these documents.\n"
        f"Focus Area: {body.focus_topic}\n\n"
        f"DOCUMENT CONTENTS:\n" + "\n\n".join(doc_contexts) + "\n\n"
        f"Provide your output in Markdown with:\n"
        f"1. Executive Comparative Summary\n"
        f"2. Side-by-Side Feature / Content Comparison Table\n"
        f"3. Key Similarities & Differences\n"
        f"4. Strategic Takeaway & Recommendations"
    )

    messages = [
        {"role": "system", "content": "You are a professional document intelligence analyst."},
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
    keys = _api_keys(request)
    if not any(keys.values()):
        raise HTTPException(status_code=400, detail="No API keys configured.")

    session = store.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")

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

        # Clean JSON markdown fences and extract array
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
