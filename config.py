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
    TIME_API_URL = "http://worldtimeapi.org/api/timezone/Asia/Bangkok"

    # ── Session lifetime ──────────────────────────────────────────────────────
    PERMANENT_SESSION_LIFETIME_DAYS = 30

    # ── Secret key file location ──────────────────────────────────────────────
    SECRET_KEY_PATH = os.path.join(_HERE, ".secret_key")


class DevelopmentConfig(BaseConfig):
    DEBUG = True


class ProductionConfig(BaseConfig):
    DEBUG = False


# Registry consumed by create_app()
config: dict[str, type] = {
    "development": DevelopmentConfig,
    "production":  ProductionConfig,
    "default":     DevelopmentConfig,
}
