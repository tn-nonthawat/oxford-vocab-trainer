"""
srs.py  -  SuperMemo-2 (SM-2) spaced-repetition algorithm.

Public API
----------
calculate_next_review(quality, current_interval, current_ef, current_repetitions)
    -> (interval, easiness_factor, repetitions, next_review_date_str)

Quality scale
-------------
  0  Total blackout, complete failure to recall.
  1  Incorrect response; correct answer felt familiar when seen.
  2  Incorrect response; easily recalled once shown the answer.
  3  Correct response, but required serious effort to recall.
  4  Correct response after a moment of hesitation.
  5  Perfect response, instant recall.

SM-2 rules
----------
  q < 3  ->  reset: repetitions = 0, interval = 1
  q >= 3 ->  repetitions += 1
               rep 1: interval = 1
               rep 2: interval = 6
               rep 3+: interval = round(prev_interval * EF)
  EF_new  = EF + 0.1 - (5-q)*(0.08 + (5-q)*0.02)   [minimum 1.3]
  next_review_date = today + interval days
"""

from datetime import date, timedelta


def calculate_next_review(
    quality: int,
    current_interval: int,
    current_ef: float,
    current_repetitions: int,
) -> tuple[int, float, int, str]:
    """
    Apply one SM-2 review cycle and return the updated SRS state.

    Parameters
    ----------
    quality            : int   - response quality 0-5
    current_interval   : int   - days until the previous next-review date
    current_ef         : float - current easiness factor (>= 1.3)
    current_repetitions: int   - number of successful repetitions so far

    Returns
    -------
    (interval, easiness_factor, repetitions, next_review_date)
      interval         : int   - days until the next review
      easiness_factor  : float - updated EF (>= 1.3), rounded to 2 dp
      repetitions      : int   - updated successful-repetition count
      next_review_date : str   - ISO-8601 date string "YYYY-MM-DD"
    """
    q    = int(quality)
    ef   = float(current_ef)
    reps = int(current_repetitions)
    iv   = int(current_interval)

    if q < 3:
        # Failed recall – restart the repetition counter.
        reps = 0
        iv   = 1
    else:
        # Successful recall – advance along the SM-2 interval schedule.
        if reps == 0:
            iv = 1
        elif reps == 1:
            iv = 6
        else:
            iv = round(iv * ef)
        reps += 1

    # Update EF (clamp to minimum 1.3).
    new_ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    new_ef = max(1.3, round(new_ef, 2))

    next_date = (date.today() + timedelta(days=iv)).strftime("%Y-%m-%d")

    return iv, new_ef, reps, next_date


# ── quick self-test ───────────────────────────────────────────────────────────

if __name__ == "__main__":
    import sys
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    print("SM-2 self-test\n" + "-" * 52)
    cases = [
        # quality, interval, ef, reps  ->  expected outcome description
        (5, 0, 2.5, 0, "Brand-new word, perfect recall  -> rep 1, interval 1"),
        (5, 1, 2.5, 1, "Second review, perfect           -> rep 2, interval 6"),
        (4, 6, 2.5, 2, "Third review, good               -> rep 3, interval 15"),
        (3, 15, 2.5, 3, "Struggled                        -> EF drops slightly"),
        (1, 15, 2.5, 3, "Incorrect                        -> reset to reps=0, iv=1"),
        (0, 1, 1.3, 0, "Blackout on min EF               -> EF stays >= 1.3"),
    ]
    for quality, iv, ef, reps, desc in cases:
        new_iv, new_ef, new_reps, next_d = calculate_next_review(quality, iv, ef, reps)
        print(f"  q={quality}  iv={iv:>3}  ef={ef}  reps={reps}"
              f"  =>  iv={new_iv:>3}  ef={new_ef}  reps={new_reps}  next={next_d}")
        print(f"       {desc}")
    print()
