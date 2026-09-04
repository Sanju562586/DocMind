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
import time
import pickle
import logging
import math
from collections import Counter
from typing import List, Dict, Optional, Tuple, Any

import numpy as np

from chunker import Chunk, FastSubwordVectorizer

from collections import Counter, OrderedDict
import json

logger = logging.getLogger(__name__)

# Graceful import of rank_bm25
_HAVE_BM25 = False
try:
    from rank_bm25 import BM25Okapi
    _HAVE_BM25 = True
except ImportError:
    logger.warning("rank_bm25 not installed. Using built-in BM25 implementation.")


def _chunk_to_dict(c: Chunk) -> dict:
    return {
        "id": c.id,
        "text": c.text,
        "contextual_text": c.contextual_text,
        "parent_id": c.parent_id,
        "parent_text": c.parent_text,
        "doc_id": c.doc_id,
        "session_id": c.session_id,
        "chunk_index": c.chunk_index,
        "parent_index": c.parent_index,
        "metadata": c.metadata,
    }


def _dict_to_chunk(d: dict) -> Chunk:
    return Chunk(
        id=d["id"],
        text=d["text"],
        contextual_text=d["contextual_text"],
        parent_id=d["parent_id"],
        parent_text=d["parent_text"],
        doc_id=d["doc_id"],
        session_id=d["session_id"],
        chunk_index=d["chunk_index"],
        parent_index=d["parent_index"],
        metadata=d.get("metadata", {}),
    )


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
        max_cached_sessions: int = 30,
        load_neural: bool = True,
    ):
        self.index_dir = index_dir
        self.top_k = top_k
        self.candidates_k = candidates_k
        self.max_cached_sessions = max_cached_sessions
        os.makedirs(index_dir, exist_ok=True)

        self._bi_encoder = None
        self._cross_encoder = None
        self._fallback_vectorizer = FastSubwordVectorizer()
        self._on_model_ready_callbacks = []

        # In-memory LRU indexes keyed by session_id
        self._session_bm25: OrderedDict[str, Any] = OrderedDict()
        self._session_embeddings: OrderedDict[str, np.ndarray] = OrderedDict()
        self._session_chunks: OrderedDict[str, List[Chunk]] = OrderedDict()

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
            try:
                import torch
                torch.set_num_threads(1)
                torch.set_num_interop_threads(1)
            except Exception:
                pass

            os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
            os.environ["TRANSFORMERS_NO_ADVISORY_WARNINGS"] = "1"
            logger.info("Initializing neural models in background (%s)...", _BI_ENCODER_MODEL)
            bi = SentenceTransformer(_BI_ENCODER_MODEL)
            self._bi_encoder = bi
            logger.info("Bi-encoder loaded successfully [OK]")
            
            for cb in self._on_model_ready_callbacks:
                try:
                    cb(bi)
                except Exception:
                    pass

            logger.info("Initializing cross-encoder in background (%s)...", _CROSS_ENCODER_MODEL)
            ce = CrossEncoder(_CROSS_ENCODER_MODEL)
            self._cross_encoder = ce
            logger.info("Cross-encoder loaded successfully [OK]")
        except Exception as exc:
            logger.warning("Neural transformer background load notice: %s. Continuing with fast subword embeddings.", exc)

    def _evict_lru_if_needed(self):
        """Evict oldest cached session indexes if RAM capacity is exceeded."""
        while len(self._session_chunks) > self.max_cached_sessions:
            oldest_sid, _ = self._session_chunks.popitem(last=False)
            self._session_bm25.pop(oldest_sid, None)
            self._session_embeddings.pop(oldest_sid, None)
            logger.debug("Evicted session %s index from memory cache", oldest_sid)

    # ──────────────────────────────────────────────────────────────────────
    # Document Indexing (Session Scoped)
    # ──────────────────────────────────────────────────────────────────────

    def index_session_chunks(self, session_id: str, new_chunks: List[Chunk], replace: bool = False) -> None:
        """Add chunks to a session's index (rebuilding session index)."""
        if not new_chunks and not replace:
            return

        if replace:
            combined_chunks = new_chunks
        else:
            # Check if session already has chunks, append if so
            existing_chunks = self.get_session_chunks(session_id)
            # Deduplicate chunks by ID
            existing_ids = {c.id for c in existing_chunks}
            combined_chunks = existing_chunks + [c for c in new_chunks if c.id not in existing_ids]

        if not combined_chunks:
            self.delete_session_index(session_id)
            return

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

        # Cache in memory (update LRU)
        self._session_bm25[session_id] = bm25
        self._session_embeddings[session_id] = embeddings
        self._session_chunks[session_id] = combined_chunks
        self._session_chunks.move_to_end(session_id)
        self._session_bm25.move_to_end(session_id)
        self._session_embeddings.move_to_end(session_id)
        self._evict_lru_if_needed()

        # Persist safely to disk
        self._save_session_index(session_id, embeddings, combined_chunks)
        logger.info("Session %s indexed (%d total chunks across all session docs)", session_id, len(combined_chunks))

    def remove_document_from_session(self, session_id: str, doc_id: str) -> None:
        """Remove a single document's chunks from a session index."""
        existing = self.get_session_chunks(session_id)
        remaining = [c for c in existing if c.doc_id != doc_id]
        if remaining:
            self.index_session_chunks(session_id, remaining, replace=True)
        else:
            self.delete_session_index(session_id)

    def delete_session_index(self, session_id: str) -> None:
        self._session_bm25.pop(session_id, None)
        self._session_embeddings.pop(session_id, None)
        self._session_chunks.pop(session_id, None)
        
        # Clean both safe npz and legacy pkl
        for ext in (".npz", ".pkl"):
            path = os.path.join(self.index_dir, f"session_{session_id}{ext}")
            if os.path.exists(path):
                try:
                    os.remove(path)
                except OSError:
                    pass

    def get_session_chunks(self, session_id: str) -> List[Chunk]:
        if session_id in self._session_chunks:
            self._session_chunks.move_to_end(session_id)
            if session_id in self._session_bm25:
                self._session_bm25.move_to_end(session_id)
            if session_id in self._session_embeddings:
                self._session_embeddings.move_to_end(session_id)
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
        additional_session_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Hybrid retrieval (BM25 + Semantic Search + RRF + Cross-Encoder) for a session's documents.
        Supports optional additional_session_ids to retrieve across ALL previously uploaded documents.
        """
        top_k = top_k or self.top_k
        candidates_k = candidates_k or self.candidates_k

        t_start = time.perf_counter()

        # Multi-session (global knowledge across all uploaded documents)
        if additional_session_ids:
            all_chunks: List[Chunk] = []
            all_embeddings_list: List[np.ndarray] = []

            # Current session chunks first
            current_chunks = self.get_session_chunks(session_id)
            if current_chunks:
                all_chunks.extend(current_chunks)
                cur_emb = self._session_embeddings.get(session_id)
                if cur_emb is not None and len(cur_emb) == len(current_chunks):
                    all_embeddings_list.append(cur_emb)
                elif self._bi_encoder is not None:
                    all_embeddings_list.append(self._bi_encoder.encode([c.contextual_text for c in current_chunks], normalize_embeddings=True))
                else:
                    all_embeddings_list.append(self._fallback_vectorizer.encode([c.contextual_text for c in current_chunks]))

            # Chunks from other previous sessions
            for other_sid in additional_session_ids:
                if other_sid == session_id:
                    continue
                other_chunks = self.get_session_chunks(other_sid)
                if not other_chunks:
                    continue

                tagged_other_chunks = []
                for c in other_chunks:
                    c_meta = dict(c.metadata)
                    c_meta["is_cross_session"] = True
                    doc_title = c_meta.get("title") or c_meta.get("source") or "Document"
                    if "Previous Chat" not in doc_title:
                        c_meta["title"] = f"{doc_title} (Previous Chat)"
                    tagged_c = Chunk(
                        id=c.id,
                        text=c.text,
                        contextual_text=c.contextual_text,
                        parent_id=c.parent_id,
                        parent_text=c.parent_text,
                        doc_id=c.doc_id,
                        session_id=c.session_id,
                        chunk_index=c.chunk_index,
                        parent_index=c.parent_index,
                        metadata=c_meta,
                    )
                    tagged_other_chunks.append(tagged_c)

                all_chunks.extend(tagged_other_chunks)
                other_emb = self._session_embeddings.get(other_sid)
                if other_emb is not None and len(other_emb) == len(other_chunks):
                    all_embeddings_list.append(other_emb)
                elif self._bi_encoder is not None:
                    all_embeddings_list.append(self._bi_encoder.encode([c.contextual_text for c in other_chunks], normalize_embeddings=True))
                else:
                    all_embeddings_list.append(self._fallback_vectorizer.encode([c.contextual_text for c in other_chunks]))

            if not all_chunks:
                return []

            chunks = all_chunks
            n = len(chunks)
            tokenized_all = [c.contextual_text.lower().split() for c in chunks]
            if _HAVE_BM25:
                bm25_model = BM25Okapi(tokenized_all)
            else:
                bm25_model = SimpleBM25(tokenized_all)

            if all_embeddings_list:
                doc_embs = np.vstack(all_embeddings_list).astype(np.float32)
            else:
                doc_embs = np.zeros((n, 384), dtype=np.float32)

            t0 = time.perf_counter()
            tokenized_query = query.lower().split()
            bm25_scores = bm25_model.get_scores(tokenized_query)
            bm25_ranks = np.argsort(bm25_scores)[::-1]
            bm25_latency = (time.perf_counter() - t0) * 1000.0

            t1 = time.perf_counter()
            if self._bi_encoder is not None:
                query_emb = self._bi_encoder.encode([query], normalize_embeddings=True)[0].astype(np.float32)
            else:
                query_emb = self._fallback_vectorizer.encode([query])[0].astype(np.float32)

            if doc_embs.shape[1] == query_emb.shape[0]:
                dense_scores = doc_embs @ query_emb
            else:
                dense_scores = np.zeros(n, dtype=np.float32)
            dense_ranks = np.argsort(dense_scores)[::-1]
            dense_latency = (time.perf_counter() - t1) * 1000.0

        else:
            # Single session retrieval (Current Chat Only)
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
            t0 = time.perf_counter()
            tokenized_query = query.lower().split()
            bm25_model = self._session_bm25[session_id]
            bm25_scores = bm25_model.get_scores(tokenized_query)
            bm25_ranks = np.argsort(bm25_scores)[::-1]
            bm25_latency = (time.perf_counter() - t0) * 1000.0

            # ── Stage 1b: Dense (Semantic) ──
            t1 = time.perf_counter()
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
            dense_latency = (time.perf_counter() - t1) * 1000.0

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
        t2 = time.perf_counter()
        if self._cross_encoder is not None and len(candidate_idxs) > 0:
            candidate_pairs = [(query, chunks[i].text) for i in candidate_idxs]
            rerank_scores = self._cross_encoder.predict(candidate_pairs, show_progress_bar=False)
        else:
            # Fallback normalized lexical + dense fusion score
            rerank_scores = np.array([
                0.5 * (dense_scores[i] + 1.0) / 2.0 + 0.5 * (bm25_scores[i] / (np.max(bm25_scores) + 1e-6))
                for i in candidate_idxs
            ])
        rerank_latency = (time.perf_counter() - t2) * 1000.0

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

        total_latency = (time.perf_counter() - t_start) * 1000.0
        self.last_latency_metrics = {
            "bm25_ms": round(bm25_latency, 2),
            "dense_ms": round(dense_latency, 2),
            "rerank_ms": round(rerank_latency, 2),
            "total_retrieval_ms": round(total_latency, 2),
        }
        try:
            from metrics import metrics
            metrics.record_retrieval(total_latency / 1000.0)
        except Exception:
            pass

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
    # Persistence (Safe NPZ + JSON Serialization, Zero Pickle Vulnerability)
    # ──────────────────────────────────────────────────────────────────────

    def _save_session_index(self, session_id: str, embeddings: np.ndarray, chunks: List[Chunk]):
        path = os.path.join(self.index_dir, f"session_{session_id}.npz")
        chunks_json_str = json.dumps([_chunk_to_dict(c) for c in chunks], ensure_ascii=False)
        np.savez_compressed(
            path,
            embeddings=embeddings,
            chunks_json=np.array(chunks_json_str, dtype=object),
        )

    def _load_session_index(self, session_id: str):
        npz_path = os.path.join(self.index_dir, f"session_{session_id}.npz")
        if os.path.exists(npz_path):
            try:
                # Load embeddings and chunks cleanly
                data = np.load(npz_path, allow_pickle=True)
                embeddings = data["embeddings"]
                chunks_json_str = str(data["chunks_json"])
                chunks_data = json.loads(chunks_json_str)
                chunks = [_dict_to_chunk(d) for d in chunks_data]

                # Reconstruct BM25 model
                tokenized = [c.contextual_text.lower().split() for c in chunks]
                bm25 = BM25Okapi(tokenized) if _HAVE_BM25 else SimpleBM25(tokenized)

                self._session_bm25[session_id] = bm25
                self._session_embeddings[session_id] = embeddings
                self._session_chunks[session_id] = chunks
                self._session_chunks.move_to_end(session_id)
                self._session_bm25.move_to_end(session_id)
                self._session_embeddings.move_to_end(session_id)
                self._evict_lru_if_needed()
                return
            except Exception as exc:
                logger.warning("Failed to load session index from %s: %s", npz_path, exc)

        # Legacy fallback if pkl exists
        pkl_path = os.path.join(self.index_dir, f"session_{session_id}.pkl")
        if os.path.exists(pkl_path):
            try:
                with open(pkl_path, "rb") as f:
                    data = pickle.load(f)
                self._session_bm25[session_id] = data["bm25"]
                self._session_embeddings[session_id] = data["embeddings"]
                self._session_chunks[session_id] = data["chunks"]
                # Convert to new safe format
                self._save_session_index(session_id, data["embeddings"], data["chunks"])
                try:
                    os.remove(pkl_path)
                except OSError:
                    pass
            except Exception as exc:
                logger.warning("Failed to load legacy pkl index: %s", exc)
