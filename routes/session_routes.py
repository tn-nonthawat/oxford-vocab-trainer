"""
routes/session_routes.py  –  Dashboard and SRS session Blueprint.

Blueprint name : "session"
URL prefix     : (none — routes mount at /, /api/*, /import-*)
"""

import logging
import os

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
    _get_streak,
    _mastery_stats,
    _progress_stats,
    _update_streak,
    _word_counts,
)
from srs import calculate_next_review

session_bp = Blueprint("session", __name__)


# ── React Dashboard (SPA) ─────────────────────────────────────────────────────
# Vite is configured with base: '/' so assets are at /assets/index-abc123.js.

@session_bp.route("/")
@login_required
def index():
    """Serve the React SPA shell.  Auth is checked here; /api/* checks it again."""
    return send_from_directory(_REACT_DIR, "index.html")


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
def api_new_session():
    """
    10 random words this user has never studied.

    Optional query param
    --------------------
    level : One of A1 | A2 | B1 | B2.  Omit for all CEFR levels.
    """
    user_id = session["user_id"]
    level   = request.args.get("level", "").strip().upper()
    conn    = get_connection()
    cur     = conn.cursor()

    if level in ("A1", "A2", "B1", "B2"):
        cur.execute("""
            SELECT w.id, w.word, w.pos, w.cefr_level,
                   w.meaning, w.example_sentence
            FROM   words w
            LEFT JOIN progress p ON w.id = p.word_id AND p.user_id = ?
            WHERE  p.word_id IS NULL
              AND  w.cefr_level = ?
            ORDER  BY RANDOM()
            LIMIT  10
        """, (user_id, level))
    else:
        cur.execute("""
            SELECT w.id, w.word, w.pos, w.cefr_level,
                   w.meaning, w.example_sentence
            FROM   words w
            LEFT JOIN progress p ON w.id = p.word_id AND p.user_id = ?
            WHERE  p.word_id IS NULL
            ORDER  BY RANDOM()
            LIMIT  10
        """, (user_id,))

    words = [dict(r) for r in cur.fetchall()]
    conn.close()
    return jsonify({"words": words, "type": "new", "level": level or "all"})


@session_bp.route("/api/review-session")
@login_required
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
               p.repetitions, p.next_review_date
        FROM   words w
        JOIN   progress p ON w.id = p.word_id
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
    """Accept {word_id, quality}; upsert this user's progress row via SM-2."""
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

        # Validate that word_id actually exists in the shared word list.
        cur.execute("SELECT id FROM words WHERE id = ?", (word_id,))
        if not cur.fetchone():
            conn.close()
            return jsonify({"error": "Word not found", "success": False}), 404

        cur.execute(
            "SELECT * FROM progress WHERE user_id = ? AND word_id = ?",
            (user_id, word_id),
        )
        row = cur.fetchone()

        if row:
            iv, ef, reps, next_date = calculate_next_review(
                quality, row["interval"], row["easiness_factor"], row["repetitions"]
            )
            cur.execute("""
                UPDATE progress
                SET    interval=?, easiness_factor=?, repetitions=?, next_review_date=?
                WHERE  user_id=? AND word_id=?
            """, (iv, ef, reps, next_date, user_id, word_id))
        else:
            iv, ef, reps, next_date = calculate_next_review(quality, 0, 2.5, 0)
            cur.execute("""
                INSERT INTO progress
                    (user_id, word_id, interval, easiness_factor,
                     repetitions, next_review_date)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (user_id, word_id, iv, ef, reps, next_date))

        conn.commit()
        streak = _update_streak(user_id)
        return jsonify({
            "success"         : True,
            "interval"        : iv,
            "easiness_factor" : ef,
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
def api_stats():
    """Live dashboard stats for the logged-in user."""
    user_id = session["user_id"]
    total, level_counts = _word_counts()
    progress = _progress_stats(user_id)
    streak   = _get_streak(user_id)
    mastery  = _mastery_stats(user_id)
    return jsonify({
        "username"    : session.get("username", ""),
        "total"       : total,
        "level_counts": level_counts,
        **progress,
        "streak"      : streak,
        **mastery,
    })


@session_bp.route("/api/word-meaning/<int:word_id>")
@login_required
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
