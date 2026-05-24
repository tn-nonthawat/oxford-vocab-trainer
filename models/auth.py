"""
models/auth.py  –  Authentication helpers and the login_required decorator.

Keeping these in a standalone module means any Blueprint can import them
without creating a circular dependency on the Flask app instance.
"""

from functools import wraps

from flask import jsonify, redirect, request, session, url_for
from werkzeug.security import check_password_hash, generate_password_hash


# ── Password utilities ────────────────────────────────────────────────────────

def hash_password(password: str) -> str:
    """Return a Werkzeug-hashed password string suitable for DB storage."""
    return generate_password_hash(password)


def verify_password(password_hash: str, password: str) -> bool:
    """Return True if *password* matches *password_hash*."""
    return check_password_hash(password_hash, password)


# ── Route guard ───────────────────────────────────────────────────────────────

def login_required(f):
    """
    Decorator that blocks unauthenticated access.

    Behaviour
    ---------
    - API / JSON requests  → 401 JSON  { error, success: False }
    - Browser page requests → redirect to /login  (auth.login endpoint)
    """
    @wraps(f)
    def _guard(*args, **kwargs):
        if "user_id" not in session:
            if request.path.startswith("/api/") or request.is_json:
                return jsonify({"error": "Login required", "success": False}), 401
            return redirect(url_for("auth.login"))
        return f(*args, **kwargs)
    return _guard
