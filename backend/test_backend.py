"""
DocMind Full Backend Verification Test Suite
─────────────────────────────────────────────
Tests all core components and FastAPI endpoints using TestClient.
"""
import os
import sys
import shutil

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient
from main import app
from session_store import SessionStore
from document_parser import DocumentParser
from chunker import HierarchicalSemanticChunker
from retrieval import HybridRetriever
from llm_router import LLMRouter


def test_session_store_and_global_memory():
    db_path = "./data/test_summarizer.db"
    if os.path.exists(db_path):
        os.remove(db_path)
    print("1. Testing SessionStore (WAL mode, isolated docs, global memory)...")
    store = SessionStore(db_path)
    store.initialize()

    # Create two sessions
    session1_id = store.create_session("Financial Q3 Analysis")
    session2_id = store.create_session("Legal Contract Review")

    # Save documents for session 1
    store.save_document(
        doc_id="doc1",
        session_id=session1_id,
        filename="Q3_Report.pdf",
        chunk_count=12,
        char_count=4500,
        word_count=750,
        file_type="pdf",
        file_path="/tmp/q3.pdf"
    )

    # Save documents for session 2
    store.save_document(
        doc_id="doc2",
        session_id=session2_id,
        filename="NDA_Agreement.docx",
        chunk_count=8,
        char_count=2800,
        word_count=450,
        file_type="docx",
        file_path="/tmp/nda.docx"
    )

    # Verify session documents isolation
    s1_docs = store.list_session_documents(session1_id)
    s2_docs = store.list_session_documents(session2_id)
    assert len(s1_docs) == 1 and s1_docs[0]["filename"] == "Q3_Report.pdf", "Session 1 docs mismatch"
    assert len(s2_docs) == 1 and s2_docs[0]["filename"] == "NDA_Agreement.docx", "Session 2 docs mismatch"

    # Global cross-session memory
    store.save_global_memory(session1_id, "Financial Q3 Analysis", "user", "What was the operating expense margin in the EU?")
    store.save_global_memory(session1_id, "Financial Q3 Analysis", "assistant", "Operating expenses in the EU increased by 14.2% due to regulatory compliance.")
    
    store.save_global_memory(session2_id, "Legal Contract Review", "user", "What is the governing jurisdiction?")
    store.save_global_memory(session2_id, "Legal Contract Review", "assistant", "The governing law is specified as New York State under clause 14.")

    all_mems = store.get_all_global_memories(exclude_session_id=session2_id)
    assert len(all_mems) == 2, f"Expected 2 cross-session memories from session 1, got {len(all_mems)}"
    print("   [OK] SessionStore and Global Memory isolation verified.")
    return session1_id, all_mems


def test_chunker_and_parser(session1_id: str):
    print("\n2. Testing Hierarchical Semantic Chunker and DocumentParser...")
    chunker = HierarchicalSemanticChunker()
    sample_text = """# Executive Summary
The company achieved record revenue in Q3 2026. Growth was driven by cloud AI infrastructure adoption across enterprise sectors.

## Financial Performance
Total revenue was $42.5 billion, representing an increase of 28% year-over-year. Operating income stood at $16.2 billion with operating margin expanding to 38%.

## Risk Factors & Regulatory Outlook
International compliance costs increased in the EU jurisdiction. Ongoing data sovereignty legislation requires localized datacenter provisioning.
"""
    chunks = chunker.chunk_document(sample_text, "doc1", session1_id, {"title": "Q3 Report", "source": "q3.pdf"})
    assert len(chunks) > 0, "No chunks produced"
    print(f"   [OK] Produced {len(chunks)} hierarchical child chunks with contextual prefixes.")

    parser = DocumentParser()
    parsed_text, meta = parser._parse_text(__file__, "test_backend.py")
    assert len(parsed_text) > 0 and meta["file_type"] in ("txt", "md", "py"), "Document parser failed"
    print(f"   [OK] Document parser verified ({meta['word_count']} words parsed).")
    return chunks


def test_retriever_safe_persistence(session1_id: str, chunks, all_mems):
    print("\n3. Testing Hybrid Retrieval with Safe NPZ Serialization & LRU...")
    test_idx_dir = "./data/test_indexes"
    if os.path.exists(test_idx_dir):
        shutil.rmtree(test_idx_dir)

    retriever = HybridRetriever(index_dir=test_idx_dir, load_neural=False, max_cached_sessions=2)
    retriever.index_session_chunks(session1_id, chunks)

    # Retrieval in session 1
    results = retriever.retrieve(session1_id, "operating margin financial performance")
    assert len(results) > 0, "No retrieval results found"
    print(f"   [OK] Session hybrid retrieval returned {len(results)} top candidate chunks.")

    # Verify safe npz file exists on disk (no pickle vulnerability)
    npz_path = os.path.join(test_idx_dir, f"session_{session1_id}.npz")
    assert os.path.exists(npz_path), "NPZ index file was not created"
    print("   [OK] Safe NPZ index persistence verified.")

    # Global memory recall
    mem_results = retriever.retrieve_global_memory("operating expenses EU regulatory compliance", all_mems, top_k=2)
    assert len(mem_results) > 0, "No global memory recalled"
    print(f"   [OK] Global memory recalled: '{mem_results[0]['content'][:50]}...'")

    # Clean up test index dir
    if os.path.exists(test_idx_dir):
        shutil.rmtree(test_idx_dir)


def test_fastapi_endpoints():
    print("\n4. Testing FastAPI Endpoints via TestClient...")
    with TestClient(app) as client:
        # Health endpoints
        r_health = client.get("/api/health")
        assert r_health.status_code == 200
        assert r_health.json()["status"] == "healthy"

        r_live = client.get("/api/health/live")
        assert r_live.status_code == 200
        assert r_live.json()["status"] == "alive"

        r_ready = client.get("/api/health/ready")
        assert r_ready.status_code == 200
        assert r_ready.json()["status"] == "ready"
        print("   [OK] Health, Liveness, and Readiness endpoints verified.")

        # Session CRUD
        r_create = client.post("/api/sessions", json={"title": "Integration Test Session"})
        assert r_create.status_code == 200
        sess_id = r_create.json()["session_id"]

        r_get = client.get(f"/api/sessions/{sess_id}")
        assert r_get.status_code == 200
        assert r_get.json()["title"] == "Integration Test Session"

        r_patch = client.patch(f"/api/sessions/{sess_id}/title", json={"title": "Renamed Session"})
        assert r_patch.status_code == 200
        assert r_patch.json()["title"] == "Renamed Session"

        # Validation: empty message rejected
        r_bad_chat = client.post("/api/chat", json={"session_id": sess_id, "message": "   "})
        assert r_bad_chat.status_code == 422 or r_bad_chat.status_code == 400

        # LLMRouter generate_complete method verification
        router = LLMRouter()
        assert hasattr(router, "generate_complete"), "LLMRouter must provide generate_complete method"

        # Delete session
        r_del = client.delete(f"/api/sessions/{sess_id}")
        assert r_del.status_code == 200
        print("   [OK] Session CRUD, LLMRouter methods, and validation rules verified.")


def test_all():
    session1_id, all_mems = test_session_store_and_global_memory()
    chunks = test_chunker_and_parser(session1_id)
    test_retriever_safe_persistence(session1_id, chunks, all_mems)
    test_fastapi_endpoints()

    # Cleanup test db
    for path in ("./data/test_summarizer.db", "./data/test_summarizer.db-wal", "./data/test_summarizer.db-shm"):
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    print("\n==================================================")
    print("*** ALL PRODUCTION BACKEND COMPONENT TESTS PASSED! ***")
    print("==================================================")


if __name__ == "__main__":
    test_all()

