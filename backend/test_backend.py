"""
Backend Component Verification Test
"""
import os
import sys

# Add backend directory to sys.path
sys.path.insert(0, os.path.dirname(__file__))

from session_store import SessionStore
from document_parser import DocumentParser
from chunker import HierarchicalSemanticChunker
from retrieval import HybridRetriever
from llm_router import LLMRouter

def test_all():
    db_path = "./data/test_summarizer.db"
    if os.path.exists(db_path):
        os.remove(db_path)
    print("1. Testing SessionStore with session-scoped documents and global memory...")
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

    # Verify session documents are properly isolated
    s1_docs = store.list_session_documents(session1_id)
    s2_docs = store.list_session_documents(session2_id)
    assert len(s1_docs) == 1 and s1_docs[0]["filename"] == "Q3_Report.pdf", "Session 1 docs mismatch"
    assert len(s2_docs) == 1 and s2_docs[0]["filename"] == "NDA_Agreement.docx", "Session 2 docs mismatch"
    print("   [OK] Session-scoped document isolation verified.")

    # Test Global Cross-Session Memory
    store.save_global_memory(session1_id, "Financial Q3 Analysis", "user", "What was the operating expense margin in the EU?")
    store.save_global_memory(session1_id, "Financial Q3 Analysis", "assistant", "Operating expenses in the EU increased by 14.2% due to regulatory compliance.")
    
    store.save_global_memory(session2_id, "Legal Contract Review", "user", "What is the governing jurisdiction?")
    store.save_global_memory(session2_id, "Legal Contract Review", "assistant", "The governing law is specified as New York State under clause 14.")

    all_mems = store.get_all_global_memories(exclude_session_id=session2_id)
    assert len(all_mems) == 2, f"Expected 2 cross-session memories from session 1, got {len(all_mems)}"
    print("   [OK] Global cross-session memory storage and filtering verified.")

    print("\n2. Testing Hierarchical Semantic Chunker...")
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
    print(f"   Sample Contextual Prefix: {chunks[0].contextual_text[:80]}...")

    print("\n3. Testing DocumentParser...")
    parser = DocumentParser()
    parsed_text, meta = parser._parse_text("./data/test_summarizer.txt" if os.path.exists("./data/test_summarizer.txt") else "backend/test_backend.py", "test_backend.py")
    assert len(parsed_text) > 0 and meta["file_type"] in ("txt", "md", "py"), "Document parser failed"
    print(f"   [OK] Document parser verified ({meta['word_count']} words parsed).")

    print("\n4. Testing Hybrid Retrieval & Cross-Session Memory Recall...")
    retriever = HybridRetriever(index_dir="./data/test_indexes", load_neural=False)
    retriever.index_session_chunks(session1_id, chunks)

    # Retrieval in session 1
    results = retriever.retrieve(session1_id, "operating margin financial performance")
    assert len(results) > 0, "No retrieval results found"
    print(f"   [OK] Session hybrid retrieval returned {len(results)} top candidate chunks.")

    # Global cross-session memory recall when querying from session 2
    mem_results = retriever.retrieve_global_memory("operating expenses EU regulatory compliance", all_mems, top_k=2)
    assert len(mem_results) > 0, "No global memory recalled"
    print(f"   [OK] Global cross-session memory recalled: '{mem_results[0]['content'][:60]}...' from '{mem_results[0]['session_title']}'")

    print("\n5. Testing Multi-LLM Router setup...")
    router = LLMRouter()
    assert len(router._providers) == 3, "Expected 3 LLM providers (Gemini, Groq, OpenRouter)"
    print("   [OK] Multi-LLM fallback router configured (Gemini -> Groq -> OpenRouter).")

    # Cleanup test db
    try:
        os.remove("./data/test_summarizer.db")
    except OSError:
        pass

    print("\n*** ALL BACKEND COMPONENT TESTS PASSED! ***")

if __name__ == "__main__":
    test_all()
