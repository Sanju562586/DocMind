"""
FastAPI Application — DocMind Document Summarizer & Global Memory System
"""

import asyncio
import json
import logging
import os
import sys
import uuid
from contextlib import asynccontextmanager

# Ensure backend directory is in sys.path
backend_dir = os.path.dirname(os.path.abspath(__file__))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

import aiofiles
from fastapi import FastAPI, File, HTTPException, Request, UploadFile, Query, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from chunker import HierarchicalSemanticChunker
from config import get_settings
from document_parser import DocumentParser
from llm_router import LLMRouter
from models import ChatRequest, SessionCreate, SessionTitleUpdate
from retrieval import HybridRetriever
from session_store import SessionStore

logging.basicConfig(level=logging.INFO, format="%(levelname)s  %(name)s  %(message)s")
logger = logging.getLogger(__name__)

settings = get_settings()

parser: DocumentParser = None        # type: ignore[assignment]
chunker: HierarchicalSemanticChunker = None  # type: ignore[assignment]
retriever: HybridRetriever = None    # type: ignore[assignment]
store: SessionStore = None           # type: ignore[assignment]
router_llm: LLMRouter = None        # type: ignore[assignment]


@asynccontextmanager
async def lifespan(app: FastAPI):
    global parser, chunker, retriever, store, router_llm

    os.makedirs(settings.upload_dir, exist_ok=True)
    os.makedirs(settings.index_dir, exist_ok=True)

    logger.info("Initialising DocMind backend components …")
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
    )
    retriever.register_on_model_ready(chunker.set_embed_model)
    router_llm = LLMRouter()
    logger.info("All DocMind backend components ready ✓")
    yield


app = FastAPI(title="DocMind Document Intelligence API", version="2.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
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
# Health & Status Endpoint
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

    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{ext}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    doc_id = str(uuid.uuid4())
    safe_name = f"{session_id}_{doc_id}_{file.filename}"
    file_path = os.path.join(settings.upload_dir, safe_name)

    content = await file.read()
    async with aiofiles.open(file_path, "wb") as f:
        await f.write(content)

    file_type = ext.lstrip(".")
    # Save to database immediately with status="processing"
    store.save_document(
        doc_id=doc_id,
        session_id=session_id,
        filename=file.filename,
        chunk_count=0,
        char_count=0,
        word_count=0,
        file_type=file_type,
        file_path=file_path,
        status="processing",
    )

    # Automatically update session title if default
    if session["title"] in ("New Conversation", "New Chat") or len(session.get("documents", [])) == 0:
        clean_title = file.filename.rsplit(".", 1)[0].replace("_", " ").replace("-", " ")
        store.update_session_title(session_id, clean_title)

    # Background async processing: parse, chunk, index, update status
    async def _process_document_background(d_id: str, s_id: str, f_path: str, f_name: str):
        try:
            logger.info("Background processing started for '%s' (id: %s)", f_name, d_id)
            doc_text, metadata = await asyncio.to_thread(parser.parse, f_path, f_name)
            chunks = await asyncio.to_thread(
                chunker.chunk_document, doc_text, d_id, s_id, metadata
            )
            await asyncio.to_thread(retriever.index_session_chunks, s_id, chunks)

            w_count = metadata.get("word_count", len(doc_text.split()))
            store.update_document_processed(
                doc_id=d_id,
                chunk_count=len(chunks),
                char_count=len(doc_text),
                word_count=w_count,
                status="ready",
            )
            logger.info("Background processing complete for '%s' ✓ (%d chunks indexed)", f_name, len(chunks))
        except Exception as exc:
            logger.exception("Background processing failed for '%s': %s", f_name, exc)
            store.update_document_processed(
                doc_id=d_id,
                chunk_count=0,
                char_count=0,
                word_count=0,
                status="error",
            )

    background_tasks.add_task(_process_document_background, doc_id, session_id, file_path, file.filename)

    return {
        "doc_id": doc_id,
        "session_id": session_id,
        "filename": file.filename,
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
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ──────────────────────────────────────────────
# Session Document Summarization
# ──────────────────────────────────────────────

@app.post("/api/sessions/{session_id}/summarize")
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
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host=settings.host, port=settings.port, reload=True)
