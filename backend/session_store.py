import sqlite3
import uuid
import os
import json
from datetime import datetime
from typing import List, Dict, Optional, Any
from contextlib import contextmanager
import logging

logger = logging.getLogger(__name__)


class SessionStore:
    def __init__(self, db_path: str = "./data/summarizer.db"):
        self.db_path = db_path

    def initialize(self):
        """Create or migrate tables if they don't exist."""
        os.makedirs(os.path.dirname(self.db_path), exist_ok=True)
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    title TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    updated_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS documents (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    filename TEXT NOT NULL,
                    chunk_count INTEGER DEFAULT 0,
                    char_count INTEGER DEFAULT 0,
                    word_count INTEGER DEFAULT 0,
                    file_type TEXT,
                    file_path TEXT,
                    status TEXT DEFAULT 'ready',
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    sources_json TEXT,
                    memory_json TEXT,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE TABLE IF NOT EXISTS global_memory (
                    id TEXT PRIMARY KEY,
                    session_id TEXT NOT NULL,
                    session_title TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );

                CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
                CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_memory_session ON global_memory(session_id);
            """)
            try:
                conn.execute("ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'ready'")
            except sqlite3.OperationalError:
                pass
        logger.info("Database initialized with session-scoped documents and global memory at %s", self.db_path)

    @contextmanager
    def _conn(self):
        conn = sqlite3.connect(self.db_path, timeout=15.0)
        conn.row_factory = sqlite3.Row
        conn.execute("PRAGMA foreign_keys = ON")
        try:
            yield conn
            conn.commit()
        except Exception:
            conn.rollback()
            raise
        finally:
            conn.close()

    # ──────────────────────────────────────────────
    # Sessions
    # ──────────────────────────────────────────────

    def create_session(self, title: str = "New Conversation") -> str:
        session_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO sessions (id, title) VALUES (?, ?)",
                (session_id, title),
            )
        return session_id

    def get_session(self, session_id: str) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM sessions WHERE id = ?",
                (session_id,),
            ).fetchone()
            if not row:
                return None
            session = dict(row)
            doc_rows = conn.execute(
                "SELECT * FROM documents WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,)
            ).fetchall()
            session["documents"] = [dict(d) for d in doc_rows]
            msg_count = conn.execute(
                "SELECT COUNT(*) as count FROM messages WHERE session_id = ?",
                (session_id,)
            ).fetchone()
            session["message_count"] = msg_count["count"] if msg_count else 0
        return session

    def list_sessions(self) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute(
                """SELECT s.*,
                          (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
                   FROM sessions s
                   ORDER BY s.updated_at DESC""",
            ).fetchall()
            sessions = []
            for r in rows:
                s = dict(r)
                doc_rows = conn.execute(
                    "SELECT * FROM documents WHERE session_id = ? ORDER BY created_at ASC",
                    (s["id"],)
                ).fetchall()
                s["documents"] = [dict(d) for d in doc_rows]
                sessions.append(s)
        return sessions

    def update_session_title(self, session_id: str, title: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
                (title, session_id),
            )

    def delete_session(self, session_id: str):
        with self._conn() as conn:
            conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def touch_session(self, session_id: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
                (session_id,),
            )

    # ──────────────────────────────────────────────
    # Documents (Session Scoped)
    # ──────────────────────────────────────────────

    def save_document(
        self,
        doc_id: str,
        session_id: str,
        filename: str,
        chunk_count: int = 0,
        char_count: int = 0,
        word_count: int = 0,
        file_type: str = "",
        file_path: str = "",
        status: str = "processing"
    ):
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO documents (id, session_id, filename, chunk_count, char_count, word_count, file_type, file_path, status)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, session_id, filename, chunk_count, char_count, word_count, file_type, file_path, status),
            )
        self.touch_session(session_id)

    def update_document_processed(
        self,
        doc_id: str,
        chunk_count: int,
        char_count: int,
        word_count: int,
        status: str = "ready"
    ):
        with self._conn() as conn:
            conn.execute(
                """UPDATE documents 
                   SET chunk_count = ?, char_count = ?, word_count = ?, status = ?
                   WHERE id = ?""",
                (chunk_count, char_count, word_count, status, doc_id),
            )

    def list_session_documents(self, session_id: str) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,)
            ).fetchall()
        return [dict(r) for r in rows]

    def get_document(self, doc_id: str) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM documents WHERE id = ?", (doc_id,)
            ).fetchone()
        return dict(row) if row else None

    def delete_document(self, doc_id: str) -> Optional[str]:
        with self._conn() as conn:
            doc = conn.execute("SELECT session_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return None
            session_id = doc["session_id"]
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        return session_id

    # ──────────────────────────────────────────────
    # Messages
    # ──────────────────────────────────────────────

    def save_message(
        self,
        session_id: str,
        role: str,
        content: str,
        sources: Optional[List[Dict]] = None,
        memory_recalled: Optional[List[Dict]] = None
    ) -> str:
        msg_id = str(uuid.uuid4())
        sources_json = json.dumps(sources) if sources else None
        memory_json = json.dumps(memory_recalled) if memory_recalled else None
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO messages (id, session_id, role, content, sources_json, memory_json)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (msg_id, session_id, role, content, sources_json, memory_json),
            )
        self.touch_session(session_id)
        return msg_id

    def get_messages(self, session_id: str) -> List[Dict]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM messages WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,),
            ).fetchall()
        results = []
        for r in rows:
            m = dict(r)
            m["sources"] = json.loads(m["sources_json"]) if m.get("sources_json") else []
            m["memory_recalled"] = json.loads(m["memory_json"]) if m.get("memory_json") else []
            results.append(m)
        return results

    # ──────────────────────────────────────────────
    # Global Cross-Session Memory
    # ──────────────────────────────────────────────

    def save_global_memory(self, session_id: str, session_title: str, role: str, content: str):
        """Save a conversation turn to global memory for cross-chat recall."""
        # Only save meaningful turns (> 15 chars)
        if len(content.strip()) < 15:
            return
        mem_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO global_memory (id, session_id, session_title, role, content)
                   VALUES (?, ?, ?, ?, ?)""",
                (mem_id, session_id, session_title, role, content),
            )

    def get_all_global_memories(self, exclude_session_id: Optional[str] = None) -> List[Dict]:
        """Retrieve all memories from other sessions for indexing and cross-chat recall."""
        with self._conn() as conn:
            if exclude_session_id:
                rows = conn.execute(
                    """SELECT * FROM global_memory 
                       WHERE session_id != ? 
                       ORDER BY created_at DESC 
                       LIMIT 500""",
                    (exclude_session_id,),
                ).fetchall()
            else:
                rows = conn.execute(
                    """SELECT * FROM global_memory 
                       ORDER BY created_at DESC 
                       LIMIT 500"""
                ).fetchall()
        return [dict(r) for r in rows]

    def delete_all_sessions(self):
        """Delete all sessions and cascade to all related records."""
        with self._conn() as conn:
            conn.execute("DELETE FROM sessions")

    def get_stats(self) -> Dict[str, Any]:
        """Aggregate global statistics across the platform."""
        with self._conn() as conn:
            sess_count = conn.execute("SELECT COUNT(*) as c FROM sessions").fetchone()["c"]
            doc_count = conn.execute("SELECT COUNT(*) as c FROM documents").fetchone()["c"]
            msg_count = conn.execute("SELECT COUNT(*) as c FROM messages").fetchone()["c"]
            mem_count = conn.execute("SELECT COUNT(*) as c FROM global_memory").fetchone()["c"]
            total_words = conn.execute("SELECT COALESCE(SUM(word_count), 0) as s FROM documents").fetchone()["s"]
            total_chunks = conn.execute("SELECT COALESCE(SUM(chunk_count), 0) as s FROM documents").fetchone()["s"]
        return {
            "total_sessions": sess_count,
            "total_documents": doc_count,
            "total_messages": msg_count,
            "total_memory_items": mem_count,
            "total_words_indexed": total_words,
            "total_chunks_indexed": total_chunks,
        }

    def delete_global_memory(self, memory_id: str):
        """Delete a single memory item."""
        with self._conn() as conn:
            conn.execute("DELETE FROM global_memory WHERE id = ?", (memory_id,))

    def clear_all_global_memory(self):
        """Clear all global cross-session memories."""
        with self._conn() as conn:
            conn.execute("DELETE FROM global_memory")
