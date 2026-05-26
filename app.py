"""
app.py  –  Application factory for the Oxford 3000 Vocabulary Trainer.

Usage
-----
  # Development
  python app.py

  # Production (gunicorn)
  gunicorn "app:create_app('production')" --workers 2 --bind 0.0.0.0:8000

Routes are split into two Blueprints:
  auth_bp     (routes/auth_routes.py)   – login, register, logout
  session_bp  (routes/session_routes.py) – dashboard, SRS API, import
"""

import os
import sys
from datetime import timedelta

from flask import Flask

from config import config
from database import init_db

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

_HERE = os.path.dirname(os.path.abspath(__file__))


# ── Secret key ────────────────────────────────────────────────────────────────

def _load_or_create_secret(path: str) -> bytes:
    """
    Return the Flask secret key using the following priority:

    1. SECRET_KEY environment variable  (production / Render — set in dashboard)
    2. .secret_key file on disk         (local development — auto-generated on
                                         first run; never commit to git)
    """
    # Production: Render injects SECRET_KEY as an env var (auto-generated value).
    env_key = os.environ.get("SECRET_KEY", "")
    if env_key:
        return env_key.encode("utf-8")

    # Development fallback: persist a random key to .secret_key so sessions
    # survive server restarts between coding sessions.
    if os.path.exists(path):
        with open(path, "rb") as fh:
            return fh.read()
    key = os.urandom(32)
    with open(path, "wb") as fh:
        fh.write(key)
    return key


# ── Application factory ───────────────────────────────────────────────────────

def create_app(config_name: str = "default") -> Flask:
    """
    Create and configure the Flask application.

    Parameters
    ----------
    config_name : One of "development", "production", or "default".
    """
    app = Flask(__name__)

    # Load config class
    cfg = config[config_name]
    app.config.from_object(cfg)

    # Secret key (persisted to disk, never committed to VCS)
    key_path = os.path.join(_HERE, ".secret_key")
    app.secret_key                 = _load_or_create_secret(key_path)
    app.permanent_session_lifetime = timedelta(days=30)

    # Initialise extensions (must come before blueprint registration)
    from extensions import csrf, limiter
    csrf.init_app(app)
    limiter.init_app(app)

    # Register Blueprints
    from routes.auth_routes import auth_bp
    from routes.session_routes import session_bp
    app.register_blueprint(auth_bp)
    app.register_blueprint(session_bp)

    # Exempt the JSON API / SPA blueprint from CSRF.
    # These endpoints are protected by:
    #   • Flask session cookie (HttpOnly, signed)
    #   • Content-Type: application/json  (browser CORS blocks cross-origin JSON POST)
    # Form-based endpoints (login / register) in auth_bp keep full CSRF protection.
    csrf.exempt(session_bp)

    # Initialise database (creates tables + runs column migrations)
    with app.app_context():
        init_db()

    # ── Security headers ──────────────────────────────────────────────────────
    # Injected on every response so browsers enforce safe defaults.
    @app.after_request
    def add_security_headers(response):
        # Prevent this page from being embedded in an <iframe> (clickjacking)
        response.headers["X-Frame-Options"] = "DENY"
        # Stop browsers from guessing content types (MIME sniffing attacks)
        response.headers["X-Content-Type-Options"] = "nosniff"
        # Tell browsers to always use HTTPS for the next year (production only)
        if not app.debug:
            response.headers["Strict-Transport-Security"] = (
                "max-age=31536000; includeSubDomains"
            )
        # Restrict sources for scripts, styles, and other resources (CSP)
        # 'self'       = same origin only
        # 'unsafe-inline' = needed for Tailwind/inline styles in the SPA
        # data:        = needed for inline SVG / font data URIs
        response.headers["Content-Security-Policy"] = (
            "default-src 'self'; "
            "script-src 'self' 'unsafe-inline'; "
            "style-src 'self' 'unsafe-inline'; "
            "img-src 'self' data:; "
            "font-src 'self' data:; "
            "connect-src 'self' https://api.dictionaryapi.dev;"
        )
        # Prevent the page from reading referrer headers when navigating away
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        return response

    return app


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    app = create_app("development")
    app.run(debug=True, port=5000, use_reloader=False)
