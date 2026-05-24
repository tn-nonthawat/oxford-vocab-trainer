/**
 * app.js  –  Oxford 3000 Vocabulary Trainer — client-side logic.
 *
 * Expects the following constants to be defined by an inline <script> block
 * in dashboard.html BEFORE this file is loaded:
 *
 *   const INIT_TOTAL    = <int>;
 *   const INIT_STATE    = <object>;
 *   const INIT_PROGRESS = <object>;
 *   const INIT_STREAK   = <int>;
 *   const INIT_MASTERY  = <object>;
 */

"use strict";

// ── CEFR badge colour map ─────────────────────────────────────────────────────
const CEFR_CLS = {
  A1: "bg-emerald-100 text-emerald-700",
  A2: "bg-teal-100 text-teal-700",
  B1: "bg-blue-100 text-blue-700",
  B2: "bg-violet-100 text-violet-700",
};

// ── Session state ─────────────────────────────────────────────────────────────
let sess          = { type: null, words: [], idx: 0, correct: 0, struggled: 0, forgot: 0 };
let revealTimer   = null;    // handle for the 350 ms post-flip reveal timeout
let selectedLevel = "all";   // CEFR filter for "Learn New Words"

// ── DOM references ────────────────────────────────────────────────────────────
const panelImport   = $("panel-import");
const panelDash     = $("panel-dashboard");
const panelSession  = $("panel-session");

const impIdle       = $("imp-idle");
const impRunning    = $("imp-running");
const impError      = $("imp-error");
const importFill    = $("import-fill");
const pgDone        = $("pg-done");
const pgTotal       = $("pg-total");
const pgWords       = $("pg-words");
const pgMsg         = $("pg-msg");
const impErrorMsg   = $("imp-error-msg");

const btnBack       = $("btn-back");
const sessTypeLabel = $("sess-type-label");
const sessCounter   = $("sess-counter");
const sessCorrect   = $("sess-correct");
const sessForgot    = $("sess-forgot");
const sessBar       = $("sess-bar");

const cardInner     = $("card-inner");
const cardWord      = $("card-word");
const frontCefr     = $("front-cefr");
const badgeNew      = $("badge-new");
const backWord      = $("back-word");
const backPos       = $("back-pos");
const backCefr      = $("back-cefr");
const backMeaning   = $("back-meaning");
const backExample   = $("back-example");
const exampleWrap   = $("example-wrap");

const showMeanWrap  = $("show-meaning-wrap");
const btnShowMean   = $("btn-show-meaning");
const meaningLoad   = $("meaning-loading");
const ratingWrap    = $("rating-wrap");
const sessionComp   = $("session-complete");

function $(id) { return document.getElementById(id); }


// ── Panel helpers ─────────────────────────────────────────────────────────────
function showPanel(p) {
  panelImport.classList.toggle("hidden",  p !== "import");
  panelDash.classList.toggle("hidden",    p !== "dashboard");
  panelSession.classList.toggle("hidden", p !== "session");
  btnBack.classList.toggle("hidden",      p !== "session");
}

function showImportSub(s) {
  impIdle.classList.toggle("hidden",    s !== "idle");
  impRunning.classList.toggle("hidden", s !== "running");
  impError.classList.toggle("hidden",   s !== "error");
}


// ── Import polling ────────────────────────────────────────────────────────────
let pollTimer = null;

function applyImportSt(st) {
  const pct = st.total_pages > 0
    ? Math.round(st.pages_done / st.total_pages * 100) : 5;
  importFill.style.width = pct + "%";
  pgDone.textContent     = st.pages_done;
  pgTotal.textContent    = st.total_pages || "…";
  pgWords.textContent    = st.words_found;
  pgMsg.textContent      = st.message;
}

function startPolling() {
  if (pollTimer) return;
  pollTimer = setInterval(async () => {
    try {
      const st = await fetch("/import-status").then(r => r.json());
      applyImportSt(st);
      if (st.status === "done")  { stopPolling(); setTimeout(() => location.reload(), 1800); }
      if (st.status === "error") {
        stopPolling(); showImportSub("error"); impErrorMsg.textContent = st.message;
      }
    } catch (_) {}
  }, 1200);
}

function stopPolling() { clearInterval(pollTimer); pollTimer = null; }

async function triggerImport() {
  showPanel("import"); showImportSub("running");
  applyImportSt({ pages_done: 0, total_pages: 0, words_found: 0, message: "Sending …" });
  try { await fetch("/import-data", { method: "POST" }); } catch (_) {}
  startPolling();
}


// ── Session start ─────────────────────────────────────────────────────────────
async function startSession(type) {
  let url;
  if (type === "new") {
    url = selectedLevel !== "all"
        ? `/api/new-session?level=${encodeURIComponent(selectedLevel)}`
        : "/api/new-session";
  } else {
    url = "/api/review-session";
  }

  let data;
  try {
    const r = await fetch(url);
    data    = await r.json();
  } catch (e) {
    showToast("Network error – is the server running?", 4000); return;
  }

  if (!data.words || data.words.length === 0) {
    showToast(
      type === "new"
        ? (selectedLevel !== "all"
            ? `🎉 All ${selectedLevel} words introduced! Try another level or tap Review.`
            : "🎉 All words have been introduced! Use Review to practice them.")
        : "✅ Nothing due for review today – come back tomorrow!",
      4500
    );
    return;
  }

  sess = { type, words: data.words, idx: 0,
           correct: 0, struggled: 0, forgot: 0 };

  // Reset UI
  sessionComp.classList.add("hidden");
  cardInner.closest(".card-scene").classList.remove("hidden");
  showPanel("session");
  renderCard();
}


// ── Render one card ───────────────────────────────────────────────────────────
function renderCard() {
  // Cancel any stale "reveal rating buttons" timer from the previous card.
  clearTimeout(revealTimer);
  revealTimer = null;

  const w        = sess.words[sess.idx];
  const total    = sess.words.length;
  const isReview = sess.type === "review";

  // Shared header (same for both modes)
  sessTypeLabel.textContent = isReview
    ? "Review Session"
    : (selectedLevel !== "all"
        ? `New Word Session · ${selectedLevel}`
        : "New Word Session");
  sessCounter.textContent   = `Word ${sess.idx + 1} of ${total}`;
  sessCorrect.textContent   = sess.correct;
  sessForgot.textContent    = sess.forgot;
  sessBar.style.width       = Math.round(sess.idx / total * 100) + "%";

  // Helper: reset all inline overrides set by checkSpelling()
  function _resetRatingBtns(disabledState) {
    ratingWrap.querySelectorAll("button").forEach(b => {
      b.disabled             = disabledState;
      b.style.outline        = "";
      b.style.outlineOffset  = "";
      b.style.transform      = "";
    });
  }

  if (isReview) {
    // ══════════════════════════════════════════════════════════════════════════
    //  REVIEW MODE  — meaning shown immediately as cue; user spells the word
    // ══════════════════════════════════════════════════════════════════════════
    $("card-scene").classList.add("hidden");
    $("card-review").classList.remove("hidden");
    showMeanWrap.classList.add("hidden");

    // Populate cue-header badges
    const cefr = w.cefr_level;
    $("rev-cefr").textContent = cefr;
    $("rev-cefr").className =
      `text-xs font-bold px-3 py-1 rounded-full select-none ${CEFR_CLS[cefr] || "bg-gray-100 text-gray-600"}`;
    $("rev-pos").textContent = w.pos;

    // Reset spelling input (inline styles — immune to Tailwind ordering)
    const inp = $("spell-input");
    inp.value                 = "";
    inp.style.borderColor     = "#e5e7eb";   // gray-200 — neutral
    inp.style.backgroundColor = "";

    // Reset Check button
    const checkBtn = $("btn-check");
    checkBtn.disabled = false;
    checkBtn.classList.remove("opacity-40", "cursor-not-allowed");

    // Reset Hint button — re-enabled for each new card
    const hintBtn = $("btn-hint");
    if (hintBtn) {
      hintBtn.disabled      = false;
      hintBtn.style.opacity = "";
      hintBtn.style.cursor  = "";
    }

    // Hide & clear feedback bubble
    const res = $("spell-result");
    res.classList.add("hidden");
    res.innerHTML = "";

    // Rating wrap: visible immediately but ALL buttons locked until Check
    ratingWrap.classList.remove("hidden");
    _resetRatingBtns(true);   // true = disabled

    // Fetch and display the meaning as a cue (async; spinner shown if slow)
    loadReviewMeaning(w);

    // Speak the word promptly so the user hears it before they start typing
    setTimeout(speakWord, 200);

    // Auto-focus the input after the panel animates in
    setTimeout(() => $("spell-input")?.focus(), 380);

  } else {
    // ══════════════════════════════════════════════════════════════════════════
    //  NEW WORD MODE  — word shown on front; flip card to reveal meaning
    // ══════════════════════════════════════════════════════════════════════════
    $("card-review").classList.add("hidden");
    $("card-scene").classList.remove("hidden");

    // Reset flip state
    cardInner.classList.remove("flipped");

    // Front face
    cardWord.textContent  = w.word;
    frontCefr.textContent = w.cefr_level;
    frontCefr.className   =
      `mb-6 text-xs font-bold px-3 py-1 rounded-full select-none ${CEFR_CLS[w.cefr_level] || "bg-gray-100 text-gray-600"}`;
    badgeNew.classList.remove("hidden");   // always shown for new sessions

    // Back face (meaning populated on reveal)
    backWord.textContent    = w.word;
    backPos.textContent     = w.pos;
    backCefr.textContent    = w.cefr_level;
    backCefr.className      =
      `text-xs font-bold px-2 py-0.5 rounded-full ${CEFR_CLS[w.cefr_level] || "bg-gray-100 text-gray-600"}`;
    backMeaning.textContent = "";
    backExample.textContent = "";

    // Show "Show Meaning" button; hide ratings
    showMeanWrap.classList.remove("hidden");
    btnShowMean.classList.remove("hidden");
    meaningLoad.classList.add("hidden");
    meaningLoad.classList.remove("flex");
    ratingWrap.classList.add("hidden");

    // Re-enable all rating buttons (clears any state from a previous review card)
    _resetRatingBtns(false);  // false = enabled

    // Auto-pronounce after the flip animation begins
    setTimeout(speakWord, 380);
  }
}


// ── Show meaning (flip) ───────────────────────────────────────────────────────
async function showMeaning() {
  if (cardInner.classList.contains("flipped")) return;  // already revealed

  // Show spinner, hide button
  btnShowMean.classList.add("hidden");
  meaningLoad.classList.remove("hidden");
  meaningLoad.classList.add("flex");

  const w = sess.words[sess.idx];
  let meaning = w.meaning || "";
  let example = w.example_sentence || "";

  // Fetch if not already cached in the session word object
  if (!meaning) {
    try {
      const resp = await fetch(`/api/word-meaning/${w.id}`);
      const data = await resp.json();
      meaning = data.meaning          || "";
      example = data.example_sentence || "";
      // Cache on session object so re-reveals are instant
      sess.words[sess.idx].meaning          = meaning;
      sess.words[sess.idx].example_sentence = example;
    } catch (_) {
      meaning = `(${w.pos} · ${w.cefr_level}) Look up "${w.word}" in a dictionary.`;
      example = "";
    }
  }

  // Populate back face
  backMeaning.textContent = meaning;
  if (example) {
    backExample.textContent = `"${example}"`;
    exampleWrap.classList.remove("hidden");
  } else {
    exampleWrap.classList.add("hidden");
  }

  // Flip the card
  cardInner.classList.add("flipped");

  // After flip animation completes (~600 ms), reveal rating buttons.
  // Track the handle so renderCard() can cancel it if the user moves quickly.
  revealTimer = setTimeout(() => {
    revealTimer = null;
    showMeanWrap.classList.add("hidden");
    ratingWrap.classList.remove("hidden");
  }, 350);
}


// ── Submit rating ─────────────────────────────────────────────────────────────
async function submitRating(quality) {
  ratingWrap.querySelectorAll("button").forEach(b => (b.disabled = true));

  const w = sess.words[sess.idx];
  try {
    const resp = await fetch("/api/submit-review", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ word_id: w.id, quality }),
    });
    if (!resp.ok) {
      const errData = await resp.json().catch(() => ({}));
      throw new Error(errData.error || `Server error ${resp.status}`);
    }
  } catch (err) {
    showToast(`⚠️ Rating not saved: ${err.message}`, 4000);
    ratingWrap.querySelectorAll("button").forEach(b => (b.disabled = false));
    return;
  }

  if (quality >= 4)       sess.correct++;
  else if (quality === 3) sess.struggled++;
  else                    sess.forgot++;

  sess.idx++;
  if (sess.idx >= sess.words.length) {
    finishSession();
  } else {
    ratingWrap.querySelectorAll("button").forEach(b => (b.disabled = false));
    renderCard();
  }
}


// ── Session complete ──────────────────────────────────────────────────────────
async function finishSession() {
  window.speechSynthesis?.cancel();   // stop any in-progress audio
  sessBar.style.width = "100%";
  const total = sess.words.length;

  $("complete-summary").textContent =
    `You reviewed ${total} word${total !== 1 ? "s" : ""} in this session.`;
  $("res-correct").textContent   = sess.correct;
  $("res-struggled").textContent = sess.struggled;
  $("res-forgot").textContent    = sess.forgot;
  $("btn-another").textContent   =
    sess.type === "new" ? "Learn More New Words" : "Review More Words";

  // Hide both card panels, rating rows, and show the completion screen
  cardInner.closest(".card-scene").classList.add("hidden");
  $("card-review").classList.add("hidden");
  ratingWrap.classList.add("hidden");
  showMeanWrap.classList.add("hidden");
  sessionComp.classList.remove("hidden");

  // Fetch live stats to show in the completion footer
  try {
    const s = await fetch("/api/stats").then(r => r.json());
    $("post-introduced").textContent = s.introduced;
    $("post-due").textContent        = s.due_today;
    // Also prime dashboard counters so they're accurate when user goes back
    $("dash-introduced") && ($("dash-introduced").textContent = s.introduced);
    $("dash-due")        && ($("dash-due").textContent        = s.due_today);
    $("dash-streak")     && ($("dash-streak").textContent     = s.streak ?? INIT_STREAK);
    _applyMasteryStats(s);
  } catch (_) {}
}

function startAnotherSession() {
  sessionComp.classList.add("hidden");
  $("card-review").classList.add("hidden");
  cardInner.closest(".card-scene").classList.remove("hidden");
  startSession(sess.type);
}


// ── Dashboard navigation ──────────────────────────────────────────────────────
async function goToDashboard() {
  window.speechSynthesis?.cancel();
  stopPolling();
  $("card-review").classList.add("hidden");
  cardInner.closest(".card-scene").classList.remove("hidden");
  showPanel("dashboard");

  // Refresh live stats so the counters reflect completed sessions
  try {
    const s = await fetch("/api/stats").then(r => r.json());
    const intro    = $("dash-introduced");
    const due      = $("dash-due");
    const rem      = $("dash-remaining");
    const lbl      = $("dash-due-label");
    const streakEl = $("dash-streak");
    if (intro)    intro.textContent    = s.introduced;
    if (due)      due.textContent      = s.due_today;
    if (rem)      rem.textContent      = `${s.total - s.introduced} words remaining`;
    if (lbl)      lbl.textContent      =
      s.due_today > 0 ? `${s.due_today} words due today` : "Nothing due – great job! 🎉";
    if (streakEl) streakEl.textContent = s.streak ?? INIT_STREAK;
    _applyMasteryStats(s);
  } catch (_) {}
}


// ── Spelling: mask the target word inside an example sentence ─────────────────
// Handles plural/3rd-person -s/-es, past tense -ed/-d, progressive -ing,
// comparative/superlative -er/-est, adverb -ly, nominalisations -ment/-tion/-ness,
// and -ful/-less.  Word boundaries prevent "comfort" matching inside "comfortable".
function maskWord(sentence, word) {
  if (!sentence || !word) return sentence;
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re  = new RegExp(
    `\\b${esc}(?:s|es|e?d|e?r|e?st|ing|ings|ly|ment|tion|ness|ful|less)?\\b`,
    "gi"
  );
  return sentence.replace(re, "_______");
}


// ── Review: load meaning as cue ───────────────────────────────────────────────
async function loadReviewMeaning(w) {
  const loading = $("rev-loading");
  const wrap    = $("rev-meaning-wrap");

  let meaning = w.meaning          || "";
  let example = w.example_sentence || "";

  // Most review words already have a cached meaning (set during their first
  // new-word session).  Only hit the network when the cache is empty.
  if (!meaning) {
    loading.style.display = "flex";
    wrap.classList.add("hidden");
    try {
      const resp = await fetch(`/api/word-meaning/${w.id}`);
      const data = await resp.json();
      meaning = data.meaning          || "";
      example = data.example_sentence || "";
      sess.words[sess.idx].meaning          = meaning;
      sess.words[sess.idx].example_sentence = example;
    } catch (_) {
      meaning = `(${w.pos} · ${w.cefr_level}) Definition unavailable.`;
    }
    loading.style.display = "none";
    wrap.classList.remove("hidden");
  }

  $("rev-meaning").textContent = meaning || "—";
  if (example) {
    $("rev-example").textContent = `"${maskWord(example, w.word)}"`;
    $("rev-example-wrap").classList.remove("hidden");
  } else {
    $("rev-example-wrap").classList.add("hidden");
  }
}


// ── Spelling check ─────────────────────────────────────────────────────────────
function checkSpelling() {
  const inp      = $("spell-input");
  const result   = $("spell-result");
  const checkBtn = $("btn-check");
  const w        = sess.words[sess.idx];

  const answer  = inp.value.trim().toLowerCase();
  const correct = w.word.toLowerCase();

  if (!answer) { inp.focus(); return; }   // ignore empty submission

  // Lock the Check button so the user cannot re-submit
  checkBtn.disabled = true;
  checkBtn.classList.add("opacity-40", "cursor-not-allowed");

  // Lock the hint button — answer is now revealed, hint is moot
  const hintBtn = $("btn-hint");
  if (hintBtn) {
    hintBtn.disabled      = true;
    hintBtn.style.opacity = "0.4";
    hintBtn.style.cursor  = "not-allowed";
  }

  const isCorrect = answer === correct;

  // Style the input with inline styles (immune to Tailwind ordering)
  inp.style.borderColor     = isCorrect ? "#10b981" : "#ef4444";  // emerald / red
  inp.style.backgroundColor = isCorrect ? "#f0fdf4" : "#fef2f2";  // green-50 / red-50

  // Show feedback bubble
  result.classList.remove("hidden");
  result.style.background = isCorrect ? "#f0fdf4" : "#fef2f2";
  if (isCorrect) {
    result.innerHTML =
      `<span style="color:#059669">✓ Correct! Well done.</span>`;
  } else {
    result.innerHTML =
      `<span style="color:#dc2626">✗ The correct spelling is: </span>` +
      `<strong style="color:#111827;font-size:1.05em;letter-spacing:.02em">${w.word}</strong>`;
  }

  // Unlock only the contextually appropriate rating buttons
  //   Correct  → Got It (4) + Perfect (5)
  //   Incorrect → Forgot (0) + Struggled (3)
  const allowed = isCorrect ? [4, 5] : [0, 3];
  ratingWrap.querySelectorAll("button[onclick]").forEach(btn => {
    const m = btn.getAttribute("onclick").match(/\d+/);
    btn.disabled = !allowed.includes(+(m?.[0] ?? -1));
  });

  // When wrong, highlight the Forgot button as the recommended choice
  if (!isCorrect) {
    const forgot = $("btn-forgot");
    if (forgot) {
      forgot.style.outline       = "3px solid #ef4444";
      forgot.style.outlineOffset = "2px";
      forgot.style.transform     = "scale(1.05)";
    }
  }

  // Reveal the full, unmasked example sentence now the answer is known
  const revEx  = $("rev-example");
  const fullEx = sess.words[sess.idx]?.example_sentence || "";
  if (revEx && fullEx) {
    revEx.textContent = `"${fullEx}"`;
  }
}


// ── Hint button (spelling mode) ───────────────────────────────────────────────
function useHint() {
  const hintBtn = $("btn-hint");
  if (!hintBtn || hintBtn.disabled) return;

  const w   = sess.words[sess.idx];
  const inp = $("spell-input");
  if (!w || !inp) return;

  const first = w.word[0].toUpperCase();

  inp.value = first;
  inp.focus();
  inp.setSelectionRange(1, 1);

  // One use per word — lock the button
  hintBtn.disabled      = true;
  hintBtn.style.opacity = "0.4";
  hintBtn.style.cursor  = "not-allowed";

  showToast(`💡 Starts with: "${first}"`, 2000);
}


// ── Dashboard mastery stats updater ──────────────────────────────────────────
// Called after /api/stats fetches in finishSession() and goToDashboard().
function _applyMasteryStats(s) {
  const mastered   = $("stat-mastered");
  const learning   = $("stat-learning");
  const struggling = $("stat-struggling");
  const bar        = $("prog-bar");
  const fraction   = $("prog-fraction");
  const pctLabel   = $("prog-pct");

  if (mastered)   mastered.textContent   = s.mastered   ?? INIT_MASTERY.mastered;
  if (learning)   learning.textContent   = s.learning   ?? INIT_MASTERY.learning;
  if (struggling) struggling.textContent = s.struggling ?? INIT_MASTERY.struggling;

  const total      = s.total      ?? 0;
  const introduced = s.introduced ?? 0;
  if (total > 0) {
    const pct = (introduced / total * 100).toFixed(1);
    if (bar)      bar.style.width      = pct + "%";
    if (fraction) fraction.textContent = `${introduced} / ${total}`;
    if (pctLabel) pctLabel.textContent = `${pct}% of Oxford 3000 introduced`;
  }
}


// ── CEFR level filter ─────────────────────────────────────────────────────────
const _PILL_ACTIVE = {
  all: { background: "#1e40af", color: "#fff" },   // blue-800
  A1:  { background: "#059669", color: "#fff" },   // emerald-600
  A2:  { background: "#0d9488", color: "#fff" },   // teal-600
  B1:  { background: "#2563eb", color: "#fff" },   // blue-600
  B2:  { background: "#7c3aed", color: "#fff" },   // violet-600
};
const _PILL_INACTIVE = { background: "#f3f4f6", color: "#6b7280" };  // gray-100 / gray-500

function selectLevel(lvl) {
  selectedLevel = lvl;
  ["all", "A1", "A2", "B1", "B2"].forEach(l => {
    const pill = $("lvl-pill-" + l);
    if (!pill) return;
    const s = l === lvl ? (_PILL_ACTIVE[l] || _PILL_ACTIVE.all) : _PILL_INACTIVE;
    pill.style.background = s.background;
    pill.style.color      = s.color;
  });
}


// ── Text-to-Speech ────────────────────────────────────────────────────────────
// Voices load asynchronously.  Cache them so the first auto-play never runs
// with an empty list on browsers that delay voice loading.
let _ttsVoices = [];
function _syncVoices() { _ttsVoices = window.speechSynthesis?.getVoices() ?? []; }
if (window.speechSynthesis) {
  window.speechSynthesis.addEventListener("voiceschanged", _syncVoices);
  _syncVoices();   // populate immediately if voices already available
}

function speakWord() {
  if (!window.speechSynthesis) return;
  const word = sess.words[sess.idx]?.word;
  if (!word) return;

  window.speechSynthesis.cancel();               // stop any previous utterance

  const utter  = new SpeechSynthesisUtterance(word);
  utter.lang   = "en-US";
  utter.rate   = 0.85;    // slightly slow — better for learners
  utter.pitch  = 1.0;

  if (!_ttsVoices.length) _syncVoices();
  const voice =
    _ttsVoices.find(v => v.lang === "en-US") ||
    _ttsVoices.find(v => v.lang === "en-GB") ||
    _ttsVoices.find(v => v.lang.startsWith("en"));
  if (voice) utter.voice = voice;

  window.speechSynthesis.speak(utter);
}


// ── Toast ─────────────────────────────────────────────────────────────────────
// Inline styles (NOT Tailwind classes) so opacity:1 always beats opacity:0
// regardless of the order Tailwind CDN emits its utility rules.
let toastTimer = null;
function showToast(msg, ms = 3000) {
  const el = $("toast");
  el.textContent = msg;
  el.style.opacity       = "1";
  el.style.transform     = "translateX(-50%) translateY(0)";
  el.style.pointerEvents = "auto";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.style.opacity       = "0";
    el.style.transform     = "translateX(-50%) translateY(-10px)";
    setTimeout(() => { el.style.pointerEvents = "none"; }, 350);
  }, ms);
}


// ── Boot ──────────────────────────────────────────────────────────────────────
(function boot() {
  const st = INIT_STATE;
  if      (st.status === "running") {
    showPanel("import"); showImportSub("running"); applyImportSt(st); startPolling();
  } else if (st.status === "error") {
    showPanel("import"); showImportSub("error"); impErrorMsg.textContent = st.message;
  } else if (INIT_TOTAL === 0) {
    showPanel("import"); showImportSub("idle");
  } else {
    showPanel("dashboard");
  }
  // Initialise level-filter pills so "All" starts highlighted
  selectLevel("all");
})();
