"""
Hybrid Retrieval Pipeline & Global Cross-Session Memory
───────────────────────────────────────────────────────
Stage 1: BM25 (keyword matching) + Dense Embeddings (semantic matching) in parallel
Stage 2: Reciprocal Rank Fusion (RRF) rank-based score combination
Stage 3: Cross-Encoder Reranker for top precision scoring
Stage 4: Parent expansion for complete contextual injection

Also includes:
  • Session-scoped document indexing (documents belong to specific chat sessions)
  • Global Cross-Session Memory indexing & retrieval (recovering relevant past conversation insights across chats)
"""

import os
import pickle
import logging
import math
from collections import Counter
from typing import List, Dict, Optional, Tuple, Any

import numpy as np

from chunker import Chunk, FastSubwordVectorizer

logger = logging.getLogger(__name__)

# Graceful import of rank_bm25
_HAVE_BM25 = False
try:
    from rank_bm25 import BM25Okapi
    _HAVE_BM25 = True
except ImportError:
    logger.warning("rank_bm25 not installed. Using built-in BM25 implementation.")


class SimpleBM25:
    """Lightweight pure-python BM25Okapi implementation."""
    def __init__(self, corpus: List[List[str]], k1: float = 1.5, b: float = 0.75):
        self.k1 = k1
        self.b = b
        self.corpus_size = len(corpus)
        self.doc_lens = [len(doc) for doc in corpus]
        self.avgdl = sum(self.doc_lens) / max(1, self.corpus_size)
        self.doc_freqs: List[Dict[str, int]] = []
        self.idf: Dict[str, float] = {}
        self._init_idf(corpus)

    def _init_idf(self, corpus: List[List[str]]):
        df = Counter()
        for doc in corpus:
            freq = Counter(doc)
            self.doc_freqs.append(freq)
            for word in freq:
                df[word] += 1
        for word, count in df.items():
            idf = math.log((self.corpus_size - count + 0.5) / (count + 0.5) + 1.0)
            self.idf[word] = max(1e-6, idf)

    def get_scores(self, query: List[str]) -> np.ndarray:
        scores = np.zeros(self.corpus_size, dtype=np.float32)
        for q in query:
            if q not in self.idf:
                continue
            q_idf = self.idf[q]
            for i, freq_map in enumerate(self.doc_freqs):
                tf = freq_map.get(q, 0)
                if tf > 0:
                    num = tf * (self.k1 + 1)
                    denom = tf + self.k1 * (1 - self.b + self.b * (self.doc_lens[i] / max(1, self.avgdl)))
                    scores[i] += q_idf * (num / denom)
        return scores


# Graceful import of SentenceTransformer & CrossEncoder
_HAVE_SENTENCE_TRANSFORMERS = False
try:
    from sentence_transformers import SentenceTransformer, CrossEncoder
    _HAVE_SENTENCE_TRANSFORMERS = True
except ImportError:
    logger.warning("sentence-transformers not installed. Using subword embeddings and hybrid reranker.")

import threading

_BI_ENCODER_MODEL = "all-MiniLM-L6-v2"
_CROSS_ENCODER_MODEL = "cross-encoder/ms-marco-MiniLM-L-6-v2"


class HybridRetriever:
    def __init__(
        self,
        index_dir: str = "./data/indexes",
        top_k: int = 5,
        candidates_k: int = 50,
        load_neural: bool = True,
    ):
        self.index_dir = index_dir
        self.top_k = top_k
        self.candidates_k = candidates_k
        os.makedirs(index_dir, exist_ok=True)

        self._bi_encoder = None
        self._cross_encoder = None
        self._fallback_vectorizer = FastSubwordVectorizer()
        self._on_model_ready_callbacks = []

        # In-memory indexes keyed by session_id
        self._session_bm25: Dict[str, Any] = {}
        self._session_embeddings: Dict[str, np.ndarray] = {}
        self._session_chunks: Dict[str, List[Chunk]] = {}

        if _HAVE_SENTENCE_TRANSFORMERS and load_neural:
            # Load neural models asynchronously so server startup is instantaneous
            threading.Thread(target=self._async_load_neural_models, daemon=True).start()

    def register_on_model_ready(self, callback):
        """Register a callback to be called when neural models are loaded."""
        if self._bi_encoder is not None:
            callback(self._bi_encoder)
        else:
            self._on_model_ready_callbacks.append(callback)

    @property
    def is_neural_ready(self) -> bool:
        return self._bi_encoder is not None

    def _async_load_neural_models(self):
        try:
            os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
            os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
            logger.info("Initializing neural models in background (%s)...", _BI_ENCODER_MODEL)
            bi = SentenceTransformer(_BI_ENCODER_MODEL)
            self._bi_encoder = bi
            logger.info("Bi-encoder loaded successfully ✓")
            
            for cb in self._on_model_ready_callbacks:
                try:
                    cb(bi)
                except Exception:
                    pass

            logger.info("Initializing cross-encoder in background (%s)...", _CROSS_ENCODER_MODEL)
            ce = CrossEncoder(_CROSS_ENCODER_MODEL)
            self._cross_encoder = ce
            logger.info("Cross-encoder loaded successfully ✓")
        except Exception as exc:
            logger.warning("Neural transformer background load notice: %s. Continuing with fast subword embeddings.", exc)

    # ──────────────────────────────────────────────────────────────────────
    # Document Indexing (Session Scoped)
    # ──────────────────────────────────────────────────────────────────────

    def index_session_chunks(self, session_id: str, new_chunks: List[Chunk]) -> None:
        """Add chunks to a session's index (rebuilding session index)."""
        if not new_chunks:
            return

        # Check if session already has chunks, append if so
        existing_chunks = self.get_session_chunks(session_id)
        # Deduplicate chunks by ID
        existing_ids = {c.id for c in existing_chunks}
        combined_chunks = existing_chunks + [c for c in new_chunks if c.id not in existing_ids]

        # BM25 indexing
        tokenized = [c.contextual_text.lower().split() for c in combined_chunks]
        if _HAVE_BM25:
            bm25 = BM25Okapi(tokenized)
        else:
            bm25 = SimpleBM25(tokenized)

        # Dense embedding indexing
        texts = [c.contextual_text for c in combined_chunks]
        if self._bi_encoder is not None:
            embeddings = self._bi_encoder.encode(
                texts, batch_size=64, show_progress_bar=False, normalize_embeddings=True
            ).astype(np.float32)
        else:
            embeddings = self._fallback_vectorizer.encode(texts).astype(np.float32)

        # Cache in memory
        self._session_bm25[session_id] = bm25
        self._session_embeddings[session_id] = embeddings
        self._session_chunks[session_id] = combined_chunks

        # Persist
        self._save_session_index(session_id, bm25, embeddings, combined_chunks)
        logger.info("Session %s indexed (%d total chunks across all session docs)", session_id, len(combined_chunks))

    def remove_document_from_session(self, session_id: str, doc_id: str) -> None:
        """Remove a single document's chunks from a session index."""
        existing = self.get_session_chunks(session_id)
        remaining = [c for c in existing if c.doc_id != doc_id]
        if remaining:
            self.index_session_chunks(session_id, remaining)
        else:
            self.delete_session_index(session_id)

    def delete_session_index(self, session_id: str) -> None:
        self._session_bm25.pop(session_id, None)
        self._session_embeddings.pop(session_id, None)
        self._session_chunks.pop(session_id, None)
        path = os.path.join(self.index_dir, f"session_{session_id}.pkl")
        if os.path.exists(path):
            try:
                os.remove(path)
            except OSError:
                pass

    def get_session_chunks(self, session_id: str) -> List[Chunk]:
        if session_id in self._session_chunks:
            return self._session_chunks[session_id]
        try:
            self._load_session_index(session_id)
            return self._session_chunks.get(session_id, [])
        except Exception:
            return []

    # ──────────────────────────────────────────────────────────────────────
    # Session Document Retrieval
    # ──────────────────────────────────────────────────────────────────────

    def retrieve(
        self,
        session_id: str,
        query: str,
        top_k: Optional[int] = None,
        candidates_k: Optional[int] = None,
    ) -> List[Dict[str, Any]]:
        """
        Hybrid retrieval (BM25 + Semantic Search + RRF + Cross-Encoder) for a session's documents.
        """
        top_k = top_k or self.top_k
        candidates_k = candidates_k or self.candidates_k

        if session_id not in self._session_chunks:
            try:
                self._load_session_index(session_id)
            except Exception:
                return []

        chunks = self._session_chunks.get(session_id, [])
        n = len(chunks)
        if n == 0:
            return []

        # ── Stage 1a: BM25 (Keyword) ──
        tokenized_query = query.lower().split()
        bm25_model = self._session_bm25[session_id]
        bm25_scores = bm25_model.get_scores(tokenized_query)
        bm25_ranks = np.argsort(bm25_scores)[::-1]

        # ── Stage 1b: Dense (Semantic) ──
        if self._bi_encoder is not None:
            query_emb = self._bi_encoder.encode([query], normalize_embeddings=True)[0].astype(np.float32)
        else:
            query_emb = self._fallback_vectorizer.encode([query])[0].astype(np.float32)

        doc_embs = self._session_embeddings[session_id]
        if doc_embs.shape[1] == query_emb.shape[0]:
            dense_scores = doc_embs @ query_emb
        else:
            dense_scores = np.zeros(n, dtype=np.float32)
        dense_ranks = np.argsort(dense_scores)[::-1]

        # ── Stage 2: Reciprocal Rank Fusion (RRF) ──
        RRF_K = 60
        rrf_scores = np.zeros(n, dtype=np.float64)
        for rank, idx in enumerate(bm25_ranks):
            rrf_scores[idx] += 1.0 / (RRF_K + rank + 1)
        for rank, idx in enumerate(dense_ranks):
            rrf_scores[idx] += 1.0 / (RRF_K + rank + 1)

        actual_candidates = min(candidates_k, n)
        candidate_idxs = np.argsort(rrf_scores)[::-1][:actual_candidates]

        # ── Stage 3: Cross-Encoder Reranking ──
        if self._cross_encoder is not None and len(candidate_idxs) > 0:
            candidate_pairs = [(query, chunks[i].text) for i in candidate_idxs]
            rerank_scores = self._cross_encoder.predict(candidate_pairs, show_progress_bar=False)
        else:
            # Fallback normalized lexical + dense fusion score
            rerank_scores = np.array([
                0.5 * (dense_scores[i] + 1.0) / 2.0 + 0.5 * (bm25_scores[i] / (np.max(bm25_scores) + 1e-6))
                for i in candidate_idxs
            ])

        ranked = sorted(
            zip(candidate_idxs, rerank_scores),
            key=lambda x: x[1],
            reverse=True,
        )

        # ── Stage 4: Parent Expansion & Deduplication ──
        results: List[Dict[str, Any]] = []
        seen_parent_ids = set()

        for idx, ce_score in ranked:
            if len(results) >= top_k:
                break
            chunk = chunks[idx]
            if chunk.parent_id in seen_parent_ids:
                continue
            seen_parent_ids.add(chunk.parent_id)

            results.append({
                "chunk_id": chunk.id,
                "doc_id": chunk.doc_id,
                "child_text": chunk.text,
                "parent_text": chunk.parent_text,
                "rerank_score": float(ce_score),
                "bm25_score": float(bm25_scores[idx]),
                "dense_score": float(dense_scores[idx]),
                "rrf_score": float(rrf_scores[idx]),
                "metadata": chunk.metadata,
            })

        return results

    # ──────────────────────────────────────────────────────────────────────
    # Global Cross-Session Memory Retrieval
    # ──────────────────────────────────────────────────────────────────────

    def retrieve_global_memory(
        self,
        query: str,
        memories: List[Dict[str, Any]],
        top_k: int = 3,
    ) -> List[Dict[str, Any]]:
        """
        Search across all memories from past sessions to find relevant historical conversations & facts.
        """
        if not memories:
            return []

        # Tokenized BM25 over memories
        corpus = [m["content"].lower().split() for m in memories]
        if _HAVE_BM25:
            bm25 = BM25Okapi(corpus)
        else:
            bm25 = SimpleBM25(corpus)

        tokenized_q = query.lower().split()
        bm25_scores = bm25.get_scores(tokenized_q)

        # Semantic embeddings over memories
        texts = [m["content"] for m in memories]
        if self._bi_encoder is not None:
            mem_embs = self._bi_encoder.encode(texts, batch_size=32, normalize_embeddings=True, show_progress_bar=False)
            q_emb = self._bi_encoder.encode([query], normalize_embeddings=True)[0]
            dense_scores = mem_embs @ q_emb
        else:
            mem_embs = self._fallback_vectorizer.encode(texts)
            q_emb = self._fallback_vectorizer.encode([query])[0]
            if mem_embs.shape[1] == q_emb.shape[0]:
                dense_scores = mem_embs @ q_emb
            else:
                dense_scores = np.zeros(len(memories), dtype=np.float32)

        # Combine scores
        max_bm25 = float(np.max(bm25_scores)) if np.max(bm25_scores) > 0 else 1.0
        normalized_bm25 = bm25_scores / max_bm25
        combined = 0.5 * (dense_scores + 1.0) / 2.0 + 0.5 * normalized_bm25

        # Filter by minimum relevance threshold to avoid irrelevant memories
        ranked_indices = np.argsort(combined)[::-1]
        recalled = []
        for idx in ranked_indices:
            score = float(combined[idx])
            # Include top memories if they show positive relevance
            if score > 0.05 and len(recalled) < top_k:
                mem = memories[idx]
                recalled.append({
                    "session_id": mem["session_id"],
                    "session_title": mem.get("session_title", "Previous Chat"),
                    "role": mem.get("role", "user"),
                    "content": mem["content"],
                    "score": score,
                })

        return recalled

    # ──────────────────────────────────────────────────────────────────────
    # Persistence
    # ──────────────────────────────────────────────────────────────────────

    def _save_session_index(self, session_id: str, bm25: Any, embeddings: np.ndarray, chunks: List[Chunk]):
        path = os.path.join(self.index_dir, f"session_{session_id}.pkl")
        with open(path, "wb") as f:
            pickle.dump({"bm25": bm25, "embeddings": embeddings, "chunks": chunks}, f)

    def _load_session_index(self, session_id: str):
        path = os.path.join(self.index_dir, f"session_{session_id}.pkl")
        if not os.path.exists(path):
            return
        with open(path, "rb") as f:
            data = pickle.load(f)
        self._session_bm25[session_id] = data["bm25"]
        self._session_embeddings[session_id] = data["embeddings"]
        self._session_chunks[session_id] = data["chunks"]
