"""
fsrs.py  —  FSRS-5 spaced-repetition algorithm (default parameters, no personalization).

Public API
----------
calculate_next_review(quality, stability, difficulty, elapsed_days)
    -> (interval, new_stability, new_difficulty, next_date_str)

Grade mapping from app quality (0-5)
-------------------------------------
  0-2  ->  1  Again  (failed recall)
  3    ->  2  Hard   (recalled with serious effort)
  4    ->  3  Good   (recalled after hesitation)
  5    ->  4  Easy   (instant perfect recall)

References
----------
  FSRS-5 paper: https://github.com/open-spaced-repetition/fsrs5
  Default weights from py-fsrs v3.x
"""

import math
from datetime import timedelta

from services.date_service import get_current_date

# ── FSRS-5 default weights ────────────────────────────────────────────────────
# w[0-3]   : initial stability per grade (Again/Hard/Good/Easy)
# w[4-7]   : initial difficulty and update coefficients
# w[8-10]  : stability-after-recall coefficients
# w[11-14] : stability-after-forgetting coefficients
# w[15-16] : hard penalty, easy bonus multipliers
W = [
    0.40255, 1.18385, 3.1262,  15.4722,   # initial stability
    7.2102,  0.5316,  1.0651,  0.0589,    # difficulty
    1.4701,  0.1544,  1.0070,             # recall stability
    1.9395,  0.1100,  0.2900,  0.2700,   # forget stability
    2.9898,  0.5100,                      # hard/easy multipliers
]

DECAY             = -0.5
FACTOR            = 0.9 ** (1.0 / DECAY) - 1   # ≈ 0.2346
DESIRED_RETENTION = 0.9


# ── Internal helpers ──────────────────────────────────────────────────────────

def _grade(quality: int) -> int:
    if quality <= 2: return 1   # Again
    if quality == 3: return 2   # Hard
    if quality == 4: return 3   # Good
    return 4                    # Easy


def _retrievability(elapsed_days: float, stability: float) -> float:
    return (1.0 + FACTOR * elapsed_days / stability) ** DECAY


def _initial_stability(grade: int) -> float:
    return round(W[grade - 1], 4)


def _initial_difficulty(grade: int) -> float:
    d = W[4] - math.exp(W[5] * (grade - 1)) + 1.0
    return round(max(1.0, min(10.0, d)), 2)


def _stability_after_recall(d: float, s: float, r: float, grade: int) -> float:
    hard_penalty = W[15] if grade == 2 else 1.0
    easy_bonus   = W[16] if grade == 4 else 1.0
    new_s = s * (
        math.exp(W[8]) * (11.0 - d)
        * s ** (-W[9])
        * (math.exp((1.0 - r) * W[10]) - 1.0)
        * hard_penalty * easy_bonus
        + 1.0
    )
    return round(max(0.1, new_s), 2)


def _stability_after_forget(d: float, s: float, r: float) -> float:
    new_s = (
        W[11]
        * d ** (-W[12])
        * ((s + 1.0) ** W[13] - 1.0)
        * math.exp((1.0 - r) * W[14])
    )
    return round(max(0.1, new_s), 2)


def _next_difficulty(d: float, grade: int) -> float:
    next_d = d - W[7] * (grade - 3)
    # Mean reversion toward initial difficulty for grade 3 (Good)
    reverted = W[6] * _initial_difficulty(3) + (1.0 - W[6]) * next_d
    return round(max(1.0, min(10.0, reverted)), 2)


def _next_interval(stability: float) -> int:
    iv = stability / FACTOR * (DESIRED_RETENTION ** (1.0 / DECAY) - 1.0)
    return max(1, round(iv))


# ── Public API ─────────────────────────────────────────────────────────────────

def calculate_next_review(
    quality: int,
    stability: float,
    difficulty: float,
    elapsed_days: int,
) -> tuple[int, float, float, str]:
    """
    Apply one FSRS-5 review cycle.

    Parameters
    ----------
    quality      : int   - app quality scale 0-5
    stability    : float - current memory stability in days
    difficulty   : float - card difficulty 1-10
    elapsed_days : int   - days since the card was last reviewed

    Returns
    -------
    (interval, new_stability, new_difficulty, next_review_date_str)
    """
    grade  = _grade(quality)
    today  = get_current_date()
    r      = _retrievability(max(1, elapsed_days), stability)

    if grade == 1:  # Again — forgotten
        new_s  = _stability_after_forget(difficulty, stability, r)
        new_d  = _next_difficulty(difficulty, grade)
        iv     = 1
    else:           # Hard / Good / Easy — remembered
        new_s  = _stability_after_recall(difficulty, stability, r, grade)
        new_d  = _next_difficulty(difficulty, grade)
        iv     = _next_interval(new_s)

    next_date = (today + timedelta(days=iv)).strftime("%Y-%m-%d")
    return iv, new_s, new_d, next_date


def init_card(quality: int) -> tuple[int, float, float, str]:
    """
    Initialize FSRS state for a card being reviewed for the first time.
    Returns (interval, stability, difficulty, next_review_date_str).
    """
    grade   = _grade(quality)
    new_s   = _initial_stability(grade)
    new_d   = _initial_difficulty(grade)
    iv      = 1 if grade == 1 else _next_interval(new_s)
    today   = get_current_date()
    next_date = (today + timedelta(days=iv)).strftime("%Y-%m-%d")
    return iv, new_s, new_d, next_date


def sm2_to_fsrs(interval: int, easiness_factor: float) -> tuple[float, float]:
    """
    Approximate FSRS state from existing SM-2 row.
    stability ≈ interval (with 90% retention target, S ≈ I)
    difficulty ≈ inverse-mapped from EF (EF 2.5→D 3.7, EF 1.3→D 10, EF 3.0→D 1)
    """
    stability  = max(1.0, float(interval))
    difficulty = round(max(1.0, min(10.0, 10.0 - (easiness_factor - 1.3) / 1.7 * 9.0)), 2)
    return stability, difficulty
