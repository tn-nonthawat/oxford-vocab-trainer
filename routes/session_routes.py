"""
routes/session_routes.py  –  Dashboard and SRS session Blueprint.

Blueprint name : "session"
URL prefix     : (none — routes mount at /, /api/*, /import-*)
"""

import json
import logging
import os
from datetime import timedelta

from flask import Blueprint, current_app, jsonify, request, send_from_directory, session

log = logging.getLogger(__name__)

# Absolute path to the compiled React bundle (built by Vite → static/react/).
# Locally: `npm run build` inside dashboard-react/ outputs here directly.
# Docker:  Stage 1 builds, Stage 2 copies /static/react → ./static/react.
_REACT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static", "react")

from database import get_connection
from extensions import limiter
from models.auth import login_required
from services.date_service import get_current_date
from services.dictionary import fetch_meaning
from services.importer import _snapshot, _start_import
from services.stats import (
    _get_join_info,
    _get_streak,
    _mastery_stats,
    _progress_stats,
    _update_streak,
    _word_counts,
)
import fsrs

session_bp = Blueprint("session", __name__)


# ── React Dashboard (SPA) ─────────────────────────────────────────────────────
# Vite is configured with base: '/' so assets are at /assets/index-abc123.js.

@session_bp.route("/")
@login_required
def index():
    """Serve the React SPA shell.  Auth is checked here; /api/* checks it again."""
    resp = send_from_directory(_REACT_DIR, "index.html")
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    resp.headers["Pragma"] = "no-cache"
    return resp


@session_bp.route("/assets/<path:filename>")
def react_assets(filename: str):
    """Serve the hashed JS/CSS bundles that Vite puts in assets/."""
    return send_from_directory(os.path.join(_REACT_DIR, "assets"), filename)


# ── Import routes ─────────────────────────────────────────────────────────────

@session_bp.route("/import-data", methods=["POST"])
@login_required
def import_data_route():
    # Only admin users may trigger an import — it wipes and rebuilds the shared
    # words table plus ALL users' progress rows.
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("SELECT is_admin FROM users WHERE id = ?", (session["user_id"],))
    row = cur.fetchone()
    conn.close()
    if not row or not row["is_admin"]:
        return jsonify({"error": "Admin access required"}), 403
    started = _start_import()
    return jsonify({"started": started, "state": _snapshot()})


@session_bp.route("/import-status")
@login_required
def import_status():
    return jsonify(_snapshot())


# ── SRS session routes ────────────────────────────────────────────────────────

@session_bp.route("/api/new-session")
@login_required
@limiter.limit("30 per minute")
def api_new_session():
    """
    Up to 10 random words this user has never studied, capped by today's quota.

    Optional query param
    --------------------
    level : One of A1 | A2 | B1 | B2.  Omit for all CEFR levels.
    """
    user_id   = session["user_id"]
    level     = request.args.get("level", "").strip().upper()
    conn      = get_connection()
    cur       = conn.cursor()

    today_str = get_current_date().strftime("%Y-%m-%d")
    cur.execute(
        "SELECT COUNT(*) AS n FROM progress "
        "WHERE user_id = ? AND created_at = ? AND repetitions = 1",
        (user_id, today_str),
    )
    new_today = cur.fetchone()["n"]
    limit     = max(0, 10 - new_today)

    if limit == 0:
        conn.close()
        return jsonify({"words": [], "type": "new", "level": level or "all"})

    if level in ("A1", "A2", "B1", "B2"):
        cur.execute("""
            SELECT w.id, w.word, w.pos, w.cefr_level,
                   w.meaning, w.example_sentence
            FROM   words w
            LEFT JOIN progress p ON w.id = p.word_id AND p.user_id = ?
            WHERE  p.word_id IS NULL
              AND  w.cefr_level = ?
            ORDER  BY RANDOM()
            LIMIT  ?
        """, (user_id, level, limit))
    else:
        cur.execute("""
            SELECT w.id, w.word, w.pos, w.cefr_level,
                   w.meaning, w.example_sentence
            FROM   words w
            LEFT JOIN progress p ON w.id = p.word_id AND p.user_id = ?
            WHERE  p.word_id IS NULL
            ORDER  BY RANDOM()
            LIMIT  ?
        """, (user_id, limit))

    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"words": words, "type": "new", "level": level or "all"})


@session_bp.route("/api/review-session")
@login_required
@limiter.limit("30 per minute")
def api_review_session():
    """Words due for this user today or earlier, oldest first."""
    user_id = session["user_id"]
    today   = get_current_date().strftime("%Y-%m-%d")
    conn    = get_connection()
    cur     = conn.cursor()
    cur.execute("""
        SELECT w.id, w.word, w.pos, w.cefr_level,
               w.meaning, w.example_sentence,
               p.interval, p.easiness_factor,
               p.repetitions, p.next_review_date,
               COALESCE(n.note, '') AS user_note
        FROM   words w
        JOIN   progress p ON w.id = p.word_id
        LEFT JOIN word_notes n ON n.word_id = w.id AND n.user_id = p.user_id
        WHERE  p.user_id = ?
          AND  p.next_review_date <= ?
        ORDER  BY p.next_review_date ASC
        LIMIT  20
    """, (user_id, today))
    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"words": words, "type": "review"})


@session_bp.route("/api/submit-review", methods=["POST"])
@login_required
@limiter.limit("60 per minute")
def api_submit_review():
    """Accept {word_id, quality}; upsert this user's progress row via FSRS-5."""
    user_id = session["user_id"]
    conn    = None
    try:
        data = request.get_json(force=True)
        if not data:
            return jsonify({"error": "Request body must be JSON", "success": False}), 400

        word_id = int(data["word_id"])
        quality = int(data["quality"])

        if not (0 <= quality <= 5):
            return jsonify(
                {"error": f"quality must be 0–5, got {quality}", "success": False}
            ), 400

        conn = get_connection()
        cur  = conn.cursor()

        cur.execute("SELECT id FROM words WHERE id = ?", (word_id,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "Word not found", "success": False}), 404

        cur.execute(
            "SELECT * FROM progress WHERE user_id = ? AND word_id = ?",
            (user_id, word_id),
        )
        row  = cur.fetchone()
        reps = 0 if quality < 3 else (row["repetitions"] + 1 if row else 1)

        if row:
            # Resolve FSRS state — migrate SM-2 rows on first encounter
            if row["stability"] is None:
                stab, diff = fsrs.sm2_to_fsrs(row["interval"], row["easiness_factor"])
            else:
                stab, diff = row["stability"], row["difficulty"]
            iv, new_stab, new_diff, next_date = fsrs.calculate_next_review(
                quality, stab, diff, row["interval"]
            )
            cur.execute("""
                UPDATE progress
                SET    interval=?, repetitions=?, next_review_date=?,
                       stability=?, difficulty=?
                WHERE  user_id=? AND word_id=?
            """, (iv, reps, next_date, new_stab, new_diff, user_id, word_id))
        else:
            iv, new_stab, new_diff, next_date = fsrs.init_card(quality)
            today_str = get_current_date().strftime("%Y-%m-%d")
            cur.execute("""
                INSERT INTO progress
                    (user_id, word_id, interval, easiness_factor,
                     repetitions, next_review_date, created_at, stability, difficulty)
                VALUES (?, ?, ?, 2.5, ?, ?, ?, ?, ?)
            """, (user_id, word_id, iv, reps, next_date, today_str, new_stab, new_diff))

        cur.execute(
            "INSERT INTO review_log (user_id, word_id, quality, reviewed_at) VALUES (?, ?, ?, ?)",
            (user_id, word_id, quality, get_current_date().strftime("%Y-%m-%d")),
        )
        conn.commit()
        streak = _update_streak(user_id)
        return jsonify({
            "success"         : True,
            "interval"        : iv,
            "repetitions"     : reps,
            "next_review_date": next_date,
            "streak"          : streak,
        })

    except (KeyError, ValueError, TypeError) as exc:
        return jsonify({"error": f"Bad request: {exc}", "success": False}), 400

    except Exception as exc:
        # Log full details server-side; never expose internals to the client.
        log.exception("Unexpected error in submit-review: %s", exc)
        return jsonify({"error": "Internal server error", "success": False}), 500

    finally:
        if conn:
            conn.close()


@session_bp.route("/api/stats")
@login_required
@limiter.limit("30 per minute")
def api_stats():
    """Live dashboard stats for the logged-in user."""
    user_id = session["user_id"]
    total, level_counts = _word_counts()
    progress = _progress_stats(user_id)
    streak   = _get_streak(user_id)
    mastery  = _mastery_stats(user_id)
    join_info = _get_join_info(user_id)
    return jsonify({
        "username"    : session.get("username", ""),
        "total"       : total,
        "level_counts": level_counts,
        **progress,
        "streak"      : streak,
        **mastery,
        **join_info,
    })


@session_bp.route("/api/word-list")
@login_required
@limiter.limit("30 per minute")
def api_word_list():
    """
    Return words for the logged-in user grouped by memory category.

    Query param
    -----------
    category : mastered | learning | struggling
    """
    user_id  = session["user_id"]
    category = request.args.get("category", "").strip().lower()

    if category not in ("mastered", "learning", "struggling", "introduced"):
        return jsonify({"error": "category must be mastered, learning, struggling, or introduced"}), 400

    conn = get_connection()
    cur  = conn.cursor()

    if category == "mastered":
        where = "p.repetitions >= 4"
    elif category == "learning":
        where = "p.repetitions >= 1 AND p.repetitions <= 3 AND p.easiness_factor >= 1.8"
    elif category == "struggling":
        where = "p.repetitions < 4 AND (p.repetitions = 0 OR p.easiness_factor < 1.8)"
    else:  # introduced — all words the user has ever studied
        where = "1=1"

    cur.execute(f"""
        SELECT w.id, w.word, w.pos, w.cefr_level,
               p.repetitions, p.easiness_factor, p.interval, p.next_review_date
        FROM   words w
        JOIN   progress p ON w.id = p.word_id
        WHERE  p.user_id = ? AND {where}
        ORDER  BY w.word ASC
    """, (user_id,))

    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"category": category, "words": words})


@session_bp.route("/api/word-meaning/<int:word_id>")
@login_required
@limiter.limit("60 per minute")
def api_word_meaning(word_id: int):
    """
    Return (and persistently cache) the meaning and example sentence for a word.

    On the first call the Free Dictionary API is queried; the result is stored
    in words.meaning / words.example_sentence so all subsequent calls are
    instant (zero network latency).

    Response: { meaning, example_sentence, cached: bool }
    """
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "SELECT id, word, pos, cefr_level, meaning, example_sentence "
        "FROM   words WHERE id = ?",
        (word_id,),
    )
    row = cur.fetchone()

    if not row:
        conn.close()
        return jsonify({"error": "Word not found"}), 404

    # Serve cached value if available
    if row["meaning"]:
        conn.close()
        return jsonify({
            "meaning"         : row["meaning"],
            "example_sentence": row["example_sentence"] or "",
            "cached"          : True,
        })

    # Fetch from the Free Dictionary API, then cache
    meaning, example = fetch_meaning(row["word"], row["pos"], row["cefr_level"])
    cur.execute(
        "UPDATE words SET meaning = ?, example_sentence = ? WHERE id = ?",
        (meaning, example, word_id),
    )
    conn.commit()
    conn.close()

    return jsonify({
        "meaning"         : meaning,
        "example_sentence": example,
        "cached"          : False,
    })


@session_bp.route("/api/word-note/<int:word_id>", methods=["GET"])
@login_required
def api_get_word_note(word_id: int):
    user_id = session["user_id"]
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("SELECT note FROM word_notes WHERE user_id = ? AND word_id = ?",
                (user_id, word_id))
    row = cur.fetchone()
    conn.close()
    return jsonify({"note": row["note"] if row else ""})


@session_bp.route("/api/word-note/<int:word_id>", methods=["POST"])
@login_required
@limiter.limit("120 per minute")
def api_save_word_note(word_id: int):
    user_id = session["user_id"]
    data    = request.get_json(force=True) or {}
    note    = str(data.get("note", ""))[:200]
    conn    = get_connection()
    cur     = conn.cursor()
    if note:
        cur.execute("""
            INSERT INTO word_notes (user_id, word_id, note) VALUES (?, ?, ?)
            ON CONFLICT(user_id, word_id) DO UPDATE SET note = excluded.note
        """, (user_id, word_id, note))
    else:
        cur.execute("DELETE FROM word_notes WHERE user_id = ? AND word_id = ?",
                    (user_id, word_id))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@session_bp.route("/api/preferences", methods=["GET"])
@login_required
def api_get_preferences():
    user_id = session["user_id"]
    conn    = get_connection()
    cur     = conn.cursor()
    cur.execute("SELECT prefs_json FROM user_preferences WHERE user_id = ?", (user_id,))
    row  = cur.fetchone()
    conn.close()
    return jsonify(json.loads(row["prefs_json"]) if row else {})


@session_bp.route("/api/preferences", methods=["PUT"])
@login_required
@limiter.limit("60 per minute")
def api_save_preferences():
    user_id  = session["user_id"]
    incoming = request.get_json(force=True) or {}
    conn     = get_connection()
    cur      = conn.cursor()
    cur.execute("SELECT prefs_json FROM user_preferences WHERE user_id = ?", (user_id,))
    row      = cur.fetchone()
    existing = json.loads(row["prefs_json"]) if row else {}
    existing.update(incoming)
    cur.execute("""
        INSERT INTO user_preferences (user_id, prefs_json) VALUES (?, ?)
        ON CONFLICT(user_id) DO UPDATE SET prefs_json = excluded.prefs_json
    """, (user_id, json.dumps(existing)))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


@session_bp.route("/api/session-log", methods=["POST"])
@login_required
@limiter.limit("60 per minute")
def api_session_log():
    """Record a completed study session."""
    user_id = session["user_id"]
    data    = request.get_json(force=True) or {}
    stype        = str(data.get("type", ""))[:20]
    word_count   = int(data.get("word_count", 0))
    duration_sec = data.get("duration_sec")
    if duration_sec is not None:
        duration_sec = int(duration_sec)
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute(
        "INSERT INTO session_log (user_id, type, word_count, duration_sec, started_at) "
        "VALUES (?, ?, ?, ?, ?)",
        (user_id, stype, word_count, duration_sec, get_current_date().strftime("%Y-%m-%d")),
    )
    conn.commit()
    conn.close()
    return jsonify({"ok": True})


# ── Analytics routes ──────────────────────────────────────────────────────────

@session_bp.route("/api/analytics/history")
@login_required
@limiter.limit("30 per minute")
def api_analytics_history():
    """New words introduced per day for the last 60 days."""
    user_id  = session["user_id"]
    today    = get_current_date()
    since    = (today - timedelta(days=59)).strftime("%Y-%m-%d")
    conn     = get_connection()
    cur      = conn.cursor()
    cur.execute("""
        SELECT created_at AS date, COUNT(*) AS count
        FROM   progress
        WHERE  user_id = ? AND created_at != '2000-01-01' AND created_at >= ?
        GROUP  BY created_at
        ORDER  BY created_at ASC
    """, (user_id, since))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"history": rows})


@session_bp.route("/api/analytics/forecast")
@login_required
@limiter.limit("30 per minute")
def api_analytics_forecast():
    """Words due per day for the next 14 days."""
    user_id  = session["user_id"]
    today    = get_current_date()
    today_str = today.strftime("%Y-%m-%d")
    end_str   = (today + timedelta(days=13)).strftime("%Y-%m-%d")
    conn     = get_connection()
    cur      = conn.cursor()
    cur.execute("""
        SELECT next_review_date AS date, COUNT(*) AS count
        FROM   progress
        WHERE  user_id = ? AND next_review_date BETWEEN ? AND ?
        GROUP  BY next_review_date
        ORDER  BY next_review_date
    """, (user_id, today_str, end_str))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"forecast": rows, "today": today_str})


@session_bp.route("/api/analytics/breakdown")
@login_required
@limiter.limit("30 per minute")
def api_analytics_breakdown():
    """Per-CEFR mastery breakdown + overall health metrics."""
    user_id = session["user_id"]
    conn    = get_connection()
    cur     = conn.cursor()

    cur.execute("""
        SELECT
            w.cefr_level,
            SUM(CASE WHEN p.repetitions >= 4 THEN 1 ELSE 0 END)                                                         AS mastered,
            SUM(CASE WHEN p.repetitions BETWEEN 1 AND 3 AND p.easiness_factor >= 1.8 THEN 1 ELSE 0 END)                 AS learning,
            SUM(CASE WHEN p.repetitions < 4 AND (p.repetitions = 0 OR p.easiness_factor < 1.8) THEN 1 ELSE 0 END)      AS struggling,
            COUNT(*)                                                                                                      AS total_introduced,
            ROUND(AVG(p.easiness_factor), 2)                                                                             AS avg_ef,
            (SELECT COUNT(*) FROM words w2 WHERE w2.cefr_level = w.cefr_level)                                           AS total_in_level
        FROM   progress p
        JOIN   words w ON p.word_id = w.id
        WHERE  p.user_id = ?
        GROUP  BY w.cefr_level
        ORDER  BY w.cefr_level
    """, (user_id,))
    cefr_rows = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT
            ROUND(AVG(easiness_factor), 2) AS avg_ef,
            SUM(repetitions)               AS total_reviews,
            COUNT(*)                       AS total_introduced
        FROM progress
        WHERE user_id = ?
    """, (user_id,))
    h = dict(cur.fetchone())

    cur.execute("SELECT COUNT(*) AS n FROM words")
    total_words = cur.fetchone()["n"]

    cur.execute("""
        SELECT w.word, w.pos, w.cefr_level,
               ROUND(p.easiness_factor, 2) AS easiness_factor,
               p.repetitions
        FROM   progress p
        JOIN   words w ON p.word_id = w.id
        WHERE  p.user_id = ? AND p.repetitions > 0
        ORDER  BY p.easiness_factor ASC
        LIMIT  10
    """, (user_id,))
    hardest = [dict(r) for r in cur.fetchall()]

    cur.execute("""
        SELECT CAST(strftime('%w', created_at) AS INTEGER) AS dow,
               COUNT(*) AS count
        FROM   progress
        WHERE  user_id = ? AND created_at != '2000-01-01'
        GROUP  BY dow
    """, (user_id,))
    weekly_map = {r["dow"]: r["count"] for r in cur.fetchall()}
    weekly_pattern = [weekly_map.get(i, 0) for i in range(7)]  # index 0=Sun … 6=Sat

    conn.close()

    return jsonify({
        "cefr_breakdown": cefr_rows,
        "health": {
            "avg_ef"           : h["avg_ef"] or 0,
            "total_reviews"    : h["total_reviews"] or 0,
            "total_introduced" : h["total_introduced"] or 0,
            "total_words"      : total_words,
            "streak"           : _get_streak(user_id),
        },
        "hardest_words" : hardest,
        "weekly_pattern": weekly_pattern,
    })
