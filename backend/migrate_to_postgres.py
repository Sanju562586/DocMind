"""
DocMind Migration Script: SQLite -> PostgreSQL
─────────────────────────────────────────────
Transfers all existing conversation sessions, messages, documents,
global memory, and users from local SQLite (summarizer.db) to a cloud
PostgreSQL database (DATABASE_URL).

Usage:
  1. Set DATABASE_URL in backend/.env:
     DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require
  2. Run:
     python migrate_to_postgres.py
"""

import os
import sys
import sqlite3
import logging
from typing import Optional

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

try:
    import psycopg2
    from psycopg2.extras import execute_values
except ImportError:
    print("Error: psycopg2-binary is required for PostgreSQL migration.")
    print("Run: pip install psycopg2-binary")
    sys.exit(1)

from config import get_settings
from session_store import SessionStore

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("docmind-migration")


def migrate():
    settings = get_settings()
    sqlite_path = settings.resolved_database_path
    pg_url = settings.database_url or os.getenv("DATABASE_URL")

    if not pg_url:
        logger.error("DATABASE_URL is not set in backend/.env or environment.")
        logger.info("Example: DATABASE_URL=postgresql://user:password@host:5432/dbname?sslmode=require")
        sys.exit(1)

    if not os.path.exists(sqlite_path):
        logger.error("SQLite database file not found at: %s", sqlite_path)
        sys.exit(1)

    # Normalize postgres:// to postgresql://
    if pg_url.startswith("postgres://"):
        pg_url = "postgresql://" + pg_url[len("postgres://"):]

    logger.info("Source SQLite: %s", sqlite_path)
    logger.info("Target PostgreSQL: %s", pg_url.split("@")[-1] if "@" in pg_url else "connected")

    # 1. Initialize PostgreSQL tables using SessionStore
    store = SessionStore(database_url=pg_url)
    store.initialize()
    logger.info("Target PostgreSQL tables initialized [OK]")

    sq_conn = sqlite3.connect(sqlite_path)
    sq_conn.row_factory = sqlite3.Row

    pg_conn = psycopg2.connect(pg_url)
    pg_conn.autocommit = False

    try:
        with pg_conn.cursor() as pg_cur:
            # 1. Migrate Users
            user_rows = sq_conn.execute("SELECT * FROM users").fetchall()
            if user_rows:
                logger.info("Migrating %d user(s)...", len(user_rows))
                for u in user_rows:
                    pg_cur.execute(
                        """
                        INSERT INTO users (id, email, name, image, provider, api_keys_json, created_at, last_login_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            email = EXCLUDED.email,
                            name = EXCLUDED.name,
                            api_keys_json = COALESCE(EXCLUDED.api_keys_json, users.api_keys_json);
                        """,
                        (
                            u["id"], u["email"], u["name"], u["image"],
                            u["provider"], u.get("api_keys_json"),
                            u["created_at"], u["last_login_at"]
                        )
                    )

            # 2. Migrate Sessions
            session_rows = sq_conn.execute("SELECT * FROM sessions").fetchall()
            if session_rows:
                logger.info("Migrating %d session(s)...", len(session_rows))
                for s in session_rows:
                    pg_cur.execute(
                        """
                        INSERT INTO sessions (id, user_id, title, is_shared, share_token, shared_at, created_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO UPDATE SET
                            title = EXCLUDED.title,
                            updated_at = EXCLUDED.updated_at;
                        """,
                        (
                            s["id"], s["user_id"], s["title"],
                            bool(s["is_shared"]), s["share_token"], s.get("shared_at"),
                            s["created_at"], s["updated_at"]
                        )
                    )

            # 3. Migrate Documents
            doc_rows = sq_conn.execute("SELECT * FROM documents").fetchall()
            if doc_rows:
                logger.info("Migrating %d document(s)...", len(doc_rows))
                for d in doc_rows:
                    pg_cur.execute(
                        """
                        INSERT INTO documents (id, session_id, filename, chunk_count, char_count, word_count, file_type, file_path, status, error_message, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING;
                        """,
                        (
                            d["id"], d["session_id"], d["filename"],
                            d["chunk_count"], d["char_count"], d["word_count"],
                            d["file_type"], d["file_path"], d.get("status", "ready"),
                            d.get("error_message"), d["created_at"]
                        )
                    )

            # 4. Migrate Messages
            msg_rows = sq_conn.execute("SELECT * FROM messages").fetchall()
            if msg_rows:
                logger.info("Migrating %d message(s)...", len(msg_rows))
                for m in msg_rows:
                    pg_cur.execute(
                        """
                        INSERT INTO messages (id, session_id, role, content, sources_json, memory_json, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING;
                        """,
                        (
                            m["id"], m["session_id"], m["role"],
                            m["content"], m["sources_json"], m["memory_json"],
                            m["created_at"]
                        )
                    )

            # 5. Migrate Global Memory
            mem_rows = sq_conn.execute("SELECT * FROM global_memory").fetchall()
            if mem_rows:
                logger.info("Migrating %d memory item(s)...", len(mem_rows))
                for gm in mem_rows:
                    pg_cur.execute(
                        """
                        INSERT INTO global_memory (id, user_id, session_id, session_title, role, content, created_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (id) DO NOTHING;
                        """,
                        (
                            gm["id"], gm.get("user_id", "default_user"),
                            gm["session_id"], gm["session_title"],
                            gm["role"], gm["content"], gm["created_at"]
                        )
                    )

        pg_conn.commit()
        logger.info("Successfully migrated all conversations and memories to PostgreSQL! [OK]")

    except Exception as exc:
        pg_conn.rollback()
        logger.exception("Migration failed: %s", exc)
        sys.exit(1)
    finally:
        sq_conn.close()
        pg_conn.close()


if __name__ == "__main__":
    migrate()
