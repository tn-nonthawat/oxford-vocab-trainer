"""
database.py  -  Database initialisation, migration, and connection helper.

Tables
------
  users      : Registered user accounts
  words      : Oxford 3000 word list  (shared across all users)
  progress   : Per-user SM-2 SRS state  (user_id + word_id composite key)
  user_stats : Per-user daily learning streak
"""

import os
import sqlite3
import sys

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

# On Render: set DB_PATH=/data/vocab_app.db  (persistent disk mounted at /data)
# Locally  : falls back to the project root
DB_PATH = os.environ.get(
    "DB_PATH",
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "vocab_app.db"),
)


def get_connection() -> sqlite3.Connection:
    """
    Return an open SQLite connection ready for use.

    Three settings are applied to every connection to prevent "database is
    locked" errors under Flask's multi-threaded request handling:

    WAL journal mode
        Allows concurrent readers while a writer is active, and concurrent
        reads during writes.  The default DELETE mode grants one exclusive
        lock that blocks every other connection.

    busy_timeout = 10 000 ms
        If the DB is momentarily locked by another writer, SQLite will
        retry automatically for up to 10 seconds before raising
        OperationalError.  Without this the error is thrown immediately.

    check_same_thread = False
        Python's sqlite3 module normally refuses to reuse a connection on a
        different thread.  Since each Flask request opens and closes its own
        connection (no sharing), this restriction is unnecessary and would
        raise spurious errors in a threaded server.
    """
    conn = sqlite3.connect(DB_PATH, timeout=30, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA busy_timeout=10000")   # 10 s retry window
    return conn


def init_db() -> None:
    """Create tables if they don't already exist, then run migrations."""
    conn = get_connection()
    cur  = conn.cursor()

    # ── User accounts ─────────────────────────────────────────────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS users (
            id            INTEGER PRIMARY KEY AUTOINCREMENT,
            username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
            password_hash TEXT    NOT NULL,
            created_at    TEXT    DEFAULT (date('now'))
        )
    """)

    # ── Shared word list (same Oxford 3000 for every user) ───────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS words (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            word             TEXT    NOT NULL,
            pos              TEXT,
            cefr_level       TEXT,
            meaning          TEXT,
            example_sentence TEXT
        )
    """)

    # ── Per-user SM-2 progress ────────────────────────────────────────────────
    # Composite UNIQUE (user_id, word_id) replaces the old word_id-only PK
    # so each user has their own independent SRS schedule per word.
    cur.execute("""
        CREATE TABLE IF NOT EXISTS progress (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL,
            word_id          INTEGER NOT NULL,
            interval         INTEGER DEFAULT 0,
            easiness_factor  REAL    DEFAULT 2.5,
            repetitions      INTEGER DEFAULT 0,
            next_review_date TEXT,
            FOREIGN KEY (user_id) REFERENCES users (id),
            FOREIGN KEY (word_id) REFERENCES words (id),
            UNIQUE (user_id, word_id)
        )
    """)

    # ── Per-user streak (one row per user, user_id is the PK) ────────────────
    cur.execute("""
        CREATE TABLE IF NOT EXISTS user_stats (
            user_id            INTEGER PRIMARY KEY,
            last_activity_date TEXT,
            current_streak     INTEGER DEFAULT 0,
            FOREIGN KEY (user_id) REFERENCES users (id)
        )
    """)

    conn.commit()
    conn.close()

    _migrate()
    print(f"[database] Ready -> {DB_PATH}")


def _migrate() -> None:
    """
    Idempotent schema migrations.  Safe to call on every startup.

    Handles two generations of evolution:
      Step 3  – added meaning / example_sentence columns to words.
      Auth    – added user_id to progress and changed user_stats from a
                singleton (id=1) to a per-user row.  Existing rows are
                re-homed under a placeholder 'legacy' account so no data
                is lost.  The legacy account has an unguessable password
                hash and cannot be logged into via the normal login form.
    """
    conn = get_connection()
    cur  = conn.cursor()

    # ── 1. words: add meaning / example_sentence ──────────────────────────────
    cur.execute("PRAGMA table_info(words)")
    word_cols = {r["name"] for r in cur.fetchall()}
    for col, col_type in {"meaning": "TEXT", "example_sentence": "TEXT"}.items():
        if col not in word_cols:
            cur.execute(f"ALTER TABLE words ADD COLUMN {col} {col_type}")
            print(f"[database] Migration: added words.{col}")

    # ── 2. progress: add user_id (multi-user upgrade) ─────────────────────────
    cur.execute("PRAGMA table_info(progress)")
    prog_cols = {r["name"] for r in cur.fetchall()}

    if "user_id" not in prog_cols:
        print("[database] Migration: upgrading progress to multi-user schema …")

        # Create a non-loginable placeholder to own any pre-auth progress rows.
        cur.execute("""
            INSERT OR IGNORE INTO users (id, username, password_hash)
            VALUES (1, 'legacy', '__legacy_account_cannot_login__')
        """)

        # Recreate the table with the new schema, copy existing rows.
        cur.execute("""
            CREATE TABLE progress_v2 (
                id               INTEGER PRIMARY KEY AUTOINCREMENT,
                user_id          INTEGER NOT NULL DEFAULT 1,
                word_id          INTEGER NOT NULL,
                interval         INTEGER DEFAULT 0,
                easiness_factor  REAL    DEFAULT 2.5,
                repetitions      INTEGER DEFAULT 0,
                next_review_date TEXT,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (word_id) REFERENCES words (id),
                UNIQUE (user_id, word_id)
            )
        """)
        cur.execute("""
            INSERT INTO progress_v2
                (user_id, word_id, interval, easiness_factor,
                 repetitions, next_review_date)
            SELECT 1, word_id, interval, easiness_factor,
                   repetitions, next_review_date
            FROM   progress
        """)
        cur.execute("DROP TABLE progress")
        cur.execute("ALTER TABLE progress_v2 RENAME TO progress")
        print("[database] Migration: progress table upgraded.")

    # ── 3. user_stats: singleton → per-user ──────────────────────────────────
    cur.execute("PRAGMA table_info(user_stats)")
    stats_cols = {r["name"] for r in cur.fetchall()}

    # Old schema has an 'id' column; new schema uses 'user_id' as PK.
    if "id" in stats_cols and "user_id" not in stats_cols:
        print("[database] Migration: upgrading user_stats to per-user schema …")
        cur.execute("""
            CREATE TABLE user_stats_v2 (
                user_id            INTEGER PRIMARY KEY,
                last_activity_date TEXT,
                current_streak     INTEGER DEFAULT 0,
                FOREIGN KEY (user_id) REFERENCES users (id)
            )
        """)
        # Carry the existing (singleton) streak forward under the legacy user.
        cur.execute("""
            INSERT OR IGNORE INTO user_stats_v2
                (user_id, last_activity_date, current_streak)
            SELECT 1, last_activity_date, current_streak
            FROM   user_stats
        """)
        cur.execute("DROP TABLE user_stats")
        cur.execute("ALTER TABLE user_stats_v2 RENAME TO user_stats")
        print("[database] Migration: user_stats table upgraded.")

    conn.commit()
    conn.close()


if __name__ == "__main__":
    init_db()
