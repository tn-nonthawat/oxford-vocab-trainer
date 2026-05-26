"""
extensions.py  –  Shared Flask extensions (initialised without app, then bound
                  via init_app() in the application factory).

Keeping extensions here avoids circular imports between app.py and the
blueprints that need to reference them (e.g. auth_routes needs `limiter`).
"""

from flask_limiter import Limiter
from flask_limiter.util import get_remote_address
from flask_wtf.csrf import CSRFProtect

# ── Rate limiter ───────────────────────────────────────────────────────────────
# key_func     : limit by client IP address
# storage_uri  : in-memory (no Redis needed; per-process — fine for 1–2 workers)
# default_limits: no global limit; limits are set per-route
limiter = Limiter(
    key_func=get_remote_address,
    default_limits=[],
    storage_uri="memory://",
)

# ── CSRF protection ────────────────────────────────────────────────────────────
# Automatically validates a hidden `csrf_token` field on every POST request.
# Token is injected into templates via {{ csrf_token() }}.
csrf = CSRFProtect()
