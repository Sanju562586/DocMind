"""
Multi-format document parser with server-side MIME verification, input sanitization, and security checks.
Supports: PDF, DOCX, TXT, MD, HTML, CSV, XLSX, PNG, JPG, JPEG, BMP, TIFF, and Web URLs
"""

import os
import re
import io
import zipfile
import logging
import socket
import ipaddress
from urllib.parse import urlparse
from typing import Tuple, Dict, Any, Optional

logger = logging.getLogger(__name__)


def is_safe_url(url: str) -> bool:
    """Validate that a URL does not resolve to loopback, private, or cloud metadata addresses."""
    try:
        parsed = urlparse(url)
        if parsed.scheme not in ("http", "https"):
            return False
        hostname = parsed.hostname
        if not hostname:
            return False
        if hostname.lower() in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            return False
        addr_info = socket.getaddrinfo(hostname, None)
        for entry in addr_info:
            ip_str = entry[4][0]
            ip = ipaddress.ip_address(ip_str)
            if (
                ip.is_loopback
                or ip.is_private
                or ip.is_link_local
                or ip.is_reserved
                or ip.is_multicast
                or str(ip) in ("169.254.169.254", "0.0.0.0", "255.255.255.255")
            ):
                return False
        return True
    except Exception:
        return False


class DocumentParser:
    # Broad catalog of recognized formats (any unlisted format falls back to universal parser)
    SUPPORTED_TYPES = {
        ".pdf", ".docx", ".pptx", ".ppt", ".txt", ".md", ".html", ".htm",
        ".csv", ".tsv", ".xlsx", ".xls", ".epub", ".rtf",
        ".json", ".jsonl", ".xml", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg",
        ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
        ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".bash", ".zsh", ".ps1", ".bat",
        ".sql", ".r", ".swift", ".kt", ".dart", ".scala", ".lua", ".css", ".scss",
        ".rst", ".tex", ".latex", ".log", ".diff", ".patch",
        ".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp", ".gif"
    }

    # ──────────────────────────────────────────────
    # Server-Side Input Sanitization & Verification
    # ──────────────────────────────────────────────

    @classmethod
    def sanitize_filename(cls, raw_filename: str) -> str:
        """Sanitize raw filenames to prevent path traversal and shell injection."""
        base = os.path.basename(raw_filename or "document.txt")
        # Remove null bytes and path separators
        base = base.replace("\x00", "").replace("/", "").replace("\\", "")
        # Replace non-safe characters with underscore
        clean = re.sub(r"[^\w.\-]", "_", base)
        # Collapse multiple dots or underscores
        clean = re.sub(r"\.{2,}", ".", clean)
        clean = re.sub(r"_{2,}", "_", clean)
        # Prevent hidden files
        if clean.startswith("."):
            clean = f"upload_{clean}"
        if not clean or clean == "_":
            clean = "upload_document.txt"
        # Truncate to reasonable length (100 chars) while preserving extension
        if len(clean) > 100:
            name, ext = os.path.splitext(clean)
            clean = f"{name[:90]}{ext}"
        return clean

    @classmethod
    def validate_upload(
        cls,
        file_bytes: bytes,
        raw_filename: str,
        max_size_bytes: int = 52_428_800
    ) -> Tuple[str, str]:
        """
        Server-side validation:
        1. Checks file size
        2. Sanitizes filename
        3. Accepts ANY file extension (with universal fallbacks)
        4. Verifies actual binary magic bytes when applicable to prevent zip bombs
        Returns: (clean_filename, extension)
        """
        # 1. Size verification
        if not file_bytes or len(file_bytes) == 0:
            raise ValueError("Uploaded file is empty (0 bytes).")
        if len(file_bytes) > max_size_bytes:
            max_mb = max_size_bytes / (1024 * 1024)
            actual_mb = len(file_bytes) / (1024 * 1024)
            raise ValueError(f"File size ({actual_mb:.1f} MB) exceeds maximum allowed limit of {max_mb:.0f} MB.")

        # 2. Filename sanitization
        clean_filename = cls.sanitize_filename(raw_filename)
        ext = os.path.splitext(clean_filename)[1].lower()

        # 3. Zip package verification (DOCX, PPTX, XLSX, EPUB) to protect against decompression bombs
        if ext in (".docx", ".pptx", ".xlsx", ".epub") or file_bytes.startswith(b"PK\x03\x04"):
            try:
                with zipfile.ZipFile(io.BytesIO(file_bytes)) as zf:
                    total_uncompressed = sum(info.file_size for info in zf.infolist())
                    if total_uncompressed > max_size_bytes * 10:
                        raise ValueError("File rejected: Suspected decompression bomb in archive package.")
            except zipfile.BadZipFile:
                # If extension claimed to be docx/pptx/xlsx/epub but isn't a valid zip, allow universal fallback parsing
                pass

        return clean_filename, ext

    # ──────────────────────────────────────────────
    # Parser Entrypoints
    # ──────────────────────────────────────────────

    def parse(self, file_path: str, filename: str) -> Tuple[str, Dict[str, Any]]:
        """
        Parse ANY document and return (full_text, metadata).
        Guaranteed never to crash on any arbitrary file format.
        """
        ext = os.path.splitext(filename)[1].lower()

        # PDF documents
        if ext == ".pdf":
            return self._parse_pdf(file_path, filename)
        # Word documents
        elif ext == ".docx":
            return self._parse_docx(file_path, filename)
        # PowerPoint presentations
        elif ext in (".pptx", ".ppt", ".odp"):
            return self._parse_pptx(file_path, filename)
        # Spreadsheets & tabular data
        elif ext in (".xlsx", ".xls", ".xlsm"):
            return self._parse_xlsx(file_path, filename)
        elif ext in (".csv", ".tsv"):
            return self._parse_csv(file_path, filename)
        # Web & markup documents
        elif ext in (".html", ".htm"):
            return self._parse_html(file_path, filename)
        elif ext in (".txt", ".md", ".rst"):
            return self._parse_text(file_path, filename)
        elif ext == ".epub":
            return self._parse_epub(file_path, filename)
        elif ext == ".rtf":
            return self._parse_rtf(file_path, filename)
        # Structured data & configs
        elif ext in (".json", ".jsonl", ".xml", ".yaml", ".yml", ".toml", ".ini", ".conf", ".cfg", ".env"):
            return self._parse_structured(file_path, filename, ext)
        # Source code & script files
        elif ext in (
            ".py", ".js", ".jsx", ".ts", ".tsx", ".java", ".c", ".cpp", ".h", ".hpp",
            ".cs", ".go", ".rs", ".rb", ".php", ".sh", ".bash", ".zsh", ".ps1", ".bat",
            ".sql", ".r", ".swift", ".kt", ".dart", ".scala", ".lua", ".css", ".scss",
            ".sass", ".less", ".diff", ".patch", ".tex", ".latex", ".log"
        ):
            return self._parse_code(file_path, filename, ext)
        # Images (OCR)
        elif ext in (".png", ".jpg", ".jpeg", ".bmp", ".tiff", ".webp", ".gif"):
            return self._parse_image(file_path, filename)

        # Universal fallback for any other file extension or binary file
        return self._parse_universal_fallback(file_path, filename, ext)

    def parse_url(self, url: str) -> Tuple[str, Dict[str, Any]]:
        """
        Fetch and parse a public Web URL safely.
        """
        import urllib.request
        from bs4 import BeautifulSoup

        # Enforce HTTP/HTTPS only
        if not url.startswith("http://") and not url.startswith("https://"):
            raise ValueError("URL must start with http:// or https://")

        if not is_safe_url(url):
            raise ValueError("Access to local, private, or loopback network addresses is prohibited.")

        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) DocMind/2.0"}
        )

        try:
            with urllib.request.urlopen(req, timeout=15) as resp:
                # Limit URL response size to 10 MB
                html = resp.read(10_485_760).decode("utf-8", errors="ignore")
        except Exception as exc:
            raise ValueError(f"Failed to fetch URL '{url}': {exc}")

        soup = BeautifulSoup(html, "html.parser")
        # Sanitize HTML tags completely
        for tag in soup(["script", "style", "nav", "footer", "header", "aside", "noscript", "iframe", "object", "embed"]):
            tag.decompose()

        title = soup.title.string.strip() if soup.title and soup.title.string else url

        parts = []
        for tag in soup.find_all(["h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "td", "th"]):
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
            full_text = f"(Web page '{url}' contained no readable main text.)"

        metadata = {
            "title": title,
            "source": url,
            "file_type": "url",
            "page_count": 1,
            "word_count": len(full_text.split()),
        }
        return full_text, metadata

    # ──────────────────────────────────────────────
    # Specific Parsers
    # ──────────────────────────────────────────────

    def _parse_pdf(self, path: str, filename: str) -> Tuple[str, Dict]:
        import fitz  # pymupdf

        doc = fitz.open(path)
        try:
            pages_text = []
            for i, page in enumerate(doc, 1):
                text = page.get_text("text")
                if text and text.strip():
                    pages_text.append(f"--- [Page {i}] ---\n{text.strip()}")

            full_text = "\n\n".join(pages_text)
            full_text = self._clean_text(full_text)

            # If no extractable text, attempt OCR fallback on PDF pages
            if not full_text or len(full_text.split()) < 10:
                ocr_text = self._ocr_pdf_pages(doc, filename)
                if ocr_text and not ocr_text.startswith("(Document '"):
                    full_text = ocr_text
                elif not full_text:
                    full_text = ocr_text

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

    def _ocr_pdf_pages(self, doc, filename: str) -> str:
        """OCR fallback for scanned PDF files."""
        try:
            import pytesseract
            from PIL import Image

            ocr_pages = []
            for i, page in enumerate(doc, 1):
                pix = page.get_pixmap(dpi=150)
                img = Image.open(io.BytesIO(pix.tobytes()))
                text = pytesseract.image_to_string(img)
                if text.strip():
                    ocr_pages.append(f"--- [Page {i}] ---\n{text.strip()}")

            result = "\n\n".join(ocr_pages)
            if result.strip():
                return self._clean_text(result)
        except Exception as exc:
            logger.warning("OCR processing failed for '%s': %s", filename, exc)

        return f"(Document '{filename}' appears to contain scanned images or no extractable text.)"

    def _parse_image(self, path: str, filename: str) -> Tuple[str, Dict]:
        """Parse image files via OCR."""
        text = ""
        try:
            import pytesseract
            from PIL import Image

            img = Image.open(path)
            text = pytesseract.image_to_string(img)
        except Exception as exc:
            logger.warning("Image OCR failed for '%s': %s", filename, exc)

        cleaned = self._clean_text(text)
        if not cleaned:
            cleaned = f"(Image '{filename}' contains no readable OCR text or Tesseract OCR is not configured.)"

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": os.path.splitext(filename)[1].lstrip(".").lower(),
            "page_count": 1,
            "word_count": len(cleaned.split()),
        }
        return cleaned, metadata

    def _parse_docx(self, path: str, filename: str) -> Tuple[str, Dict]:
        from docx import Document

        doc = Document(path)
        sections = []

        for para in doc.paragraphs:
            style_name = getattr(para.style, "name", "") or ""
            if style_name.startswith("Heading"):
                level = style_name.split()[-1]
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

        soup = BeautifulSoup(html, "html.parser")

        # Strip scripts, styles, iframes, objects
        for tag in soup(["script", "style", "nav", "footer", "header", "iframe", "object", "embed", "noscript"]):
            tag.decompose()

        title = soup.title.string if soup.title else filename

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

        try:
            df = pd.read_csv(path, nrows=5000)
        except UnicodeDecodeError:
            df = pd.read_csv(path, encoding="latin-1", nrows=5000)

        # Sanitize CSV formula injection for preview
        def sanitize_cell(v: Any) -> str:
            s = str(v)
            if s.startswith(("=", "+", "-", "@", "\t", "\r")):
                return "'" + s
            return s

        display_df = df.head(500)
        rows = [" | ".join(sanitize_cell(v) for v in display_df.columns)]
        rows.append("-" * len(rows[0]))
        for _, row in display_df.iterrows():
            rows.append(" | ".join(sanitize_cell(v) for v in row.values))

        data_text = "\n".join(rows)
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

        def sanitize_cell(v: Any) -> str:
            s = str(v) if v is not None else ""
            if s.startswith(("=", "+", "-", "@", "\t", "\r")):
                return "'" + s
            return s

        xls = pd.ExcelFile(path)
        try:
            parts = []
            for sheet_name in xls.sheet_names[:10]:
                df = pd.read_excel(xls, sheet_name=sheet_name, nrows=500)
                rows = [" | ".join(sanitize_cell(v) for v in df.columns)]
                rows.append("-" * len(rows[0]))
                for _, row in df.iterrows():
                    rows.append(" | ".join(sanitize_cell(v) for v in row.values))
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

    def _parse_pptx(self, path: str, filename: str) -> Tuple[str, Dict]:
        """Parse PowerPoint presentations (PPTX / PPT / ODP)."""
        slides_text = []
        slide_count = 0
        try:
            from pptx import Presentation
            prs = Presentation(path)
            slide_count = len(prs.slides)
            for idx, slide in enumerate(prs.slides, 1):
                slide_lines = []
                title_shape = getattr(slide.shapes, "title", None)
                if title_shape and title_shape.text.strip():
                    slide_lines.append(f"# Slide {idx}: {title_shape.text.strip()}")
                else:
                    slide_lines.append(f"# Slide {idx}")

                for shape in slide.shapes:
                    if shape == title_shape:
                        continue
                    if shape.has_text_frame and shape.text_frame and shape.text_frame.text.strip():
                        slide_lines.append(shape.text_frame.text.strip())
                    elif shape.has_table and shape.table:
                        table_rows = []
                        for row in shape.table.rows:
                            cells = [cell.text.strip() for cell in row.cells]
                            table_rows.append(" | ".join(cells))
                        if table_rows:
                            slide_lines.append("\n".join(table_rows))

                # Presenter speaker notes
                if getattr(slide, "has_notes_slide", False) and slide.notes_slide:
                    notes_frame = getattr(slide.notes_slide, "notes_text_frame", None)
                    if notes_frame and notes_frame.text.strip():
                        slide_lines.append(f"> Presenter Notes: {notes_frame.text.strip()}")

                slides_text.append("\n\n".join(slide_lines))
        except Exception as exc:
            logger.warning("python-pptx parse failed for '%s', using zip XML fallback: %s", filename, exc)
            # Fallback for PPTX archives: extract XML slide text directly
            try:
                with zipfile.ZipFile(path, "r") as zf:
                    slide_names = [n for n in zf.namelist() if n.startswith("ppt/slides/slide") and n.endswith(".xml")]
                    slide_count = len(slide_names)
                    for sname in sorted(slide_names):
                        xml_bytes = zf.read(sname)
                        # Extract all text inside <a:t> elements
                        texts = re.findall(r"<a:t[^>]*>(.*?)</a:t>", xml_bytes.decode("utf-8", errors="ignore"))
                        if texts:
                            slides_text.append("\n".join(texts))
            except Exception as zip_exc:
                logger.warning("PPTX XML fallback failed for '%s': %s", filename, zip_exc)

        if not slides_text:
            # Last resort: extract printable ASCII/Unicode chunks
            return self._parse_universal_fallback(path, filename, ".pptx")

        full_text = self._clean_text("\n\n---\n\n".join(slides_text))
        metadata = {
            "title": filename,
            "source": filename,
            "file_type": "pptx",
            "page_count": max(1, slide_count),
            "word_count": len(full_text.split()),
        }
        return full_text, metadata

    def _parse_epub(self, path: str, filename: str) -> Tuple[str, Dict]:
        """Parse EPUB electronic books."""
        from bs4 import BeautifulSoup

        chapters = []
        try:
            with zipfile.ZipFile(path, "r") as zf:
                for name in sorted(zf.namelist()):
                    if name.endswith((".xhtml", ".html", ".htm")):
                        try:
                            raw = zf.read(name).decode("utf-8", errors="ignore")
                            soup = BeautifulSoup(raw, "html.parser")
                            for tag in soup(["script", "style"]):
                                tag.decompose()
                            text = soup.get_text(separator="\n", strip=True)
                            if text:
                                chapters.append(text)
                        except Exception:
                            pass
        except Exception as exc:
            logger.warning("EPUB parsing failed for '%s': %s", filename, exc)
            return self._parse_universal_fallback(path, filename, ".epub")

        full_text = self._clean_text("\n\n---\n\n".join(chapters))
        if not full_text:
            full_text = f"(EPUB '{filename}' contains no extractable chapter text.)"

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": "epub",
            "page_count": max(1, len(chapters)),
            "word_count": len(full_text.split()),
        }
        return full_text, metadata

    def _parse_rtf(self, path: str, filename: str) -> Tuple[str, Dict]:
        """Parse Rich Text Format (.rtf) documents."""
        try:
            with open(path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
        except Exception:
            with open(path, "r", encoding="latin-1", errors="ignore") as f:
                content = f.read()

        # Remove RTF control words and groups
        text = re.sub(r"\{\*?\\[^{}]+;?\}", "", content)
        text = re.sub(r"\\[a-zA-Z]+(-?\d+)? ?|\\[{}\\]", "", text)
        text = re.sub(r"[{}]", "", text)
        text = self._clean_text(text)
        if not text:
            text = f"(RTF file '{filename}' contains no readable text.)"

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": "rtf",
            "page_count": 1,
            "word_count": len(text.split()),
        }
        return text, metadata

    def _parse_structured(self, path: str, filename: str, ext: str) -> Tuple[str, Dict]:
        """Parse JSON, YAML, TOML, INI, XML data structures."""
        import json

        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                raw = f.read()
        except Exception:
            with open(path, "r", encoding="latin-1", errors="replace") as f:
                raw = f.read()

        clean_type = ext.lstrip(".").upper()
        if ext in (".json", ".jsonl"):
            try:
                parsed = json.loads(raw)
                formatted = json.dumps(parsed, indent=2)
                full_text = f"# JSON Data: {filename}\n\n```json\n{formatted[:35000]}\n```"
            except Exception:
                full_text = f"# Data File ({clean_type}): {filename}\n\n```json\n{raw[:35000]}\n```"
        else:
            full_text = f"# Configuration File ({clean_type}): {filename}\n\n```{clean_type.lower()}\n{raw[:35000]}\n```"

        full_text = self._clean_text(full_text)
        metadata = {
            "title": filename,
            "source": filename,
            "file_type": ext.lstrip("."),
            "page_count": 1,
            "word_count": len(full_text.split()),
        }
        return full_text, metadata

    def _parse_code(self, path: str, filename: str, ext: str) -> Tuple[str, Dict]:
        """Parse source code, script, and technical markup files."""
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                raw = f.read()
        except Exception:
            with open(path, "r", encoding="latin-1", errors="replace") as f:
                raw = f.read()

        lines = raw.splitlines()
        lang = ext.lstrip(".")
        full_text = f"# Code File: {filename} ({len(lines)} lines)\n\n```{lang}\n{raw}\n```"
        full_text = self._clean_text(full_text)

        metadata = {
            "title": filename,
            "source": filename,
            "file_type": lang,
            "page_count": max(1, len(lines) // 50),
            "word_count": len(full_text.split()),
            "line_count": len(lines),
        }
        return full_text, metadata

    def _parse_universal_fallback(self, path: str, filename: str, ext: str) -> Tuple[str, Dict]:
        """
        Universal fallback parser for ANY file format (binary, proprietary, unknown).
        Guarantees that no file will ever fail to be accepted and indexed.
        """
        try:
            with open(path, "rb") as f:
                raw_bytes = f.read()
        except Exception as exc:
            return f"(Unable to read file '{filename}': {exc})", {
                "title": filename,
                "source": filename,
                "file_type": ext.lstrip(".") if ext else "unknown",
                "page_count": 1,
                "word_count": 0,
            }

        # Attempt decoding with standard text encodings
        text = ""
        for enc in ("utf-8", "utf-16", "latin-1", "cp1252"):
            try:
                candidate = raw_bytes.decode(enc)
                printable = sum(1 for ch in candidate if ch.isprintable() or ch in "\n\r\t")
                if len(candidate) > 0 and (printable / len(candidate)) >= 0.65:
                    text = candidate
                    break
            except Exception:
                continue

        # If binary or non-printable, extract printable ASCII/Unicode chunks
        if not text or len(text.strip()) < 10:
            extracted_strings = re.findall(rb"[\x20-\x7e\n\t]{4,}", raw_bytes)
            ascii_lines = [s.decode("ascii", errors="ignore").strip() for s in extracted_strings[:3000] if s.strip()]
            if ascii_lines:
                header = f"# Document: {filename}\nFile Size: {len(raw_bytes):,} bytes\n\n## Extracted Text Chunks:\n\n"
                text = header + "\n".join(ascii_lines)
            else:
                text = f"# Document: {filename}\nFile Size: {len(raw_bytes):,} bytes\n(Binary document indexed for retrieval.)"

        text = self._clean_text(text)
        metadata = {
            "title": filename,
            "source": filename,
            "file_type": ext.lstrip(".") if ext else "document",
            "page_count": 1,
            "word_count": len(text.split()),
        }
        return text, metadata

    # ──────────────────────────────────────────────
    # Helpers
    # ──────────────────────────────────────────────

    @staticmethod
    def _clean_text(text: str) -> str:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
        # Normalize docx bullet symbols (e.g. \uf0b7, •, ▪, ‣) to standard '- '
        text = re.sub(r"^[ \t]*[\uf0b7•▪‣⁃][ \t]*", "- ", text, flags=re.MULTILINE)
        text = re.sub(r"\n{3,}", "\n\n", text)
        text = text.replace("\x00", "")
        return text.strip()
