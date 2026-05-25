"""
services/importer.py  –  Background PDF import worker.

Parses American_Oxford_3000.pdf with pdfplumber (coordinate-aware layout),
extracts (word, pos, cefr_level) triples, and writes them to the shared
words table.

Public API
----------
  _start_import() -> bool          start background thread; False if already running
  _snapshot()     -> dict          thread-safe copy of current import state
  _set(**kw)      -> None          update import state (internal / routes use)

State dict keys: status, pages_done, total_pages, words_found, message
  status: "idle" | "running" | "done" | "error"
"""

import os
import re
import threading
from collections import defaultdict

from database import get_connection

# ── Project root (one level up from services/) ────────────────────────────────
_ROOT    = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF_PATH = os.path.join(_ROOT, "American_Oxford_3000.pdf")


# ── POS / CEFR regexes ────────────────────────────────────────────────────────
# "number" covers cardinal/ordinal numerals (one, two, hundred, million …)
# "indefinite article" covers "a" and "an"
# Longer tags must come before shorter ones so the alternation matches greedily.
POS_TAGS = [
    "indefinite article",                               # a, an
    "definite article",                                 # the
    "exclam.", "modal", "suffix", "prefix", "abbr.",
    "prep.", "conj.", "pron.", "det.", "adj.", "adv.",
    "number", "num.", "n.", "v.",
]
_pos_alt = "|".join(re.escape(t) for t in POS_TAGS)
POS_RE   = re.compile(rf"(?<![A-Za-z])({_pos_alt})(?![a-z])")
CEFR_RE  = re.compile(r"\b(A1|A2|B1|B2)\b")


# ── Import state (shared with route handlers via _snapshot / _set) ────────────
_lock  = threading.Lock()
_state: dict = dict(
    status="idle", pages_done=0, total_pages=0, words_found=0, message="Ready.",
)


def _set(**kw) -> None:
    with _lock:
        _state.update(kw)


def _snapshot() -> dict:
    with _lock:
        return dict(_state)


# ── PDF parsing helpers ───────────────────────────────────────────────────────

def _build_lines(page, y_tolerance: float = 3.0) -> list[str]:
    words = page.extract_words(x_tolerance=3, y_tolerance=3,
                               keep_blank_chars=False)
    if not words:
        return []
    buckets: dict[int, list] = defaultdict(list)
    for w in words:
        y_mid = round((w["top"] + w["bottom"]) / 2 / y_tolerance)
        buckets[y_mid].append(w)
    lines = []
    for y_key in sorted(buckets):
        row = sorted(buckets[y_key], key=lambda w: w["x0"])
        lines.append(" ".join(w["text"] for w in row))
    return lines


def _triples_from_line(line: str):
    prev_end = 0
    for cefr_m in CEFR_RE.finditer(line):
        cefr     = cefr_m.group(1)
        segment  = line[prev_end: cefr_m.start()].replace("/", " ")
        prev_end = cefr_m.end()
        pos_matches = list(POS_RE.finditer(segment))
        if not pos_matches:
            continue
        first_pos = pos_matches[0]
        pos       = first_pos.group(1)
        raw       = segment[: first_pos.start()]
        raw       = re.sub(r"\([^)]*\)", " ", raw)
        raw       = re.sub(r"[^A-Za-z\s\-]", " ", raw)
        # Allow single-letter words (e.g. "a", "the") for article POS tags.
        _article = pos in ("indefinite article", "definite article")
        min_len  = 1 if _article else 2
        tokens   = [
            t for t in raw.split()
            if re.fullmatch(r"[a-z][a-z\-]*", t, re.IGNORECASE) and len(t) >= min_len
        ]
        if not tokens:
            continue
        if _article:
            # "a, an" / "the" → emit each headword as its own row.
            for t in tokens:
                yield t.lower(), pos, cefr
        else:
            yield " ".join(tokens[-3:]).strip().lower(), pos, cefr


# ── Import worker ─────────────────────────────────────────────────────────────

def _do_import() -> None:
    try:
        if not os.path.exists(PDF_PATH):
            _set(status="error", message=f"PDF not found: {PDF_PATH}")
            return

        _set(status="running", pages_done=0, total_pages=0,
             words_found=0, message="Opening PDF …")

        try:
            import pdfplumber
        except ImportError:
            _set(status="error",
                 message="pdfplumber not installed.  Run: pip install pdfplumber")
            return

        with pdfplumber.open(PDF_PATH) as pdf:
            total_pages = len(pdf.pages)
            _set(total_pages=total_pages,
                 message=f"Scanning {total_pages} pages …")
            collected: list[tuple[str, str, str]] = []
            seen: set[tuple[str, str]] = set()
            for i, page in enumerate(pdf.pages, start=1):
                for line in _build_lines(page):
                    line = line.strip()
                    if not line:
                        continue
                    for triple in _triples_from_line(line):
                        key = (triple[0], triple[1])
                        if key not in seen:
                            seen.add(key)
                            collected.append(triple)
                _set(pages_done=i, words_found=len(collected),
                     message=f"Page {i}/{total_pages} – {len(collected)} words …")

        _set(message="Writing to database …")
        conn = get_connection()
        cur  = conn.cursor()
        cur.execute("DELETE FROM progress")
        cur.execute("DELETE FROM words")
        cur.executemany(
            "INSERT INTO words (word, pos, cefr_level) VALUES (?, ?, ?)",
            collected,
        )
        conn.commit()
        conn.close()
        _set(status="done", words_found=len(collected),
             message=f"Done! {len(collected)} words imported.")

    except Exception as exc:
        _set(status="error", message=f"Import failed: {exc}")


def _start_import() -> bool:
    """
    Spawn the import worker thread.

    Returns True if the thread was started, False if an import is already
    running (idempotent guard).
    """
    with _lock:
        if _state["status"] == "running":
            return False
        _state.update(status="running", pages_done=0, total_pages=0,
                      words_found=0, message="Starting …")
    threading.Thread(target=_do_import, daemon=True).start()
    return True
