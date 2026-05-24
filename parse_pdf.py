"""
parse_pdf.py  -  Robust Oxford 3000 PDF parser using pdfplumber.

Why coordinate-aware extraction?
  The Oxford 3000 PDF is a 4-column layout.  Plain text extraction reads
  columns top-to-bottom but merges words across column boundaries, producing
  garbage like "ar ticle agenda".  pdfplumber.extract_words() returns every
  word with its exact (x, y) bounding box.  We cluster words that share the
  same baseline into logical lines, sort by x, and join them -- giving clean,
  column-aware lines to parse.

Algorithm - corrected "anchor-right" logic (applied per logical line)
  We iterate over CEFR tokens left-to-right.  For each hit:
    1.  Look ONLY at text since the PREVIOUS CEFR token (prevents one
        entry's context bleeding into the next).
    2.  Find the FIRST POS tag in that segment (a word can have multiple POS
        tags like "n., v." -- the headword precedes the first one).
    3.  Strip parenthetical disambiguation notes, e.g. "bank (money) n."
    4.  Lowercase and take the last 1-3 clean alpha tokens as the word.
  Entries are deduplicated on the (word, pos) pair before insert.

Usage:
    python parse_pdf.py
"""

import os
import re
import sys
from collections import Counter, defaultdict

# Windows consoles default to cp1252 which cannot encode Thai path characters.
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

import pdfplumber

from database import get_connection, init_db

# ── paths ─────────────────────────────────────────────────────────────────────
HERE     = os.path.dirname(os.path.abspath(__file__))
PDF_PATH = os.path.join(HERE, "American_Oxford_3000.pdf")

# ── regex patterns ────────────────────────────────────────────────────────────

# Oxford POS abbreviations - longer/more-specific first to avoid prefix clashes.
POS_TAGS = [
    "exclam.", "modal", "suffix", "prefix", "abbr.",
    "prep.", "conj.", "pron.", "det.", "adj.", "adv.",
    "num.", "n.", "v.",
]
_pos_alt = "|".join(re.escape(t) for t in POS_TAGS)

# Lookahead allows digits and uppercase (so "adj.B1" matches without a space).
# Lookbehind still forbids a preceding letter (prevents "adj" inside "adjacent").
POS_RE  = re.compile(rf"(?<![A-Za-z])({_pos_alt})(?![a-z])")
CEFR_RE = re.compile(r"\b(A1|A2|B1|B2)\b")


# ── coordinate-aware line builder ─────────────────────────────────────────────

def _build_lines(page, y_tolerance: float = 3.0) -> list[str]:
    """
    Return a list of logical text lines for *page*, each built by:
      1.  Calling pdfplumber.extract_words() for exact word bounding boxes.
      2.  Grouping words whose y-midpoints are within y_tolerance of each
          other (same baseline = same visual line).
      3.  Sorting each group by its left x coordinate.
      4.  Joining with a single space.

    This correctly handles multi-column PDFs because words that are visually
    on the same line but in different columns share the same y-midpoint even
    though their x coordinates are far apart.
    """
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


# ── per-line triple extractor ─────────────────────────────────────────────────

def _triples_from_line(line: str) -> list[tuple[str, str, str]]:
    """
    Parse one logical text line and return a list of (word, pos, cefr) triples.

    Key design decisions
    --------------------
    1.  prev_end isolation:  only text SINCE the previous CEFR token is
        examined, so entries cannot bleed into each other.
    2.  First-POS rule:  we use the FIRST POS tag in the segment, not the
        last.  This correctly handles "about prep., adv. A1" (word = "about",
        pos = "prep.") versus old behaviour that would pick "adv." and then
        include "about prep.," in the word text.
    3.  Paren stripping:  disambiguation notes like "(money)" and "(river)"
        in "bank (money) n. A1" are removed before tokenising.
    4.  Slash-split POS:  "adj./adv." is split on "/" so both "adj." and
        "adv." can be found by POS_RE.
    """
    results: list[tuple[str, str, str]] = []
    prev_end = 0   # end position of the previous CEFR match

    for cefr_m in CEFR_RE.finditer(line):
        cefr    = cefr_m.group(1)
        # Only examine text BETWEEN the last CEFR token and this one.
        segment = line[prev_end: cefr_m.start()]
        prev_end = cefr_m.end()

        # Normalise slash-separated POS pairs like "adj./adv." → "adj. adv."
        segment = segment.replace("/", " ")

        # Find all POS tags in this segment.
        pos_matches = list(POS_RE.finditer(segment))
        if not pos_matches:
            continue   # no POS found in segment - skip (e.g. intro text)

        # Use the FIRST POS tag; the headword precedes it.
        first_pos  = pos_matches[0]
        pos        = first_pos.group(1)
        raw        = segment[: first_pos.start()]

        # Strip parenthetical disambiguation notes: "bank (money)" → "bank"
        raw = re.sub(r"\([^)]*\)", " ", raw)

        # Strip non-alphabetic noise (commas, digits, bullets, etc.)
        raw = re.sub(r"[^A-Za-z\s\-]", " ", raw)

        # Keep tokens that are genuine words: lowercase-starting, len > 1.
        tokens = [
            t for t in raw.split()
            if re.fullmatch(r"[a-z][a-z\-]*", t, re.IGNORECASE) and len(t) > 1
        ]

        if not tokens:
            continue

        # Multi-word headwords (e.g. "a lot", "as well as") have up to 3 parts.
        # Single words are the common case.
        word = " ".join(tokens[-3:]).strip().lower()

        if word:
            results.append((word, pos, cefr))

    return results


# ── main import ───────────────────────────────────────────────────────────────

def parse_and_import() -> None:
    if not os.path.exists(PDF_PATH):
        raise FileNotFoundError(
            f"PDF not found: {PDF_PATH}\n"
            "Make sure 'American_Oxford_3000.pdf' is in the same folder as this script."
        )

    print(f"[parser] Opening -> {PDF_PATH}")
    init_db()

    # Wipe any previous import so re-running is always safe and idempotent.
    conn = get_connection()
    cur  = conn.cursor()
    cur.execute("DELETE FROM progress")
    cur.execute("DELETE FROM words")
    conn.commit()

    # ── scan the PDF ──────────────────────────────────────────────────────────
    collected: list[tuple[str, str, str]] = []
    seen:      set[tuple[str, str]]       = set()     # dedup key = (word, pos)

    with pdfplumber.open(PDF_PATH) as pdf:
        total_pages = len(pdf.pages)
        print(f"[parser] {total_pages} pages found - scanning ...\n")

        for page_num, page in enumerate(pdf.pages, start=1):
            for line in _build_lines(page):
                line = line.strip()
                if not line:
                    continue
                for triple in _triples_from_line(line):
                    key = (triple[0], triple[1])    # (word, pos)
                    if key not in seen:
                        seen.add(key)
                        collected.append(triple)

            if page_num % 2 == 0 or page_num == total_pages:
                print(f"  ... page {page_num:>3}/{total_pages}"
                      f"  ({len(collected)} words so far)")

    # ── bulk insert ───────────────────────────────────────────────────────────
    cur.executemany(
        "INSERT INTO words (word, pos, cefr_level) VALUES (?, ?, ?)",
        collected,
    )
    conn.commit()
    conn.close()

    # ── verification report ───────────────────────────────────────────────────
    total        = len(collected)
    level_counts = Counter(cefr for _, _, cefr in collected)

    print(f"\n{'=' * 52}")
    print(f"  Import complete!")
    print(f"  Total words imported : {total}")
    print(f"{'=' * 52}")
    for lvl in ["A1", "A2", "B1", "B2"]:
        count = level_counts.get(lvl, 0)
        bar   = "#" * min(28, count // 20)
        print(f"  {lvl}  {bar:<28}  {count:>5} words")

    print(f"\n  Sample - first 5 imported words:")
    print(f"  {'Word':<24} {'POS':<12} CEFR")
    print(f"  {'-' * 42}")
    for word, pos, cefr in collected[:5]:
        print(f"  {word:<24} {pos:<12} {cefr}")
    print()


if __name__ == "__main__":
    parse_and_import()
