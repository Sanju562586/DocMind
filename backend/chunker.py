"""
Structure-Aware Document Chunker
─────────────────────────────────
Strategy:
  1. Structural Syntax Parsing:
     - Headings (Markdown '#', numbered outlines '1.1', 'Section X', 'Unit Y')
     - Tables (Markdown pipe tables, tab/grid tables) preserved atomically
     - Code blocks (fenced ```...```) preserved intact
     - Lists (bullet points, numbered steps) grouped logically
     - Page & slide boundaries ('--- [Page X] ---')
     - Paragraphs (blank-line delimited prose)
  2. Hierarchical Breadcrumb Tracking:
     - Maintains heading tree (e.g. "Chapter 1 > 1.2 Architecture > Key Components")
     - Attaches breadcrumb metadata and section hierarchy to every block and chunk
  3. Two-Tier Hierarchical Structure:
     - Parent Sections: Cohesive high-level sections (headings + enclosed text, ~512-800 tokens)
     - Child Chunks: Granular structure-aware chunks (~150-250 tokens) that NEVER slice
       tables mid-row or code blocks mid-body, and split long prose cleanly at sentence boundaries.
  4. Contextual Prefix:
     - Enriches embeddings and BM25 keywords with document title, page number, breadcrumb, and structural type.
"""

import re
import uuid
import math
import logging
from dataclasses import dataclass, field
from typing import List, Dict, Optional, Tuple, Any
from collections import Counter
import numpy as np

logger = logging.getLogger(__name__)


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


class BlockType:
    HEADING = "heading"
    TABLE = "table"
    CODE = "code"
    LIST = "list"
    PARAGRAPH = "paragraph"
    PAGE_MARKER = "page_marker"


@dataclass
class StructuralBlock:
    block_type: str
    text: str
    level: int = 0
    page_number: Optional[int] = None
    breadcrumb: str = ""
    section_title: str = ""


class StructureAwareChunker:
    """
    Structure-Aware Document Chunker.
    Parses and respects headings hierarchy, tables, code blocks, lists, page markers, and paragraphs.
    """

    def __init__(
        self,
        parent_chunk_size: int = 512,
        child_chunk_size: int = 160,
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
        self._embed_model = model

    @staticmethod
    def _token_count(text: str) -> int:
        return int(len(text.split()) * 1.33)

    # ──────────────────────────────────────────────────────────────────────
    # Structural Syntax Detectors
    # ──────────────────────────────────────────────────────────────────────

    @staticmethod
    def _is_page_marker(line: str) -> Optional[int]:
        m = re.match(r"^---\s*\[(?:Page|Slide|Chapter|Sheet)\s+(\d+)\]\s*---", line.strip(), re.IGNORECASE)
        return int(m.group(1)) if m else None

    @staticmethod
    def _is_code_fence(line: str) -> bool:
        return line.strip().startswith("```")

    @staticmethod
    def _is_table_row(line: str) -> bool:
        s = line.strip()
        return (s.startswith("|") and s.endswith("|")) or s.count("|") >= 2

    @staticmethod
    def _is_list_item(line: str) -> bool:
        return bool(re.match(r"^(\s*[-*•]|\s*\d+[\.\)])\s+\S+", line))

    @staticmethod
    def _is_heading(line: str) -> Optional[Tuple[int, str]]:
        s = line.strip()
        if not s:
            return None

        # 1. Markdown heading (# H1, ## H2, etc.)
        m_md = re.match(r"^(#{1,6})\s+(.+)$", s)
        if m_md:
            level = len(m_md.group(1))
            title = m_md.group(2).strip()
            return level, title

        # 2. Numbered outline headings (e.g. 1. Introduction, 1.1 Overview, 2.3.1 Architecture)
        m_num = re.match(r"^(\d+(?:\.\d+)*)[\.\)\:\-]?\s+([A-Z][A-Za-z0-9_\s\-\(\)\/\,\&]{2,80})$", s)
        if m_num:
            dots = m_num.group(1).count(".")
            level = min(6, dots + 2)
            title = s
            return level, title

        # 3. Labeled chapter/unit/module/section (e.g. Unit 1: Introduction, Chapter 3 - Design)
        m_lbl = re.match(r"^(?:Unit|Chapter|Section|Module|Part|Article|Clause)\s*(\d+|[A-Za-z]+)?\s*[:\-–]\s*(.+)$", s, re.IGNORECASE)
        if m_lbl:
            level = 2
            return level, s

        # 4. Short stand-alone uppercase line (e.g. "EXECUTIVE SUMMARY", "ABSTRACT")
        if s.isupper() and 4 <= len(s) <= 50 and not s.endswith((".", ";", ":", ",")):
            return 2, s

        return None

    # ──────────────────────────────────────────────────────────────────────
    # Step 1: Parse Document into Structural Blocks with Breadcrumbs
    # ──────────────────────────────────────────────────────────────────────

    def _parse_blocks(self, text: str) -> List[StructuralBlock]:
        lines = text.splitlines()
        raw_blocks: List[StructuralBlock] = []

        current_page: Optional[int] = None
        heading_stack: List[Tuple[int, str]] = []

        i = 0
        while i < len(lines):
            line = lines[i]
            stripped = line.strip()

            if not stripped:
                i += 1
                continue

            # Page marker
            page_num = self._is_page_marker(stripped)
            if page_num is not None:
                current_page = page_num
                raw_blocks.append(StructuralBlock(
                    block_type=BlockType.PAGE_MARKER,
                    text=stripped,
                    page_number=current_page,
                ))
                i += 1
                continue

            # Code fence
            if self._is_code_fence(stripped):
                code_lines = [line]
                i += 1
                while i < len(lines) and not self._is_code_fence(lines[i]):
                    code_lines.append(lines[i])
                    i += 1
                if i < len(lines):
                    code_lines.append(lines[i])
                    i += 1
                raw_blocks.append(StructuralBlock(
                    block_type=BlockType.CODE,
                    text="\n".join(code_lines),
                    page_number=current_page,
                ))
                continue

            # Table block
            if self._is_table_row(stripped):
                table_lines = [stripped]
                i += 1
                while i < len(lines) and self._is_table_row(lines[i]):
                    table_lines.append(lines[i].strip())
                    i += 1
                raw_blocks.append(StructuralBlock(
                    block_type=BlockType.TABLE,
                    text="\n".join(table_lines),
                    page_number=current_page,
                ))
                continue

            # Heading block
            h_info = self._is_heading(stripped)
            if h_info:
                level, h_title = h_info
                while heading_stack and heading_stack[-1][0] >= level:
                    heading_stack.pop()
                heading_stack.append((level, h_title))
                breadcrumb = " > ".join(h[1] for h in heading_stack)

                raw_blocks.append(StructuralBlock(
                    block_type=BlockType.HEADING,
                    text=stripped,
                    level=level,
                    page_number=current_page,
                    breadcrumb=breadcrumb,
                    section_title=h_title,
                ))
                i += 1
                continue

            # List block
            if self._is_list_item(stripped):
                list_lines = [stripped]
                i += 1
                while i < len(lines):
                    next_s = lines[i].strip()
                    if not next_s:
                        if i + 1 < len(lines) and self._is_list_item(lines[i + 1]):
                            i += 1
                            continue
                        break
                    if self._is_list_item(next_s) or lines[i].startswith(("  ", "\t")):
                        list_lines.append(next_s)
                        i += 1
                    else:
                        break
                raw_blocks.append(StructuralBlock(
                    block_type=BlockType.LIST,
                    text="\n".join(list_lines),
                    page_number=current_page,
                ))
                continue

            # Paragraph block
            para_lines = [stripped]
            i += 1
            while i < len(lines):
                next_s = lines[i].strip()
                if not next_s:
                    break
                if (
                    self._is_page_marker(next_s)
                    or self._is_code_fence(next_s)
                    or self._is_table_row(next_s)
                    or self._is_heading(next_s)
                    or self._is_list_item(next_s)
                ):
                    break
                para_lines.append(next_s)
                i += 1
            raw_blocks.append(StructuralBlock(
                block_type=BlockType.PARAGRAPH,
                text=" ".join(para_lines),
                page_number=current_page,
            ))

        # Propagate active page and active breadcrumbs
        active_p = None
        active_b = ""
        active_sec = "Introduction"

        for b in raw_blocks:
            if b.page_number is not None:
                active_p = b.page_number
            else:
                b.page_number = active_p

            if b.block_type == BlockType.HEADING:
                active_b = b.breadcrumb
                active_sec = b.section_title
            else:
                b.breadcrumb = active_b or active_sec
                b.section_title = active_sec

        return raw_blocks

    # ──────────────────────────────────────────────────────────────────────
    # Step 2: Build Cohesive Parent Sections
    # ──────────────────────────────────────────────────────────────────────

    def _build_parent_sections(self, blocks: List[StructuralBlock]) -> List[Dict[str, Any]]:
        """Group structural blocks into logical parent sections (~512-800 tokens)."""
        sections: List[Dict[str, Any]] = []
        cur_blocks: List[StructuralBlock] = []
        cur_tokens = 0
        cur_header = "Introduction"
        cur_page = None

        def flush_section():
            nonlocal cur_blocks, cur_tokens, cur_header, cur_page
            if not cur_blocks:
                return
            content_blocks = [b for b in cur_blocks if b.block_type != BlockType.PAGE_MARKER]
            if not content_blocks:
                cur_blocks = []
                cur_tokens = 0
                return

            p_text = "\n\n".join(b.text for b in content_blocks)
            first_p = next((b.page_number for b in cur_blocks if b.page_number is not None), cur_page)
            sec_header = content_blocks[0].section_title if content_blocks[0].section_title else cur_header
            breadcrumb = content_blocks[0].breadcrumb if content_blocks[0].breadcrumb else sec_header

            sections.append({
                "parent_text": p_text,
                "section_header": sec_header,
                "breadcrumb": breadcrumb,
                "page_num": first_p,
                "blocks": content_blocks,
            })
            cur_blocks = []
            cur_tokens = 0

        for b in blocks:
            b_tokens = self._token_count(b.text)

            # Major section boundary: level 1 or 2 heading
            if b.block_type == BlockType.HEADING and b.level <= 2:
                if cur_blocks and cur_tokens >= 80:
                    flush_section()
                cur_header = b.section_title
                cur_page = b.page_number
                cur_blocks.append(b)
                cur_tokens += b_tokens
                continue

            # Page boundary: each page or slide is a distinct structural unit
            if b.block_type == BlockType.PAGE_MARKER:
                if cur_blocks:
                    flush_section()
                cur_page = b.page_number
                cur_blocks.append(b)
                continue

            # Token overflow: flush at block boundary
            if cur_tokens + b_tokens > self.parent_chunk_size and cur_blocks:
                flush_section()

            cur_blocks.append(b)
            cur_tokens += b_tokens

        flush_section()
        return sections

    # ──────────────────────────────────────────────────────────────────────
    # Step 3: Structure-Aware Child Chunks Generation
    # ──────────────────────────────────────────────────────────────────────

    def _split_table(self, table_text: str, max_tokens: int) -> List[str]:
        """Split a large table by rows while repeating the table header on every chunk."""
        lines = [l for l in table_text.strip().splitlines() if l.strip()]
        if len(lines) <= 4:
            return [table_text]

        header_lines = []
        data_rows = []
        if len(lines) >= 2 and re.match(r"^\|?[\s\-:|]+\|?$", lines[1]):
            header_lines = [lines[0], lines[1]]
            data_rows = lines[2:]
        else:
            header_lines = [lines[0]]
            data_rows = lines[1:]

        header_prefix = "\n".join(header_lines)
        chunks: List[str] = []
        cur_chunk_rows = []
        cur_t = self._token_count(header_prefix)

        for row in data_rows:
            rt = self._token_count(row)
            if cur_t + rt > max_tokens and cur_chunk_rows:
                chunk_str = header_prefix + "\n" + "\n".join(cur_chunk_rows)
                chunks.append(chunk_str)
                cur_chunk_rows = [row]
                cur_t = self._token_count(header_prefix) + rt
            else:
                cur_chunk_rows.append(row)
                cur_t += rt

        if cur_chunk_rows:
            chunk_str = header_prefix + "\n" + "\n".join(cur_chunk_rows)
            chunks.append(chunk_str)

        return chunks if chunks else [table_text]

    def _split_paragraph(self, para_text: str, max_tokens: int) -> List[str]:
        """Split long prose strictly at clean sentence boundaries."""
        sentences = re.split(r"(?<=[.!?])\s+(?=[A-Z0-9\"])", para_text)
        if len(sentences) <= 1:
            words = para_text.split()
            parts = []
            for k in range(0, len(words), max_tokens):
                parts.append(" ".join(words[k: k + max_tokens]))
            return parts

        chunks: List[str] = []
        cur_s = []
        cur_t = 0

        for s in sentences:
            st = self._token_count(s)
            if cur_t + st > max_tokens and cur_s:
                chunks.append(" ".join(cur_s))
                cur_s = [s]
                cur_t = st
            else:
                cur_s.append(s)
                cur_t += st

        if cur_s:
            chunks.append(" ".join(cur_s))
        return chunks

    def _generate_child_chunks(
        self, parent_sec: Dict[str, Any], doc_metadata: Dict[str, Any], doc_id: str, session_id: str, parent_id: str, parent_idx: int, start_chunk_idx: int
    ) -> List[Chunk]:
        blocks: List[StructuralBlock] = parent_sec["blocks"]
        parent_text: str = parent_sec["parent_text"]
        doc_title = doc_metadata.get("title") or doc_metadata.get("source") or "Document"

        child_chunks: List[Chunk] = []
        curr_pieces: List[str] = []
        curr_tokens = 0
        curr_page = parent_sec["page_num"]
        curr_type = "prose"
        curr_breadcrumb = parent_sec["breadcrumb"]
        curr_section = parent_sec["section_header"]

        def flush_child(keep_trailing_heading: bool = True):
            nonlocal curr_pieces, curr_tokens, curr_page, curr_type, curr_breadcrumb, curr_section, start_chunk_idx
            if not curr_pieces:
                return

            saved_heading = None
            if keep_trailing_heading and len(curr_pieces) > 1 and self._is_heading(curr_pieces[-1]):
                saved_heading = curr_pieces.pop()
                curr_tokens -= self._token_count(saved_heading)

            child_text = "\n\n".join(curr_pieces).strip()
            if child_text:
                p_str = f" [Page: {curr_page}]" if curr_page is not None else ""
                b_str = f" [Section: {curr_breadcrumb}]" if curr_breadcrumb else ""
                t_str = f" ({curr_type})" if curr_type in ("table", "code", "list") else ""
                contextual_text = f"[Document: {doc_title}]{p_str}{b_str}{t_str}\n{child_text}"

                chunk = Chunk(
                    id=str(uuid.uuid4()),
                    text=child_text,
                    contextual_text=contextual_text,
                    parent_id=parent_id,
                    parent_text=parent_text,
                    doc_id=doc_id,
                    session_id=session_id,
                    chunk_index=start_chunk_idx,
                    parent_index=parent_idx,
                    metadata={
                        **doc_metadata,
                        "doc_id": doc_id,
                        "session_id": session_id,
                        "parent_index": parent_idx,
                        "section": curr_section,
                        "breadcrumb": curr_breadcrumb,
                        "page_number": curr_page,
                        "structural_type": curr_type,
                        "word_count": len(child_text.split()),
                    },
                )
                child_chunks.append(chunk)
                start_chunk_idx += 1

            if saved_heading:
                curr_pieces = [saved_heading]
                curr_tokens = self._token_count(saved_heading)
            else:
                curr_pieces = []
                curr_tokens = 0

        for b in blocks:
            if b.page_number is not None:
                curr_page = b.page_number
            if b.breadcrumb:
                curr_breadcrumb = b.breadcrumb
            if b.section_title:
                curr_section = b.section_title

            # 1. Heading: attach to subsequent block (never leave trailing)
            if b.block_type == BlockType.HEADING:
                if curr_tokens > self.child_chunk_size and curr_pieces:
                    flush_child()
                curr_pieces.append(b.text)
                curr_tokens += self._token_count(b.text)
                continue

            # 2. Table: atomic table chunking
            if b.block_type == BlockType.TABLE:
                t_count = self._token_count(b.text)
                if t_count > int(self.child_chunk_size * 1.5):
                    flush_child()
                    curr_type = "table"
                    sub_tables = self._split_table(b.text, self.child_chunk_size)
                    for sub_t in sub_tables:
                        curr_pieces = [sub_t]
                        flush_child()
                    curr_type = "prose"
                    continue
                else:
                    if curr_tokens + t_count > self.child_chunk_size and curr_pieces:
                        flush_child()
                    curr_type = "table"
                    curr_pieces.append(b.text)
                    flush_child()
                    curr_type = "prose"
                    continue

            # 3. Code: atomic code chunking
            if b.block_type == BlockType.CODE:
                c_count = self._token_count(b.text)
                if curr_pieces and (curr_tokens + c_count > self.child_chunk_size):
                    flush_child()
                curr_type = "code"
                curr_pieces.append(b.text)
                flush_child()
                curr_type = "prose"
                continue

            # 4. List: structured list grouping
            if b.block_type == BlockType.LIST:
                l_count = self._token_count(b.text)
                if curr_tokens + l_count > self.child_chunk_size and curr_pieces:
                    flush_child()
                curr_type = "list"
                curr_pieces.append(b.text)
                curr_tokens += l_count
                if curr_tokens >= self.child_chunk_size:
                    flush_child()
                    curr_type = "prose"
                continue

            # 5. Paragraph
            p_count = self._token_count(b.text)
            if p_count > int(self.child_chunk_size * 1.5):
                if curr_pieces:
                    flush_child()
                sub_paras = self._split_paragraph(b.text, self.child_chunk_size)
                for sp in sub_paras:
                    curr_pieces = [sp]
                    flush_child()
                continue

            if curr_tokens + p_count > self.child_chunk_size and curr_pieces:
                flush_child()

            curr_pieces.append(b.text)
            curr_tokens += p_count

        flush_child(keep_trailing_heading=False)
        return child_chunks

    # ──────────────────────────────────────────────────────────────────────
    # Public Entrypoint
    # ──────────────────────────────────────────────────────────────────────

    def chunk_document(
        self, doc_text: str, doc_id: str, session_id: str, doc_metadata: Dict[str, Any]
    ) -> List[Chunk]:
        """
        Structure-aware document chunking entrypoint.
        """
        blocks = self._parse_blocks(doc_text)
        parent_sections = self._build_parent_sections(blocks)

        all_chunks: List[Chunk] = []
        global_chunk_idx = 0

        for parent_idx, parent_sec in enumerate(parent_sections):
            parent_id = str(uuid.uuid4())
            children = self._generate_child_chunks(
                parent_sec=parent_sec,
                doc_metadata=doc_metadata,
                doc_id=doc_id,
                session_id=session_id,
                parent_id=parent_id,
                parent_idx=parent_idx,
                start_chunk_idx=global_chunk_idx,
            )
            all_chunks.extend(children)
            global_chunk_idx += len(children)

        logger.info(
            "StructureAwareChunker: Document %s split into %d structural parents and %d structure-aware child chunks",
            doc_id, len(parent_sections), len(all_chunks)
        )
        return all_chunks


# Backward-compatible alias
HierarchicalSemanticChunker = StructureAwareChunker
