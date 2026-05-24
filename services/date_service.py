"""
services/date_service.py  –  Reliable current-date helper.

Fetches the date from the WorldTimeAPI (Asia/Bangkok, UTC+7) rather than
relying on the local system clock.  This is necessary because the host
machine has a dead BIOS battery and its RTC may drift or reset after reboots.

A 60-second in-memory cache avoids redundant HTTP calls within a single
request or across rapid back-to-back requests.
"""

import json
import sys
import time
import urllib.request
from datetime import date

# ── Cache ─────────────────────────────────────────────────────────────────────
_date_cache: dict = {"value": None, "ts": 0.0}
_TIME_API_URL = "http://worldtimeapi.org/api/timezone/Asia/Bangkok"
_CACHE_TTL    = 60   # seconds


def get_current_date() -> date:
    """
    Return today's date in the Asia/Bangkok timezone (UTC+7).

    Strategy
    --------
    1. Return the cached value if it is less than 60 seconds old.
    2. Otherwise GET the WorldTimeAPI and parse the "datetime" field.
    3. On any failure fall back silently to Python's date.today() so the
       app never crashes when offline.  The fallback is logged to stderr.
    """
    now = time.monotonic()
    if _date_cache["value"] is not None and now - _date_cache["ts"] < _CACHE_TTL:
        return _date_cache["value"]

    result: date | None = None
    try:
        req = urllib.request.Request(
            _TIME_API_URL,
            headers={"User-Agent": "OxfordVocabTrainer/3.0"},
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            payload = json.loads(resp.read().decode())
            # "datetime" looks like "2025-05-25T14:30:00.123456+07:00"
            result = date.fromisoformat(payload["datetime"][:10])
    except Exception as exc:
        print(
            f"[date] API unavailable ({exc}); falling back to system clock.",
            file=sys.stderr,
        )
        result = date.today()

    _date_cache["value"] = result
    _date_cache["ts"]    = now
    return result
