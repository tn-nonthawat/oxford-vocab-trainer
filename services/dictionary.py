"""
services/dictionary.py  –  Free Dictionary API lookup with graceful fallbacks.

Public API
----------
  fetch_meaning(word, pos, cefr) -> (meaning_str, example_str)

All other names are implementation details.
"""

import json
import urllib.error
import urllib.parse
import urllib.request

# ── POS label map ─────────────────────────────────────────────────────────────
_POS_TO_ENGLISH: dict[str, str] = {
    "n.":      "noun",
    "v.":      "verb",
    "adj.":    "adjective",
    "adv.":    "adverb",
    "prep.":   "preposition",
    "conj.":   "conjunction",
    "pron.":   "pronoun",
    "det.":    "determiner",
    "exclam.": "exclamation",
    "num.":    "numeral",
    "modal":   "modal verb",
    "abbr.":   "abbreviation",
    "suffix":  "suffix",
    "prefix":  "prefix",
}


def _stub_meaning(word: str, pos: str, cefr: str) -> str:
    """Return a graceful fallback when the dictionary API has no result."""
    label = _POS_TO_ENGLISH.get(pos, pos.rstrip("."))
    return (
        f"({label} · {cefr}) "
        f'This Oxford 3000 word has no cached definition yet. '
        f'Look up "{word}" in a dictionary for its full meaning.'
    )


def _query_free_dict(word: str) -> list[dict]:
    """
    Call the Free Dictionary API and return the parsed JSON entry list.

    Raises
    ------
    urllib.error.HTTPError (404)  – word not found
    urllib.error.URLError         – network failure
    """
    url = (
        "https://api.dictionaryapi.dev/api/v2/entries/en/"
        + urllib.parse.quote(word, safe="")
    )
    req = urllib.request.Request(
        url, headers={"User-Agent": "OxfordVocabTrainer/3.0"}
    )
    with urllib.request.urlopen(req, timeout=6) as resp:
        return json.loads(resp.read().decode())


def _extract_from_entries(
    entries: list[dict], target_pos: str | None
) -> tuple[str, str]:
    """
    Walk the entry list and return the best (definition, example) pair.

    First attempts to match *target_pos*; falls back to any part of speech
    if no matching entry is found.
    """
    def _scan(entries, pos_filter):
        for entry in entries:
            for block in entry.get("meanings", []):
                if pos_filter and block.get("partOfSpeech") != pos_filter:
                    continue
                for defn in block.get("definitions", []):
                    meaning = defn.get("definition", "").strip()
                    example = defn.get("example", "").strip()
                    if meaning:
                        return meaning, example
        return "", ""

    meaning, example = _scan(entries, target_pos)
    if not meaning:
        meaning, example = _scan(entries, None)   # relax the POS filter
    return meaning, example


def fetch_meaning(word: str, pos: str, cefr: str) -> tuple[str, str]:
    """
    Return *(meaning, example_sentence)* for *word*.

    Strategy
    --------
    1. Try the exact word with the Free Dictionary API.
    2. If the word is a multi-word phrase and the API returns 404, retry
       with the first token (e.g. "a lot" → "a").  Skip single characters.
    3. On any failure return a graceful stub so the UI never shows an empty
       card back.
    """
    target_pos = _POS_TO_ENGLISH.get(pos)

    try:
        entries = _query_free_dict(word)
        meaning, example = _extract_from_entries(entries, target_pos)
        return meaning or _stub_meaning(word, pos, cefr), example

    except urllib.error.HTTPError as exc:
        if exc.code == 404 and " " in word:
            first = word.split()[0]
            if len(first) > 1:
                try:
                    entries = _query_free_dict(first)
                    meaning, example = _extract_from_entries(entries, target_pos)
                    return meaning or _stub_meaning(word, pos, cefr), example
                except Exception:
                    pass
        return _stub_meaning(word, pos, cefr), ""

    except Exception:
        return _stub_meaning(word, pos, cefr), ""
