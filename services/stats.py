"""
services/stats.py  –  Per-user statistics helpers.

All functions open and close their own database connection so they are safe
to call from any request context (Flask's per-request threading model).

Public API
----------
  _word_counts()            -> (total: int, level_counts: dict)
  _progress_stats(user_id)  -> dict  {introduced, due_today}
  _mastery_stats(user_id)   -> dict  {mastered, learning, struggling}
  _get_streak(user_id)      -> int
  _update_streak(user_id)   -> int   (upserts user_stats row, returns new streak)
"""

from datetime import timedelta

from database import get_connection
from services.date_service import get_current_date


# ── Word counts ───────────────────────────────────────────────────────────────

def _word_counts() -> tuple[int, dict]:
    """Return (total_words, {cefr_level: count}) for the shared word table."""
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("SELECT COUNT(*) AS total FROM words")
    total = cur.fetchone()["total"]
    cur.execute("""
        SELECT cefr_level, COUNT(*) AS cnt
        FROM   words
        GROUP  BY cefr_level
        ORDER  BY cefr_level
    """)
    level_counts = {r["cefr_level"]: r["cnt"] for r in cur.fetchall()}
    conn.close()
    for lvl in ("A1", "A2", "B1", "B2"):
        level_counts.setdefault(lvl, 0)
    return total, level_counts


# ── Progress stats ────────────────────────────────────────────────────────────

def _progress_stats(user_id: int) -> dict:
    """Return {introduced, due_today, new_today} for *user_id*."""
    today = get_current_date().strftime("%Y-%m-%d")
    conn  = get_connection()
    cur   = conn.cursor()

    cur.execute(
        "SELECT COUNT(*) AS n FROM progress WHERE user_id = ?", (user_id,)
    )
    introduced = cur.fetchone()["n"]

    cur.execute(
        "SELECT COUNT(*) AS n FROM progress "
        "WHERE user_id = ? AND next_review_date <= ?",
        (user_id, today),
    )
    due = cur.fetchone()["n"]

    # Words first learned today (created_at = today, repetitions = 1)
    # repetitions=1 ensures we count only first-time introduction, not re-entries
    cur.execute(
        "SELECT COUNT(*) AS n FROM progress "
        "WHERE user_id = ? AND created_at = ? AND repetitions = 1",
        (user_id, today),
    )
    new_today = cur.fetchone()["n"]

    conn.close()
    return {"introduced": introduced, "due_today": due, "new_today": new_today}


# ── Mastery stats ─────────────────────────────────────────────────────────────

def _mastery_stats(user_id: int) -> dict:
    """
    Classify every progress row into three retention bands.

    Mastered   – repetitions >= 4
    Learning   – 1 <= repetitions <= 3
    Struggling – easiness_factor < 1.8   (can overlap with the other bands)
    """
    conn = get_connection()
    cur  = conn.cursor()

    cur.execute(
        "SELECT COUNT(*) AS n FROM progress "
        "WHERE user_id = ? AND repetitions >= 4",
        (user_id,),
    )
    mastered = cur.fetchone()["n"]

    cur.execute(
        "SELECT COUNT(*) AS n FROM progress "
        "WHERE user_id = ? AND repetitions >= 1 AND repetitions <= 3",
        (user_id,),
    )
    learning = cur.fetchone()["n"]

    cur.execute(
        "SELECT COUNT(*) AS n FROM progress "
        "WHERE user_id = ? AND easiness_factor < 1.8",
        (user_id,),
    )
    struggling = cur.fetchone()["n"]

    conn.close()
    return {"mastered": mastered, "learning": learning, "struggling": struggling}


# ── Streak helpers ────────────────────────────────────────────────────────────

def _get_streak(user_id: int) -> int:
    """Return the current learning streak for *user_id* (0 if no row yet)."""
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "SELECT current_streak FROM user_stats WHERE user_id = ?", (user_id,)
    )
    row = cur.fetchone()
    conn.close()
    return row["current_streak"] if row else 0


def _update_streak(user_id: int) -> int:
    """
    Upsert the user_stats row for *user_id* and maintain the daily streak.

    Rules
    -----
    - last_activity_date == today     → streak unchanged
    - last_activity_date == yesterday → streak + 1
    - anything else                   → streak = 1  (first use or gap)

    Returns the updated streak value.
    """
    _now      = get_current_date()           # single API call; cached for 60 s
    today     = _now.strftime("%Y-%m-%d")
    yesterday = (_now - timedelta(days=1)).strftime("%Y-%m-%d")

    conn = get_connection()
    cur  = conn.cursor()

    # Ensure a row exists (INSERT OR IGNORE is a no-op if already present).
    cur.execute("""
        INSERT OR IGNORE INTO user_stats (user_id, last_activity_date, current_streak)
        VALUES (?, NULL, 0)
    """, (user_id,))

    cur.execute(
        "SELECT last_activity_date, current_streak "
        "FROM   user_stats WHERE user_id = ?",
        (user_id,),
    )
    row    = cur.fetchone()
    last   = row["last_activity_date"]
    streak = row["current_streak"]

    if last == today:
        pass                   # already counted today — no change
    elif last == yesterday:
        streak += 1            # consecutive day — extend streak
    else:
        streak = 1             # first use or gap — start fresh

    cur.execute(
        "UPDATE user_stats "
        "SET last_activity_date = ?, current_streak = ? "
        "WHERE user_id = ?",
        (today, streak, user_id),
    )
    conn.commit()
    conn.close()
    return streak
