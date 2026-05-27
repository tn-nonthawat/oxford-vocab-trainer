"""
services/date_service.py  –  Reliable current-date helper.

Fetches the date from the WorldTimeAPI (Asia/Bangkok, UTC+7) rather than
relying on the local system clock.  This is necessary because the host
machine has a dead BIOS battery and its RTC may drift or reset after reboots.

A 60-second in-memory cache avoids redundant HTTP calls within a single
request or across rapid back-to-back requests.

Fallback strategy (3 tiers)
----------------------------
Tier 1 — WorldTimeAPI  (primary, network)
Tier 2 — Last known good date stored in SQLite  (if API fails ≥ 3 times in a row)
Tier 3 — Host system clock via zoneinfo Asia/Bangkok  (last resort; may drift
          after reboot but keeps the app running)
"""

import json
import sys
import time
import urllib.request
from datetime import date, datetime
from zoneinfo import ZoneInfo

_BANGKOK_TZ   = ZoneInfo("Asia/Bangkok")
# timeapi.io — free, no auth, returns {"dateTime": "2026-05-27T14:30:00.123456"}
_TIME_API_URL = "https://timeapi.io/api/time/current/zone?timeZone=Asia%2FBangkok"
_CACHE_TTL    = 60    # seconds — how long a fetched date is considered fresh
_FAIL_THRESH  = 3     # consecutive API failures before switching to DB fallback

# ── In-memory cache ───────────────────────────────────────────────────────────
_cache: dict = {
    "value"     : None,   # date | None
    "ts"        : 0.0,    # monotonic timestamp of last successful fetch
    "fail_count": 0,      # consecutive API failures since last success
}


# ── Tier 2: DB-persisted last-known-good date ─────────────────────────────────

def _load_db_date() -> date | None:
    """Read the last successfully fetched date from the database (if any)."""
    try:
        from database import get_connection          # import here to avoid circular
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute(
            "SELECT value FROM app_meta WHERE key = 'last_known_date' LIMIT 1"
        )
        row = cur.fetchone()
        conn.close()
        if row and row["value"]:
            return date.fromisoformat(row["value"])
    except Exception:
        pass
    return None


def _save_db_date(d: date) -> None:
    """Persist a successfully fetched date so it can be used as Tier-2 fallback."""
    try:
        from database import get_connection
        conn = get_connection()
        cur  = conn.cursor()
        # app_meta is created by database._migrate() — safe to UPSERT
        cur.execute("""
            INSERT INTO app_meta (key, value) VALUES ('last_known_date', ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value
        """, (d.isoformat(),))
        conn.commit()
        conn.close()
    except Exception:
        pass                    # silently skip — persistence is best-effort


# ── Public API ────────────────────────────────────────────────────────────────

def get_current_date() -> date:
    """
    Return today's date in the Asia/Bangkok timezone (UTC+7).

    Strategy
    --------
    1. Return the cached value if it is less than 60 seconds old.
    2. Otherwise GET the WorldTimeAPI and parse the "datetime" field.
       On success: reset fail_count, persist date to DB, cache result.
    3. On failure: increment fail_count.
       • fail_count < _FAIL_THRESH → use zoneinfo (host clock) as temporary fallback.
       • fail_count >= _FAIL_THRESH → try the last-known-good date from SQLite;
         if that is unavailable, use zoneinfo host clock.
    """
    now = time.monotonic()

    # ── Cache hit ─────────────────────────────────────────────────────────────
    if _cache["value"] is not None and now - _cache["ts"] < _CACHE_TTL:
        return _cache["value"]

    # ── Tier 1: timeapi.io ───────────────────────────────────────────────────
    try:
        req = urllib.request.Request(
            _TIME_API_URL,
            headers={"User-Agent": "OxfordVocabTrainer/3.0"},
        )
        with urllib.request.urlopen(req, timeout=4) as resp:
            payload = json.loads(resp.read().decode())
            # timeapi.io returns {"dateTime": "2026-05-27T14:30:00.123"}
            raw    = payload.get("dateTime") or payload.get("datetime", "")
            result = date.fromisoformat(raw[:10])

        # Success — reset failure counter, persist to DB, update cache
        _cache["fail_count"] = 0
        _cache["value"]      = result
        _cache["ts"]         = now
        _save_db_date(result)
        return result

    except Exception as exc:
        _cache["fail_count"] += 1
        fail_n = _cache["fail_count"]
        print(
            f"[date] WorldTimeAPI unavailable (attempt #{fail_n}): {exc}",
            file=sys.stderr,
        )

    # ── Tier 2: last-known-good date from SQLite (after _FAIL_THRESH misses) ──
    if _cache["fail_count"] >= _FAIL_THRESH:
        db_date = _load_db_date()
        if db_date is not None:
            print(
                f"[date] Tier-2 fallback: using last-known-good date from DB ({db_date}).",
                file=sys.stderr,
            )
            _cache["value"] = db_date
            _cache["ts"]    = now
            return db_date

    # ── Tier 3: host clock via zoneinfo (always available, may drift) ─────────
    result = datetime.now(_BANGKOK_TZ).date()
    print(
        f"[date] Tier-3 fallback: using host clock via zoneinfo ({result}). "
        "Clock may be inaccurate after reboot.",
        file=sys.stderr,
    )
    _cache["value"] = result
    _cache["ts"]    = now
    return result
