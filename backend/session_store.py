"""
Session & Chat History Persistence Store
────────────────────────────────────────
Supports dual storage engines:
1. PostgreSQL (production cloud/container deployment via DATABASE_URL with connection pooling)
2. SQLite with WAL mode (local zero-setup developer experience and fallback)

Includes:
• Multi-tenant user-isolated sessions
• Complete chat history persistence & message recall
• Global cross-session semantic memory
• Public shareable chat links & read-only access
• User account profile synchronization (Google, GitHub, Credentials)
"""

import os
import json
import uuid
import secrets
import logging
from datetime import datetime
from typing import List, Dict, Optional, Any, Tuple
from contextlib import contextmanager

logger = logging.getLogger(__name__)

# Optional psycopg2 import for PostgreSQL
_HAVE_PSYCOPG2 = False
try:
    import psycopg2
    from psycopg2 import pool
    from psycopg2.extras import RealDictCursor
    _HAVE_PSYCOPG2 = True
except ImportError:
    pass

import sqlite3


class _DBConnectionWrapper:
    """Provides a unified execution interface over SQLite and PostgreSQL connections."""

    def __init__(self, raw_conn, is_postgres: bool):
        self._raw_conn = raw_conn
        self.is_postgres = is_postgres

    def execute(self, sql: str, params: tuple = ()):
        if self.is_postgres:
            pg_sql = sql.replace("?", "%s")
            # Replace SQLite datetime functions with standard PostgreSQL functions
            pg_sql = pg_sql.replace("datetime('now')", "CURRENT_TIMESTAMP")
            if "is_shared = 1" in pg_sql:
                pg_sql = pg_sql.replace("is_shared = 1", "is_shared = TRUE")
            elif "is_shared = 0" in pg_sql:
                pg_sql = pg_sql.replace("is_shared = 0", "is_shared = FALSE")

            cur = self._raw_conn.cursor(cursor_factory=RealDictCursor)
            cur.execute(pg_sql, params)
            return cur
        else:
            return self._raw_conn.execute(sql, params)

    def executescript(self, sql: str):
        if self.is_postgres:
            pg_sql = sql.replace("datetime('now')", "CURRENT_TIMESTAMP")
            cur = self._raw_conn.cursor()
            cur.execute(pg_sql)
            cur.close()
        else:
            self._raw_conn.executescript(sql)


class SessionStore:
    def __init__(self, db_path: str = "./data/summarizer.db", database_url: Optional[str] = None):
        self.db_path = db_path
        self.database_url = database_url
        self.is_postgres = False
        self._pg_pool = None

        if self.database_url and (
            self.database_url.startswith("postgres://") or self.database_url.startswith("postgresql://")
        ):
            if not _HAVE_PSYCOPG2:
                logger.warning("psycopg2 is not installed. Falling back to SQLite engine at %s", self.db_path)
            else:
                self.is_postgres = True
                # Normalize postgres:// to postgresql:// for compatibility
                normalized_url = self.database_url
                if normalized_url.startswith("postgres://"):
                    normalized_url = "postgresql://" + normalized_url[len("postgres://"):]
                try:
                    self._pg_pool = pool.ThreadedConnectionPool(minconn=1, maxconn=20, dsn=normalized_url)
                    logger.info("SessionStore: Connected to PostgreSQL connection pool [OK]")
                except Exception as exc:
                    logger.error("Failed to connect to PostgreSQL: %s. Falling back to SQLite at %s", exc, self.db_path)
                    self.is_postgres = False
                    self._pg_pool = None

    def initialize(self):
        """Create or migrate tables across PostgreSQL or SQLite."""
        if self.is_postgres:
            self._init_postgres()
        else:
            self._init_sqlite()

    def _init_sqlite(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT UNIQUE NOT NULL,
                    name TEXT,
                    image TEXT,
                    provider TEXT DEFAULT 'credentials',
                    created_at TEXT DEFAULT (datetime('now')),
                    last_login_at TEXT DEFAULT (datetime('now'))
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id TEXT DEFAULT 'default_user',
                    title TEXT NOT NULL,
                    is_shared INTEGER DEFAULT 0,
                    share_token TEXT UNIQUE,
                    shared_at TEXT,
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
                    error_message TEXT,
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
                    user_id TEXT DEFAULT 'default_user',
                    session_id TEXT NOT NULL,
                    session_title TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    created_at TEXT DEFAULT (datetime('now')),
                    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
                );
            """)

            # Safe migrations for existing SQLite databases
            for col_sql in [
                "ALTER TABLE documents ADD COLUMN status TEXT DEFAULT 'ready'",
                "ALTER TABLE documents ADD COLUMN error_message TEXT",
                "ALTER TABLE sessions ADD COLUMN user_id TEXT DEFAULT 'default_user'",
                "ALTER TABLE sessions ADD COLUMN is_shared INTEGER DEFAULT 0",
                "ALTER TABLE sessions ADD COLUMN share_token TEXT",
                "ALTER TABLE sessions ADD COLUMN shared_at TEXT",
                "ALTER TABLE global_memory ADD COLUMN user_id TEXT DEFAULT 'default_user'",
            ]:
                try:
                    conn.execute(col_sql)
                except Exception:
                    pass

            conn.executescript("""
                CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
                CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sessions_share ON sessions(share_token);
                CREATE INDEX IF NOT EXISTS idx_memory_session ON global_memory(session_id);
                CREATE INDEX IF NOT EXISTS idx_memory_user ON global_memory(user_id);
            """)

        logger.info("SQLite database initialized at %s [OK]", self.db_path)

    def _init_postgres(self):
        with self._conn() as conn:
            conn.executescript("""
                CREATE TABLE IF NOT EXISTS users (
                    id VARCHAR(128) PRIMARY KEY,
                    email VARCHAR(255) UNIQUE NOT NULL,
                    name VARCHAR(255),
                    image VARCHAR(512),
                    provider VARCHAR(64) DEFAULT 'credentials',
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    last_login_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS sessions (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(128) DEFAULT 'default_user',
                    title VARCHAR(255) NOT NULL,
                    is_shared BOOLEAN DEFAULT FALSE,
                    share_token VARCHAR(64) UNIQUE,
                    shared_at TIMESTAMP WITH TIME ZONE,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS documents (
                    id VARCHAR(64) PRIMARY KEY,
                    session_id VARCHAR(64) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    filename VARCHAR(255) NOT NULL,
                    chunk_count INT DEFAULT 0,
                    char_count INT DEFAULT 0,
                    word_count INT DEFAULT 0,
                    file_type VARCHAR(64),
                    file_path TEXT,
                    status VARCHAR(64) DEFAULT 'ready',
                    error_message TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS messages (
                    id VARCHAR(64) PRIMARY KEY,
                    session_id VARCHAR(64) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    role VARCHAR(32) NOT NULL CHECK(role IN ('user', 'assistant', 'system')),
                    content TEXT NOT NULL,
                    sources_json TEXT,
                    memory_json TEXT,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE TABLE IF NOT EXISTS global_memory (
                    id VARCHAR(64) PRIMARY KEY,
                    user_id VARCHAR(128) DEFAULT 'default_user',
                    session_id VARCHAR(64) NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
                    session_title VARCHAR(255) NOT NULL,
                    role VARCHAR(32) NOT NULL,
                    content TEXT NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
                );

                CREATE INDEX IF NOT EXISTS idx_documents_session ON documents(session_id);
                CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id);
                CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id, updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_sessions_share ON sessions(share_token);
                CREATE INDEX IF NOT EXISTS idx_memory_session ON global_memory(session_id);
                CREATE INDEX IF NOT EXISTS idx_memory_user ON global_memory(user_id);
            """)

            # Safe migrations for existing PostgreSQL databases
            for col_sql in [
                "ALTER TABLE documents ADD COLUMN IF NOT EXISTS status VARCHAR(64) DEFAULT 'ready'",
                "ALTER TABLE documents ADD COLUMN IF NOT EXISTS error_message TEXT",
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR(128) DEFAULT 'default_user'",
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS is_shared BOOLEAN DEFAULT FALSE",
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS share_token VARCHAR(64) UNIQUE",
                "ALTER TABLE sessions ADD COLUMN IF NOT EXISTS shared_at TIMESTAMP WITH TIME ZONE",
                "ALTER TABLE global_memory ADD COLUMN IF NOT EXISTS user_id VARCHAR(128) DEFAULT 'default_user'",
            ]:
                try:
                    conn.execute(col_sql)
                except Exception:
                    pass

        logger.info("PostgreSQL database tables and indexes initialized [OK]")

    @contextmanager
    def _conn(self):
        if self.is_postgres and self._pg_pool:
            pg_conn = self._pg_pool.getconn()
            wrapper = _DBConnectionWrapper(pg_conn, is_postgres=True)
            try:
                yield wrapper
                pg_conn.commit()
            except Exception:
                pg_conn.rollback()
                raise
            finally:
                self._pg_pool.putconn(pg_conn)
        else:
            sq_conn = sqlite3.connect(self.db_path, timeout=15.0)
            sq_conn.row_factory = sqlite3.Row
            sq_conn.execute("PRAGMA journal_mode = WAL")
            sq_conn.execute("PRAGMA synchronous = NORMAL")
            sq_conn.execute("PRAGMA busy_timeout = 15000")
            sq_conn.execute("PRAGMA foreign_keys = ON")
            wrapper = _DBConnectionWrapper(sq_conn, is_postgres=False)
            try:
                yield wrapper
                sq_conn.commit()
            except Exception:
                sq_conn.rollback()
                raise
            finally:
                sq_conn.close()

    def close(self):
        """Cleanly close connection pools on application shutdown."""
        if self._pg_pool:
            self._pg_pool.closeall()
            logger.info("PostgreSQL connection pool closed successfully")

    @staticmethod
    def _format_doc(row: Any) -> Dict[str, Any]:
        if not row:
            return {}
        d = dict(row)
        d["doc_id"] = d.get("id", "")
        d["error_message"] = d.get("error_message")
        return d

    @staticmethod
    def _user_filter(user_id: Optional[str], col: str = "user_id") -> Tuple[str, List[Any]]:
        if not user_id:
            return "1=1", []
        if user_id == "default_user":
            return f"({col} = ? OR {col} IS NULL)", [user_id]
        # Authenticated users also see unassigned legacy / default_user sessions
        return f"({col} = ? OR {col} = 'default_user' OR {col} IS NULL)", [user_id]

    def claim_legacy_sessions(self, target_user_id: str) -> int:
        """
        Migrate unassigned legacy sessions (user_id = 'default_user' or NULL)
        to the authenticated user so they persist under their profile.
        """
        if not target_user_id or target_user_id == "default_user":
            return 0
        with self._conn() as conn:
            cur = conn.execute(
                "UPDATE sessions SET user_id = ?, updated_at = datetime('now') WHERE user_id = 'default_user' OR user_id IS NULL",
                (target_user_id,),
            )
            try:
                conn.execute(
                    "UPDATE global_memory SET user_id = ? WHERE user_id = 'default_user' OR user_id IS NULL",
                    (target_user_id,),
                )
            except Exception:
                pass
            return cur.rowcount if hasattr(cur, "rowcount") else 0

    # ──────────────────────────────────────────────
    # Users (Google, GitHub, Credentials)
    # ──────────────────────────────────────────────

    def upsert_user(
        self,
        user_id: str,
        email: str,
        name: Optional[str] = None,
        image: Optional[str] = None,
        provider: str = "credentials",
    ) -> Dict[str, Any]:
        """Insert or update user record when authenticated."""
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO users (id, email, name, image, provider, last_login_at)
                   VALUES (?, ?, ?, ?, ?, datetime('now'))
                   ON CONFLICT(id) DO UPDATE SET
                       email = excluded.email,
                       name = excluded.name,
                       image = excluded.image,
                       provider = excluded.provider,
                       last_login_at = datetime('now')""",
                (user_id, email, name or email.split("@")[0], image or "👤", provider),
            )
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else {"id": user_id, "email": email, "name": name}

    def get_user(self, user_id: str) -> Optional[Dict[str, Any]]:
        with self._conn() as conn:
            row = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            return dict(row) if row else None

    # ──────────────────────────────────────────────
    # Sessions
    # ──────────────────────────────────────────────

    def create_session(self, title: str = "New Conversation", user_id: str = "default_user") -> str:
        session_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)",
                (session_id, user_id or "default_user", title),
            )
        return session_id

    def ensure_session(self, session_id: str, title: str = "New Conversation", user_id: str = "default_user") -> None:
        """Create session if it does not exist already (idempotent recovery after restarts)."""
        with self._conn() as conn:
            existing = conn.execute("SELECT id FROM sessions WHERE id = ?", (session_id,)).fetchone()
            if not existing:
                conn.execute(
                    "INSERT INTO sessions (id, user_id, title) VALUES (?, ?, ?)",
                    (session_id, user_id or "default_user", title),
                )

    def get_session(self, session_id: str, user_id: Optional[str] = None) -> Optional[Dict]:
        try:
            self.cleanup_stuck_documents(max_age_seconds=300)
        except Exception as exc:
            logger.debug("Non-critical stuck document cleanup notice in get_session: %s", exc)

        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                row = conn.execute(
                    f"SELECT * FROM sessions WHERE id = ? AND {clause}",
                    (session_id, *p),
                ).fetchone()
            else:
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
            session["documents"] = [self._format_doc(d) for d in doc_rows]
            msg_count = conn.execute(
                "SELECT COUNT(*) as count FROM messages WHERE session_id = ?",
                (session_id,)
            ).fetchone()
            session["message_count"] = msg_count["count"] if msg_count else 0
            session["is_shared"] = bool(session.get("is_shared", False))
        return session

    def list_sessions(self, user_id: Optional[str] = None) -> List[Dict]:
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "s.user_id")
                rows = conn.execute(
                    f"""SELECT s.*,
                              (SELECT COUNT(*) FROM messages m WHERE m.session_id = s.id) as message_count
                       FROM sessions s
                       WHERE {clause}
                       ORDER BY s.updated_at DESC""",
                    tuple(p),
                ).fetchall()
            else:
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
                s["documents"] = [self._format_doc(d) for d in doc_rows]
                s["is_shared"] = bool(s.get("is_shared", False))
                sessions.append(s)
        return sessions

    def update_session_title(self, session_id: str, title: str, user_id: Optional[str] = None):
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(
                    f"UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ? AND {clause}",
                    (title, session_id, *p),
                )
            else:
                conn.execute(
                    "UPDATE sessions SET title = ?, updated_at = datetime('now') WHERE id = ?",
                    (title, session_id),
                )

    def delete_session(self, session_id: str, user_id: Optional[str] = None):
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(f"DELETE FROM sessions WHERE id = ? AND {clause}", (session_id, *p))
            else:
                conn.execute("DELETE FROM sessions WHERE id = ?", (session_id,))

    def touch_session(self, session_id: str):
        with self._conn() as conn:
            conn.execute(
                "UPDATE sessions SET updated_at = datetime('now') WHERE id = ?",
                (session_id,),
            )

    # ──────────────────────────────────────────────
    # Shareable Chat Links
    # ──────────────────────────────────────────────

    def create_share_link(self, session_id: str, user_id: Optional[str] = None) -> Tuple[str, str]:
        """
        Generate or retrieve a unique, secure URL-safe share token for a chat session.
        Returns (share_token, shared_at).
        """
        share_token = secrets.token_urlsafe(16)
        now_str = datetime.utcnow().isoformat() + "Z"
        with self._conn() as conn:
            # Check existing share_token first
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                row = conn.execute(
                    f"SELECT is_shared, share_token, shared_at FROM sessions WHERE id = ? AND {clause}",
                    (session_id, *p),
                ).fetchone()
            else:
                row = conn.execute(
                    "SELECT is_shared, share_token, shared_at FROM sessions WHERE id = ?",
                    (session_id,),
                ).fetchone()

            if not row:
                raise ValueError("Session not found or access unauthorized")

            curr = dict(row)
            if curr.get("is_shared") and curr.get("share_token"):
                return curr["share_token"], str(curr.get("shared_at") or now_str)

            # Update session with active share token
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(
                    f"""UPDATE sessions 
                       SET is_shared = 1, share_token = ?, shared_at = datetime('now')
                       WHERE id = ? AND {clause}""",
                    (share_token, session_id, *p),
                )
            else:
                conn.execute(
                    """UPDATE sessions 
                       SET is_shared = 1, share_token = ?, shared_at = datetime('now')
                       WHERE id = ?""",
                    (share_token, session_id),
                )

        return share_token, now_str

    def revoke_share_link(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Revoke public share link for a conversation."""
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(
                    f"""UPDATE sessions 
                       SET is_shared = 0, share_token = NULL, shared_at = NULL 
                       WHERE id = ? AND {clause}""",
                    (session_id, *p),
                )
            else:
                conn.execute(
                    """UPDATE sessions 
                       SET is_shared = 0, share_token = NULL, shared_at = NULL 
                       WHERE id = ?""",
                    (session_id,),
                )
        return True

    def get_shared_session(self, share_token: str) -> Optional[Dict[str, Any]]:
        """
        Public resolver for shared chat transcripts.
        Returns sanitised conversation without private user identity.
        """
        if not share_token or len(share_token.strip()) < 8:
            return None

        with self._conn() as conn:
            row = conn.execute(
                "SELECT id, title, created_at, updated_at, shared_at, is_shared FROM sessions WHERE share_token = ? AND is_shared = 1",
                (share_token.strip(),),
            ).fetchone()

            if not row:
                return None

            sess = dict(row)
            session_id = sess["id"]

            doc_rows = conn.execute(
                """SELECT id, filename, chunk_count, word_count, file_type, status, created_at 
                   FROM documents WHERE session_id = ? ORDER BY created_at ASC""",
                (session_id,)
            ).fetchall()

            msg_rows = conn.execute(
                """SELECT id, role, content, sources_json, memory_json, created_at 
                   FROM messages WHERE session_id = ? ORDER BY created_at ASC""",
                (session_id,)
            ).fetchall()

            messages = []
            for r in msg_rows:
                m = dict(r)
                m["sources"] = json.loads(m["sources_json"]) if m.get("sources_json") else []
                m["memory_recalled"] = json.loads(m["memory_json"]) if m.get("memory_json") else []
                m.pop("sources_json", None)
                m.pop("memory_json", None)
                messages.append(m)

            return {
                "session_id": session_id,
                "title": sess["title"],
                "created_at": str(sess["created_at"]),
                "shared_at": str(sess.get("shared_at") or sess["created_at"]),
                "documents": [dict(d) for d in doc_rows],
                "messages": messages,
                "is_shared": True,
            }

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
        status: str = "processing",
        error_message: Optional[str] = None,
    ):
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO documents (id, session_id, filename, chunk_count, char_count, word_count, file_type, file_path, status, error_message)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (doc_id, session_id, filename, chunk_count, char_count, word_count, file_type, file_path, status, error_message),
            )
        self.touch_session(session_id)

    def update_document_processed(
        self,
        doc_id: str,
        chunk_count: int,
        char_count: int,
        word_count: int,
        status: str = "ready",
        error_message: Optional[str] = None,
    ):
        with self._conn() as conn:
            conn.execute(
                """UPDATE documents 
                   SET chunk_count = ?, char_count = ?, word_count = ?, status = ?, error_message = ?
                   WHERE id = ?""",
                (chunk_count, char_count, word_count, status, error_message, doc_id),
            )

    def update_document_status(
        self,
        doc_id: str,
        status: str,
        error_message: Optional[str] = None,
    ):
        with self._conn() as conn:
            conn.execute(
                """UPDATE documents 
                   SET status = ?, error_message = ?
                   WHERE id = ?""",
                (status, error_message, doc_id),
            )

    def get_stuck_documents(self) -> List[Dict[str, Any]]:
        """Return all documents currently in 'processing' state."""
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE status = 'processing'"
            ).fetchall()
        return [self._format_doc(r) for r in rows]

    def cleanup_stuck_documents(self, max_age_seconds: int = 300) -> int:
        """
        Mark any document stuck in 'processing' longer than max_age_seconds as 'error'.
        Prevents abandoned background jobs from hanging the UI indefinitely.
        """
        count = 0
        now = datetime.utcnow()
        with self._conn() as conn:
            rows = conn.execute("SELECT id, created_at FROM documents WHERE status = 'processing'").fetchall()
            for r in rows:
                doc_id = r["id"]
                c_at_str = str(r["created_at"]) if r["created_at"] else ""
                should_timeout = False
                if c_at_str:
                    try:
                        clean_str = c_at_str.replace("T", " ").split(".")[0].split("+")[0].strip()
                        c_time = datetime.strptime(clean_str, "%Y-%m-%d %H:%M:%S")
                        if (now - c_time).total_seconds() > max_age_seconds:
                            should_timeout = True
                    except Exception:
                        should_timeout = True
                else:
                    should_timeout = True

                if should_timeout:
                    conn.execute(
                        "UPDATE documents SET status = 'error', error_message = 'Document processing timed out. Click Retry to reprocess.' WHERE id = ?",
                        (doc_id,),
                    )
                    count += 1
                    logger.warning("Document %s was stuck in 'processing' for >%ds; transitioned to 'error'", doc_id, max_age_seconds)
        return count

    def list_session_documents(self, session_id: str) -> List[Dict]:
        try:
            self.cleanup_stuck_documents(max_age_seconds=300)
        except Exception as exc:
            logger.debug("Non-critical stuck document cleanup notice in list_session_documents: %s", exc)

        with self._conn() as conn:
            rows = conn.execute(
                "SELECT * FROM documents WHERE session_id = ? ORDER BY created_at ASC",
                (session_id,)
            ).fetchall()
        return [self._format_doc(r) for r in rows]

    def get_document(self, doc_id: str) -> Optional[Dict]:
        with self._conn() as conn:
            row = conn.execute(
                "SELECT * FROM documents WHERE id = ?", (doc_id,)
            ).fetchone()
        return self._format_doc(row) if row else None

    def delete_document(self, doc_id: str) -> Optional[str]:
        with self._conn() as conn:
            doc = conn.execute("SELECT session_id FROM documents WHERE id = ?", (doc_id,)).fetchone()
            if not doc:
                return None
            session_id = doc["session_id"]
            conn.execute("DELETE FROM documents WHERE id = ?", (doc_id,))
        self.touch_session(session_id)
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
    # Global Cross-Session Memory (User-Isolated)
    # ──────────────────────────────────────────────

    def save_global_memory(
        self,
        session_id: str,
        session_title: str,
        role: str,
        content: str,
        user_id: str = "default_user"
    ):
        """Save a conversation turn to global memory for user-scoped cross-chat recall."""
        if len(content.strip()) < 15:
            return
        mem_id = str(uuid.uuid4())
        with self._conn() as conn:
            conn.execute(
                """INSERT INTO global_memory (id, user_id, session_id, session_title, role, content)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (mem_id, user_id or "default_user", session_id, session_title, role, content),
            )

    def get_all_global_memories(
        self,
        user_id: Optional[str] = None,
        exclude_session_id: Optional[str] = None
    ) -> List[Dict]:
        """Retrieve user's memories from other sessions for indexing and cross-chat recall."""
        with self._conn() as conn:
            query = "SELECT * FROM global_memory WHERE 1=1"
            params: List[Any] = []

            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                query += f" AND {clause}"
                params.extend(p)

            if exclude_session_id:
                query += " AND session_id != ?"
                params.append(exclude_session_id)

            query += " ORDER BY created_at DESC LIMIT 500"
            rows = conn.execute(query, tuple(params)).fetchall()
        return [dict(r) for r in rows]

    def delete_all_sessions(self, user_id: Optional[str] = None):
        """Delete all sessions belonging to user (or all if not specified)."""
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(f"DELETE FROM sessions WHERE {clause}", tuple(p))
                conn.execute(f"DELETE FROM global_memory WHERE {clause}", tuple(p))
            else:
                conn.execute("DELETE FROM sessions")
                conn.execute("DELETE FROM global_memory")

    def get_stats(self, user_id: Optional[str] = None) -> Dict[str, Any]:
        """Aggregate statistics across the platform or per user."""
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                s_clause, s_p = self._user_filter(user_id, "s.user_id")
                sess_count = conn.execute(
                    f"SELECT COUNT(*) as c FROM sessions WHERE {clause}", tuple(p)
                ).fetchone()["c"]
                doc_count = conn.execute(
                    f"""SELECT COUNT(*) as c FROM documents d 
                       JOIN sessions s ON d.session_id = s.id 
                       WHERE {s_clause}""", tuple(s_p)
                ).fetchone()["c"]
                msg_count = conn.execute(
                    f"""SELECT COUNT(*) as c FROM messages m 
                       JOIN sessions s ON m.session_id = s.id 
                       WHERE {s_clause}""", tuple(s_p)
                ).fetchone()["c"]
                mem_count = conn.execute(
                    f"SELECT COUNT(*) as c FROM global_memory WHERE {clause}", tuple(p)
                ).fetchone()["c"]
                total_words = conn.execute(
                    f"""SELECT COALESCE(SUM(d.word_count), 0) as s FROM documents d 
                       JOIN sessions s ON d.session_id = s.id 
                       WHERE {s_clause}""", tuple(s_p)
                ).fetchone()["s"]
                total_chunks = conn.execute(
                    f"""SELECT COALESCE(SUM(d.chunk_count), 0) as s FROM documents d 
                       JOIN sessions s ON d.session_id = s.id 
                       WHERE {s_clause}""", tuple(s_p)
                ).fetchone()["s"]
            else:
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
            "database_engine": "postgresql" if self.is_postgres else "sqlite",
        }

    def delete_global_memory(self, memory_id: str, user_id: Optional[str] = None):
        """Delete a single memory item."""
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(
                    f"DELETE FROM global_memory WHERE id = ? AND {clause}",
                    (memory_id, *p),
                )
            else:
                conn.execute("DELETE FROM global_memory WHERE id = ?", (memory_id,))

    def clear_all_global_memory(self, user_id: Optional[str] = None):
        """Clear all global cross-session memories for user."""
        with self._conn() as conn:
            if user_id:
                clause, p = self._user_filter(user_id, "user_id")
                conn.execute(f"DELETE FROM global_memory WHERE {clause}", tuple(p))
            else:
                conn.execute("DELETE FROM global_memory")
