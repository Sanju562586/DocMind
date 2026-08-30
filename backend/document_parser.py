"""
Multi-format document parser.
Supports: PDF, DOCX, TXT, MD, HTML, CSV, XLSX
"""

import os
import re
import logging
from typing import Tuple, Dict, Any

logger = logging.getLogger(__name__)


class DocumentParser:
    SUPPORTED_TYPES = {".pdf", ".docx", ".txt", ".md", ".html", ".htm", ".csv", ".xlsx"}

    def parse(self, file_path: str, filename: str) -> Tuple[str, Dict[str, Any]]:
        """
        Parse a document and return (full_text, metadata).
        metadata includes: title, source, page_count, word_count, file_type
        """
        ext = os.path.splitext(filename)[1].lower()

        if ext not in self.SUPPORTED_TYPES:
            raise ValueError(
                f"Unsupported file type '{ext}'. "
                f"Supported: {', '.join(self.SUPPORTED_TYPES)}"
            )

        if ext == ".pdf":
            return self._parse_pdf(file_path, filename)
        elif ext == ".docx":
            return self._parse_docx(file_path, filename)
        elif ext in (".txt", ".md"):
            return self._parse_text(file_path, filename)
        elif ext in (".html", ".htm"):
            return self._parse_html(file_path, filename)
        elif ext == ".csv":
            return self._parse_csv(file_path, filename)
        elif ext == ".xlsx":
            return self._parse_xlsx(file_path, filename)

        raise ValueError(f"Unhandled file type: {ext}")

    # ──────────────────────────────────────────────
    # Parsers
    # ──────────────────────────────────────────────

    def _parse_pdf(self, path: str, filename: str) -> Tuple[str, Dict]:
        import fitz  # pymupdf

        doc = fitz.open(path)
        try:
            pages_text = []
            for page in doc:
                text = page.get_text("text")
                if text:
                    pages_text.append(text)

            full_text = "\n\n".join(pages_text)
            full_text = self._clean_text(full_text)
            if not full_text:
                full_text = f"(Document '{filename}' appears to contain scanned images or no extractable text.)"

            metadata = {
                "title": doc.metadata.get("title") or filename,
                "source": filename,
                "file_type": "pdf",
                "page_count": len(doc),
                "word_count": len(full_text.split()),
            }
            return full_text, metadata
        finally:
            doc.close()

    def _parse_docx(self, path: str, filename: str) -> Tuple[str, Dict]:
        from docx import Document

        doc = Document(path)
        sections = []

        for para in doc.paragraphs:
            if para.style.name.startswith("Heading"):
                level = para.style.name.split()[-1]
                prefix = "#" * int(level) if level.isdigit() else "##"
                sections.append(f"{prefix} {para.text.strip()}")
            elif para.text.strip():
                sections.append(para.text.strip())

        # Include tables
        for table in doc.tables:
            rows = []
            for row in table.rows:
                cells = [cell.text.strip() for cell in row.cells]
                rows.append(" | ".join(cells))
            if rows:
                sections.append("\n".join(rows))

        full_text = "\n\n".join(sections)
        full_text = self._clean_text(full_text)
        if not full_text:
            full_text = f"(Document '{filename}' contains no extractable paragraph text.)"

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": "docx",
            "page_count": None,
            "word_count": len(full_text.split()),
        }
        return full_text, metadata

    def _parse_text(self, path: str, filename: str) -> Tuple[str, Dict]:
        # Try UTF-8, fallback to Latin-1
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                text = f.read()
        except Exception:
            with open(path, "r", encoding="latin-1", errors="replace") as f:
                text = f.read()

        text = self._clean_text(text)
        if not text:
            text = f"(File '{filename}' is empty.)"

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": "txt" if filename.endswith(".txt") else "md",
            "page_count": None,
            "word_count": len(text.split()),
        }
        return text, metadata

    def _parse_html(self, path: str, filename: str) -> Tuple[str, Dict]:
        from bs4 import BeautifulSoup

        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                html = f.read()
        except Exception:
            with open(path, "r", encoding="latin-1", errors="replace") as f:
                html = f.read()

        soup = BeautifulSoup(html, "lxml")

        # Remove script/style tags
        for tag in soup(["script", "style", "nav", "footer", "header"]):
            tag.decompose()

        title = soup.title.string if soup.title else filename

        # Get structured text preserving headings
        parts = []
        for tag in soup.find_all(
            ["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th"]
        ):
            text = tag.get_text(strip=True)
            if not text:
                continue
            if tag.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
                level = int(tag.name[1])
                parts.append(f"{'#' * level} {text}")
            else:
                parts.append(text)

        full_text = "\n\n".join(parts)
        full_text = self._clean_text(full_text)
        if not full_text:
            full_text = f"(Web page '{filename}' contains no readable textual content.)"

        metadata = {
            "title": title,
            "source": filename,
            "file_type": "html",
            "page_count": None,
            "word_count": len(full_text.split()),
        }
        return full_text, metadata

    def _parse_csv(self, path: str, filename: str) -> Tuple[str, Dict]:
        import pandas as pd

        # Read CSV with encoding fallback and reasonable limits
        try:
            df = pd.read_csv(path, nrows=5000)
        except UnicodeDecodeError:
            df = pd.read_csv(path, encoding="latin-1", nrows=5000)

        # Convert dataframe to a readable text format (max 500 display rows)
        display_df = df.head(500)
        rows = [" | ".join(str(v) for v in display_df.columns)]
        rows.append("-" * len(rows[0]))
        for _, row in display_df.iterrows():
            rows.append(" | ".join(str(v) for v in row.values))

        data_text = "\n".join(rows)
        # Statistical summary
        try:
            summary = df.describe(include="all").to_string()
        except Exception:
            summary = "Summary unavailable."

        full_text = f"# CSV Data: {filename}\n\n## Data (Preview)\n{data_text}\n\n## Summary\n{summary}"
        full_text = self._clean_text(full_text)

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": "csv",
            "page_count": None,
            "word_count": len(full_text.split()),
            "row_count": len(df),
            "col_count": len(df.columns),
        }
        return full_text, metadata

    def _parse_xlsx(self, path: str, filename: str) -> Tuple[str, Dict]:
        import pandas as pd

        xls = pd.ExcelFile(path)
        try:
            parts = []
            for sheet_name in xls.sheet_names[:10]:  # Limit to 10 sheets
                df = pd.read_excel(xls, sheet_name=sheet_name, nrows=500)
                rows = [" | ".join(str(v) for v in df.columns)]
                rows.append("-" * len(rows[0]))
                for _, row in df.iterrows():
                    rows.append(" | ".join(str(v) for v in row.values))
                parts.append(f"## Sheet: {sheet_name}\n\n" + "\n".join(rows))

            full_text = f"# Excel File: {filename}\n\n" + "\n\n".join(parts)
            full_text = self._clean_text(full_text)

            metadata = {
                "title": filename,
                "source": filename,
                "file_type": "xlsx",
                "page_count": len(xls.sheet_names),
                "word_count": len(full_text.split()),
            }
            return full_text, metadata
        finally:
            xls.close()

    # ──────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        # Normalize line endings
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        # Remove excessive blank lines (keep max 2)
        text = re.sub(r"\n{3,}", "\n\n", text)
        # Remove null bytes
        text = text.replace("\x00", "")
        return text.strip()
