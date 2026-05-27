# Oxford 3000 Vocabulary Trainer — Project Guide for AI Assistants

## What this project is

A **multi-user web application** for learning English vocabulary using the **Oxford 3000 word list**
with a **Spaced-Repetition System (SRS)** based on the **SuperMemo-2 (SM-2)** algorithm.

- Backend: **Python / Flask** (no ORM — raw SQLite via `sqlite3`)
- Frontend: **React SPA** (built with Vite, served as static files from Flask)
- Database: **SQLite** (`vocab_app.db`) — single file, WAL mode
- Deployment: **Fly.io** (app name `oxford-vocab-tn`, region `sin` — Singapore)
- Word source: `American_Oxford_3000.pdf` — parsed at runtime with `pdfplumber`

---

## Directory layout

```
Learn English/
├── app.py                   # Application factory (create_app)
├── config.py                # Config classes: DevelopmentConfig / ProductionConfig
├── database.py              # SQLite helpers: get_connection(), init_db(), _migrate()
├── srs.py                   # Pure SM-2 algorithm — calculate_next_review()
├── fly.toml                 # Fly.io deployment config
├── requirements.txt         # Flask, Werkzeug, pdfplumber, gunicorn
├── American_Oxford_3000.pdf # Source word list (3 000 words, A1–B2 CEFR)
│
├── models/
│   └── auth.py              # hash_password(), verify_password(), @login_required
│
├── routes/
│   ├── auth_routes.py       # Blueprint "auth" — /login, /register, /logout
│   └── session_routes.py    # Blueprint "session" — /, /api/*, /import-*
│
├── services/
│   ├── date_service.py      # get_current_date() — timeapi.io + 3-tier fallback
│   ├── dictionary.py        # fetch_meaning(word, pos, cefr) — Free Dictionary API
│   ├── importer.py          # Background PDF import worker (_start_import, _snapshot)
│   └── stats.py             # Per-user stats helpers (_word_counts, _progress_stats, …)
│
├── static/react/            # Compiled React SPA (Vite output — NOT committed to git)
│   ├── index.html
│   └── assets/              # Hashed JS/CSS bundles
│
└── dashboard-react/         # React source (Vite project)
    └── src/
        ├── App.jsx
        ├── Dashboard.jsx    # Main dashboard — cards, quota bar, word-list modal
        └── Session.jsx      # Flashcard session — new-word + review modes
```

---

## Database schema

```sql
-- Registered users
users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT    NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT    NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    created_at    TEXT    DEFAULT (date('now'))
)

-- Shared Oxford 3000 word list (same for all users)
words (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    word             TEXT    NOT NULL,
    pos              TEXT,          -- e.g. "n.", "v.", "adj."
    cefr_level       TEXT,          -- A1 | A2 | B1 | B2
    meaning          TEXT,          -- cached from Free Dictionary API
    example_sentence TEXT           -- cached from Free Dictionary API
)

-- Per-user SM-2 SRS state (composite unique: user_id + word_id)
progress (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id          INTEGER NOT NULL REFERENCES users(id),
    word_id          INTEGER NOT NULL REFERENCES words(id),
    interval         INTEGER DEFAULT 0,
    easiness_factor  REAL    DEFAULT 2.5,
    repetitions      INTEGER DEFAULT 0,
    next_review_date TEXT,          -- ISO-8601 "YYYY-MM-DD"
    created_at       TEXT,          -- date word was first introduced (ISO-8601)
    UNIQUE (user_id, word_id)
)

-- Per-user daily streak
user_stats (
    user_id            INTEGER PRIMARY KEY REFERENCES users(id),
    last_activity_date TEXT,
    current_streak     INTEGER DEFAULT 0
)

-- App-wide key-value metadata store
app_meta (
    key   TEXT PRIMARY KEY,
    value TEXT
    -- used keys: "last_known_date" (date_service Tier-2 fallback)
)
```

**Migration note:** `database._migrate()` runs on every startup and is idempotent.
Migration steps (in order):
1. Add `words.meaning` / `words.example_sentence`
2. Add `progress.user_id` (multi-user upgrade — old rows assigned to `legacy` user)
3. Upgrade `user_stats` from singleton → per-user schema
4. Add `users.is_admin` (first real user auto-promoted)
5. Add `progress.created_at` (tracks when each word was first introduced)
6. Insert missing number/article words that the old PDF parser missed

---

## Key API routes

All `/api/*` and session routes require login (`@login_required` → checks `session["user_id"]`).

| Method | Path | Description |
|--------|------|-------------|
| GET/POST | `/login` | Login form |
| GET/POST | `/register` | Register form |
| GET | `/logout` | Clear session, redirect to `/login` |
| GET | `/` | Serve React SPA (`static/react/index.html`) |
| GET | `/assets/<filename>` | Serve Vite-built JS/CSS bundles |
| POST | `/import-data` | Start background PDF import thread (admin only) |
| GET | `/import-status` | Poll import progress `{status, pages_done, total_pages, words_found}` |
| GET | `/api/new-session?level=A1` | 10 random unseen words (optional CEFR filter) |
| GET | `/api/review-session` | Up to 20 words due for review today (oldest first) |
| POST | `/api/submit-review` | `{word_id, quality}` → SM-2 update + streak update |
| GET | `/api/stats` | Dashboard stats for logged-in user (see shape below) |
| GET | `/api/word-meaning/<word_id>` | Fetch (and cache) meaning from Free Dictionary API |
| GET | `/api/word-list?category=X` | Words grouped by memory category (see below) |

### `/api/stats` response shape
```json
{
  "username":     "string",
  "total":        3000,
  "level_counts": {"A1": 600, "A2": 750, "B1": 900, "B2": 750},
  "introduced":   56,
  "due_today":    4,
  "new_today":    3,
  "streak":       5,
  "mastered":     0,
  "learning":     40,
  "struggling":   16
}
```
- `new_today` — words first introduced today (`progress.created_at = today AND repetitions = 1`)

### `/api/word-list?category=X`
Valid values: `mastered` | `learning` | `struggling` | `introduced`

Returns:
```json
{
  "category": "struggling",
  "words": [
    {"id": 1, "word": "...", "pos": "n.", "cefr_level": "B1",
     "repetitions": 2, "easiness_factor": 1.7, "interval": 3,
     "next_review_date": "2026-05-28"}
  ]
}
```

---

## SM-2 algorithm (srs.py)

```python
calculate_next_review(quality, current_interval, current_ef, current_repetitions)
    → (interval, easiness_factor, repetitions, next_review_date_str)
```

- `quality` 0–5 (0 = total blackout, 5 = perfect instant recall)
- `quality < 3` → reset: `repetitions=0, interval=1`
- `quality >= 3` → advance: rep1→iv=1, rep2→iv=6, rep3+→iv=round(iv×EF)
- EF updated: `EF_new = EF + 0.1 - (5-q)*(0.08 + (5-q)*0.02)`, min 1.3
- Mastery thresholds used in stats: `repetitions >= 4` = mastered, `EF < 1.8` = struggling

---

## Date service (important!)

The host machine has a **dead BIOS battery** — the system clock may be wrong after reboot.
`services/date_service.py` uses a **3-tier fallback strategy**:

| Tier | Source | Trigger |
|------|--------|---------|
| 1 | **timeapi.io** `GET /api/time/current/zone?timeZone=Asia%2FBangkok` | Always try first |
| 2 | **SQLite `app_meta`** key `last_known_date` | After ≥ 3 consecutive API failures |
| 3 | **Host clock** `datetime.now(ZoneInfo("Asia/Bangkok"))` | Last resort (may drift) |

Every successful Tier-1 fetch persists the date to `app_meta` so Tier-2 has fresh data.
Cache TTL is 60 seconds (in-memory).

**Never use `date.today()` directly** — always call `get_current_date()` from `services.date_service`.

---

## Daily new-word quota system

Implemented in `StudyCard` (Dashboard.jsx) + `_progress_stats()` (stats.py).

| Threshold | Behaviour |
|-----------|-----------|
| `new_today < 5` | ✅ Learn New Words button active (blue) |
| `5 ≤ new_today < 10` | ⚠️ Button active but quota bar turns amber + warning text |
| `new_today ≥ 10` | 🛑 Button disabled — "Daily limit reached" |
| `due_today > 0` | ⏰ Button disabled — "Clear X due words first" |

**Rule**: user must clear all due reviews (`due_today = 0`) before learning new words.
This prevents the review backlog from compounding.

---

## Review session — continues until due_today = 0

`Session.jsx` fetches words in batches of 20 (backend limit). After each batch:
- Fetches `/api/stats` to check `due_today`
- If `due_today > 0` → shows **BatchDone** interstitial (batch scores + remaining count + "Continue" button)
- If `due_today = 0` → shows **SessionComplete** screen with cumulative totals

Scores accumulate across batches (`totalScores` / `totalWords` state).

---

## Dashboard — clickable Memory Breakdown

Cards in the **Memory Breakdown** section and **Words Introduced** stat card are clickable.
Clicking opens a `WordListModal` that fetches `/api/word-list?category=X` and displays:
- Word, POS, CEFR level, next review date
- Search bar to filter the list
- Footer note explaining the category criteria

---

## Dictionary caching

`/api/word-meaning/<word_id>` fetches from `https://api.dictionaryapi.dev/api/v2/entries/en/<word>`.
Results are **persisted** in `words.meaning` and `words.example_sentence` so subsequent calls
skip the network entirely. Multi-word phrases fall back to the first token on 404.

---

## Authentication

- Passwords hashed with **Werkzeug** (`generate_password_hash` / `check_password_hash`)
- Session stored in Flask signed cookie (`session["user_id"]`, `session["username"]`)
- `@login_required` decorator in `models/auth.py` — redirects to `/login` if not authenticated
- Session lifetime: 30 days (permanent session)
- Secret key: loaded from env var `SECRET_KEY` (production) or `.secret_key` file (dev)
- Only `is_admin = 1` users can trigger `/import-data`

---

## Deployment (Fly.io)

```
App name : oxford-vocab-tn
Region   : sin (Singapore — closest to Thailand)
Machine  : shared-cpu-1x, 256 MB RAM
Volume   : vocab_data mounted at /data (DB_PATH=/data/vocab_app.db)
Port     : 8000 (gunicorn, 1 worker)
```

Useful commands:
```bash
fly deploy                          # deploy
fly ssh console                     # SSH into running machine
fly volumes list                    # check persistent volume
fly logs                            # tail logs
fly secrets set SECRET_KEY=<value>  # set secret env vars
```

---

## Local development

```bash
# Install dependencies
pip install -r requirements.txt

# Run dev server (port 5000)
python app.py

# Or use the batch file
start_server.bat

# Build React frontend (requires Node.js)
cd dashboard-react
npm install
npm run build   # outputs to ../static/react/
```

Environment variable `DB_PATH` overrides the default SQLite path.
The `.secret_key` file is auto-created on first run — do not commit it.

---

## Important implementation notes

1. **No ORM** — all DB access uses raw `sqlite3`. Every function opens and closes its own
   connection. WAL mode + `busy_timeout=10000` handles concurrency.

2. **Import resets progress** — `_do_import()` in `services/importer.py` deletes all rows
   in `progress` and `words` before re-importing. This is intentional (re-import = fresh start).

3. **React build not in git** — `static/react/` is gitignored. Must run `npm run build`
   inside `dashboard-react/` before deploying, or rely on the Docker multi-stage build.

4. **CEFR filter** — `/api/new-session?level=B1` filters new words by CEFR level.
   The React dashboard persists the selected level in `localStorage`.

5. **Legacy account** — `users` row with `id=1, username='legacy'` may exist if the DB
   was migrated from the pre-auth schema. It cannot log in (invalid password hash).

6. **Streak logic** — streak increments only if `last_activity_date == yesterday`.
   If already updated today, the row is left unchanged. Any gap resets streak to 1.

7. **`new_today` counting** — counts `progress` rows where `created_at = today AND repetitions = 1`.
   Existing rows migrated before this feature have `created_at = '2000-01-01'` as a placeholder.

8. **`app_meta` table** — generic key-value store. Currently only one key: `last_known_date`
   (written by `date_service._save_db_date()`, read by `_load_db_date()`).
