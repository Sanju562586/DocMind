"""
Hierarchical Semantic Chunker
─────────────────────────────
Strategy:
  1. Structural split  → "parent" chunks  (~512 tokens, preserves sections/paragraphs)
  2. Semantic split    → "child"  chunks  (~128 tokens, topic-boundary detection via
                          cosine distance between adjacent sentence representations)
  3. Contextual prefix → each child chunk gets a prefix like
                          "Context: [Document: title] [Section: header] " before embedding,
                          so distant chunks that share a topic area still surface together.
  4. Parent-child link → each child stores its parent's full text for LLM context expansion.

Why this captures distant relationships:
  • BM25 benefits from the contextual prefix keywords (e.g., section title words)
  • Dense embeddings capture semantic overlap between child & distant peers
  • On retrieval, we inject the full parent text → LLM gets broad context, not just snippet
"""

import re
import uuid
import math
import logging
from dataclasses import dataclass, field
from typing import List, Optional, Dict, Any
from collections import Counter

# pyrefly: ignore [missing-import]
import numpy as np

logger = logging.getLogger(__name__)

# Graceful import of SentenceTransformer
_HAVE_SENTENCE_TRANSFORMERS = False
try:
    _HAVE_SENTENCE_TRANSFORMERS = True
except ImportError:
    logger.warning("sentence-transformers not installed. Using fast subword TF-IDF vectorizer fallback for chunking.")


@dataclass
class Chunk:
    id: str
    text: str                  # raw child chunk text (stored, shown in citations)
    contextual_text: str       # text WITH context prefix (used for embedding & BM25)
    parent_id: str
    parent_text: str           # full parent section text (injected into LLM prompt)
    doc_id: str
    session_id: str
    chunk_index: int           # global index across all chunks in the document
    parent_index: int          # which parent section this came from
    metadata: Dict[str, Any] = field(default_factory=dict)


class FastSubwordVectorizer:
    """Fixed-dimension subword feature hashing vectorizer for zero-dependency semantic embeddings."""

    def __init__(self, dim: int = 1024, n_gram=(2, 4)):
        self.dim = dim
        self.n_gram = n_gram

    def _get_ngrams(self, text: str) -> List[str]:
        words = text.lower().split()
        ngrams = []
        for word in words:
            word = f"^{word}$"
            for n in range(self.n_gram[0], min(len(word) + 1, self.n_gram[1] + 1)):
                for i in range(len(word) - n + 1):
                    ngrams.append(word[i:i + n])
        return ngrams

    def encode(self, texts: List[str]) -> np.ndarray:
        if not texts:
            return np.empty((0, self.dim), dtype=np.float32)

        n_docs = len(texts)
        matrix = np.zeros((n_docs, self.dim), dtype=np.float32)

        for i, text in enumerate(texts):
            grams = self._get_ngrams(text)
            if not grams:
                continue
            counts = Counter(grams)
            for g, count in counts.items():
                h = hash(g)
                idx = abs(h) % self.dim
                sign = 1.0 if (h & 1) else -1.0
                matrix[i, idx] += sign * math.log1p(count)

            norm = np.linalg.norm(matrix[i])
            if norm > 1e-6:
                matrix[i] /= norm

        return matrix


class HierarchicalSemanticChunker:
    """
    Implements hierarchical (parent-child) + semantic chunking with contextual enrichment.
    """

    def __init__(
        self,
        parent_chunk_size: int = 512,
        child_chunk_size: int = 128,
        child_overlap: int = 20,
        semantic_threshold: float = 0.35,
        embed_model: Any = None,
    ):
        self.parent_chunk_size = parent_chunk_size
        self.child_chunk_size = child_chunk_size
        self.child_overlap = child_overlap
        self.semantic_threshold = semantic_threshold
        self._embed_model = embed_model
        self._fallback_vectorizer = FastSubwordVectorizer()

    def set_embed_model(self, model: Any):
        """Optionally attach a neural SentenceTransformer model once loaded."""
        self._embed_model = model

    # ──────────────────────────────────────────────────────────────────────
    # Public API
    # ──────────────────────────────────────────────────────────────────────

    def chunk_document(
        self, doc_text: str, doc_id: str, session_id: str, doc_metadata: Dict[str, Any]
    ) -> List[Chunk]:
        """
        Convert a full document string into a list of hierarchical child chunks linked to session_id.
        """
        parent_sections = self._split_into_parents(doc_text)
        logger.info(
            "Document %s (Session: %s) split into %d parent sections",
            doc_id, session_id, len(parent_sections)
        )

        all_chunks: List[Chunk] = []
        global_chunk_idx = 0

        for parent_idx, (parent_text, section_header, page_num) in enumerate(parent_sections):
            parent_id = str(uuid.uuid4())
            child_texts = self._semantic_split(parent_text)

            # Fallback page extraction if not detected in section tuple
            if page_num is None:
                page_match = re.search(r"---\s*\[Page\s+(\d+)\]\s*---", parent_text)
                page_num = int(page_match.group(1)) if page_match else None

            for child_text in child_texts:
                if not child_text.strip():
                    continue

                chunk_id = str(uuid.uuid4())
                contextual_text = self._build_contextual_text(
                    child_text, section_header, doc_metadata, page_num=page_num
                )

                chunk = Chunk(
                    id=chunk_id,
                    text=child_text,
                    contextual_text=contextual_text,
                    parent_id=parent_id,
                    parent_text=parent_text,
                    doc_id=doc_id,
                    session_id=session_id,
                    chunk_index=global_chunk_idx,
                    parent_index=parent_idx,
                    metadata={
                        **doc_metadata,
                        "doc_id": doc_id,
                        "section": section_header,
                        "parent_index": parent_idx,
                        "session_id": session_id,
                        "page_number": page_num,
                    },
                )
                all_chunks.append(chunk)
                global_chunk_idx += 1

        logger.info(
            "Created %d child chunks from %d parents for doc %s",
            len(all_chunks),
            len(parent_sections),
            doc_id,
        )
        return all_chunks

    # ──────────────────────────────────────────────────────────────────────
    # Step 1: Structural Parent Split
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _detect_section_header(page_text: str, page_num: Optional[int] = None) -> str:
        """
        Extract the title or section heading from a page or section across any document domain
        (e.g., reports, research papers, legal agreements, technical manuals, specifications, presentations, forms).
        """
        lines = [line.strip() for line in page_text.splitlines() if line.strip()]
        # Filter out boundary marker lines (Page, Slide, Chapter, Sheet, etc.)
        lines = [l for l in lines if not re.match(r"^---\s*\[(?:Page|Slide|Chapter|Sheet)\s+\d+\]\s*---", l, re.IGNORECASE)]

        if not lines:
            return f"Page {page_num}" if page_num else "Section"

        # 1. Structural headings & labeled document sections:
        # e.g., Markdown (# Title), Numbered outlines (1. Overview, 1.0 Architecture, 2.1 Architecture),
        # or standard document section keywords (Section, Chapter, Article, Clause, Overview, etc.)
        structural_pattern = re.compile(
            r"^(?:"
            r"#{1,6}\s*(.+)"
            r"|(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)[\.\)\:\-]?\s+([A-Z].*)"
            r"|(?:Section|Chapter|Article|Item|Part|Clause|Exhibit|Appendix|Module|Unit|Problem|Question|Task|Challenge|Exercise|Scenario|Topic|Case|Finding|Requirement|Policy|Overview|Abstract|Methodology|Conclusion|Results|Discussion|Introduction|Background|Objective|Goal|Deliverable|Milestone|Standard|Rule|Definition)\s*(?:Statement\s*)?(?:[A-Z]|\d+)?\s*[:\- ]*\s*(.*)"
            r")$",
            re.IGNORECASE
        )
        for line in lines[:5]:
            m = structural_pattern.match(line)
            if m:
                title_part = line.lstrip("#").strip()
                if len(title_part) > 100:
                    title_part = title_part[:97] + "..."
                return title_part

        # 2. Standalone typographic heading lines:
        # Short (<= 85 chars), not a sentence fragment (no ending '.', ';', ':')
        for line in lines[:2]:
            clean_line = line.lstrip("#").strip()
            if 3 <= len(clean_line) <= 85 and not clean_line.endswith((".", ";", ":", ",")):
                return clean_line

        return f"Page {page_num}" if page_num else "Main Content"

    def _split_into_parents(self, text: str) -> List[tuple]:
        """
        Returns list of (parent_text, section_header, page_num) tuples.
        Priority:
          1. Page / Slide / Chapter markers (PDF, DOCX, PPTX pages)
          2. Structural headings (Markdown '#', numbered outlines, labeled document sections)
          3. Paragraph grouping fallback
        """
        # 1. Check for explicit Page markers
        page_re = re.compile(r"^---\s*\[(?:Page|Slide|Chapter|Sheet)\s+(\d+)\]\s*---", re.MULTILINE | re.IGNORECASE)
        page_matches = list(page_re.finditer(text))

        if len(page_matches) >= 1:
            sections = []
            positions = [m.start() for m in page_matches] + [len(text)]
            for i, m in enumerate(page_matches):
                p_num = int(m.group(1))
                page_text = text[m.start(): positions[i + 1]].strip()
                sec_header = self._detect_section_header(page_text, p_num)
                # If page is moderately sized (<= ~768 tokens), keep it as a unified parent chunk
                if self._token_count(page_text) <= int(self.parent_chunk_size * 1.5):
                    sections.append((page_text, sec_header, p_num))
                else:
                    sub_groups = self._group_paragraphs(page_text, sec_header, default_page=p_num)
                    sections.extend(sub_groups)
            return sections

        # 2. Check for structural headings or labeled sections
        heading_re = re.compile(
            r"^(?:"
            r"#{1,6}\s+.+"
            r"|(?:\d+(?:\.\d+)*|[A-Z](?:\.\d+)*)[\.\)\:\-]?\s+[A-Z].+"
            r"|(?:Section|Chapter|Article|Item|Part|Clause|Exhibit|Appendix|Module|Unit|Problem|Question|Task|Challenge|Exercise|Scenario|Topic|Case|Finding|Requirement|Policy|Overview|Abstract|Methodology|Conclusion|Results|Discussion|Introduction|Background|Objective|Goal|Deliverable|Milestone|Standard|Rule|Definition)\s*(?:Statement\s*)?(?:[A-Z]|\d+)?\s*[:\- ].+"
            r")$",
            re.MULTILINE | re.IGNORECASE
        )
        heading_matches = list(heading_re.finditer(text))

        if len(heading_matches) >= 2:
            sections = []
            positions = [m.start() for m in heading_matches] + [len(text)]
            for i, match in enumerate(heading_matches):
                header = match.group(0).lstrip("#").strip()
                if len(header) > 90:
                    header = header[:87] + "..."
                section_text = text[match.start(): positions[i + 1]].strip()
                page_m = re.search(r"---\s*\[(?:Page|Slide|Chapter|Sheet)\s+(\d+)\]\s*---", section_text)
                p_num = int(page_m.group(1)) if page_m else None
                if self._token_count(section_text) > int(self.parent_chunk_size * 1.5):
                    sub = self._group_paragraphs(section_text, header, default_page=p_num)
                    sections.extend(sub)
                else:
                    sections.append((section_text, header, p_num))
            return sections

        # 3. Fallback to paragraph grouping
        return self._group_paragraphs(text, header="Main Content", default_page=None)

    def _group_paragraphs(
        self, text: str, header: str, default_page: Optional[int] = None
    ) -> List[tuple]:
        paragraphs = re.split(r"\n{2,}", text)
        groups: List[tuple] = []
        current_paras: List[str] = []
        current_tokens = 0
        part_idx = 1

        for para in paragraphs:
            para = para.strip()
            if not para:
                continue
            pt = self._token_count(para)
            if current_tokens + pt > self.parent_chunk_size and current_paras:
                group_text = "\n\n".join(current_paras)
                p_match = re.search(r"---\s*\[Page\s+(\d+)\]\s*---", group_text)
                p_num = int(p_match.group(1)) if p_match else default_page
                sub_header = f"{header} (Part {part_idx})" if part_idx > 1 else header
                groups.append((group_text, sub_header, p_num))
                part_idx += 1
                current_paras = [para]
                current_tokens = pt
            else:
                current_paras.append(para)
                current_tokens += pt

        if current_paras:
            group_text = "\n\n".join(current_paras)
            p_match = re.search(r"---\s*\[Page\s+(\d+)\]\s*---", group_text)
            p_num = int(p_match.group(1)) if p_match else default_page
            sub_header = f"{header} (Part {part_idx})" if part_idx > 1 else header
            groups.append((group_text, sub_header, p_num))

        return groups if groups else [(text, header, default_page)]

    # ──────────────────────────────────────────────────────────────────────
    # Step 2: Semantic Child Split
    # ──────────────────────────────────────────────────────────────────────

    def _semantic_split(self, text: str) -> List[str]:
        """
        Split parent text into semantically cohesive child chunks by detecting
        topic boundaries via cosine distance between adjacent sentence embeddings.
        """
        # If parent text is already compact (<= 1.5x child chunk size), keep it unified
        if self._token_count(text) <= int(self.child_chunk_size * 1.5):
            return [text.strip()]

        sentences = self._split_sentences(text)

        if len(sentences) <= 3:
            return self._split_by_tokens(text)

        # Fast subword vectorizer for instantaneous and reliable topic-boundary detection
        embeddings = self._fallback_vectorizer.encode(sentences)

        # Find topic-boundary indices
        split_positions = [0]
        for i in range(1, len(embeddings)):
            sim = self._cosine_sim(embeddings[i - 1], embeddings[i])
            distance = 1.0 - sim
            if distance > self.semantic_threshold:
                split_positions.append(i)
        split_positions.append(len(sentences))

        # Build child chunks from sentence groups
        children: List[str] = []
        for j in range(len(split_positions) - 1):
            group = sentences[split_positions[j]: split_positions[j + 1]]
            group_text = " ".join(group)
            if self._token_count(group_text) > self.child_chunk_size:
                children.extend(self._split_by_tokens(group_text))
            else:
                children.append(group_text)

        return [c for c in children if c.strip()]

    # ──────────────────────────────────────────────────────────────────────
    # Step 3: Contextual Prefix
    # ──────────────────────────────────────────────────────────────────────

    def _build_contextual_text(
        self, child_text: str, section_header: str, doc_metadata: Dict, page_num: Optional[int] = None
    ) -> str:
        doc_title = doc_metadata.get("title") or doc_metadata.get("source") or "Document"
        page_str = f" [Page: {page_num}]" if page_num is not None else ""
        context = (
            f"[Document: {doc_title}]{page_str} "
            f"[Section: {section_header}] "
            f"{child_text}"
        )
        return context

    # ──────────────────────────────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _split_sentences(text: str) -> List[str]:
        sentence_endings = re.compile(r"(?<=[.!?])\s+(?=[A-Z\"])")
        sentences = sentence_endings.split(text)
        result = []
        for s in sentences:
            s = s.strip()
            if s:
                result.append(s)
        return result

    def _split_by_tokens(self, text: str) -> List[str]:
        words = text.split()
        chunks = []
        start = 0
        size = self.child_chunk_size
        overlap = self.child_overlap

        while start < len(words):
            end = min(start + size, len(words))
            chunks.append(" ".join(words[start:end]))
            if end == len(words):
                break
            start = end - overlap

        return chunks

    @staticmethod
    def _token_count(text: str) -> int:
        return int(len(text.split()) * 1.33)

    @staticmethod
    def _cosine_sim(a: np.ndarray, b: np.ndarray) -> float:
        denom = (np.linalg.norm(a) * np.linalg.norm(b)) + 1e-9
        return float(np.dot(a, b) / denom)
