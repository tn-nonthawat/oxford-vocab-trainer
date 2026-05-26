"""
config.py  –  Centralised configuration for the Oxford 3000 Vocabulary Trainer.

Usage
-----
  from config import config
  cfg_class = config["production"]
  app.config.from_object(cfg_class)

The secret key is intentionally omitted from here; it is loaded (or generated)
by create_app() from the .secret_key file so it is never committed to version
control.
"""

import os

# Project root — the directory that contains this file.
_HERE = os.path.dirname(os.path.abspath(__file__))


class BaseConfig:
    # ── Database ──────────────────────────────────────────────────────────────
    DB_PATH  = os.path.join(_HERE, "vocab_app.db")

    # ── PDF word list ──────────────────────────────────────────────────────────
    PDF_PATH = os.path.join(_HERE, "American_Oxford_3000.pdf")

    # ── External date API ─────────────────────────────────────────────────────
    TIME_API_URL = "https://worldtimeapi.org/api/timezone/Asia/Bangkok"

    # ── Invite code ───────────────────────────────────────────────────────────
    # Set INVITE_CODE env var in production to require a secret code at signup.
    # Leave unset (or empty) to allow open registration (e.g. local dev).
    INVITE_CODE = os.environ.get("INVITE_CODE", "")

    # ── Request size limit ────────────────────────────────────────────────────
    MAX_CONTENT_LENGTH = 16 * 1024   # 16 KB — more than enough for any API call

    # ── Session lifetime ──────────────────────────────────────────────────────
    PERMANENT_SESSION_LIFETIME_DAYS = 30

    # ── Secret key file location ──────────────────────────────────────────────
    SECRET_KEY_PATH = os.path.join(_HERE, ".secret_key")


class DevelopmentConfig(BaseConfig):
    DEBUG = True
    SESSION_COOKIE_SECURE   = False   # allow HTTP in local dev
    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"


class ProductionConfig(BaseConfig):
    DEBUG = False
    SESSION_COOKIE_SECURE   = True    # HTTPS only
    SESSION_COOKIE_HTTPONLY = True    # JS cannot read the cookie
    SESSION_COOKIE_SAMESITE = "Lax"  # blocks cross-site POST


# Registry consumed by create_app()
config: dict[str, type] = {
    "development": DevelopmentConfig,
    "production":  ProductionConfig,
    "default":     DevelopmentConfig,
}
