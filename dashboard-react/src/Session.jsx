/**
 * Session.jsx  –  Oxford 3000 Vocabulary Trainer
 *
 * A full React study-session component that supports:
 *   • New Word Mode   — 3-D flip flashcard; meaning fetched on demand
 *   • Review Mode     — listen & spell; meaning shown as cue
 *   • Rating buttons  — SM-2 quality scores (0 / 3 / 4 / 5)
 *   • Session Complete screen with live post-session stats
 *
 * Props
 * ─────
 *   type        'new' | 'review'
 *   level       'All' | 'A1' | 'A2' | 'B1' | 'B2'  (ignored for review)
 *   onBack      () => void  – returns to the dashboard
 */

import React, { useState, useEffect, useRef } from 'react'

// ── CEFR badge colour map ─────────────────────────────────────────────────────
const CEFR_CLS = {
  A1: 'bg-emerald-100 text-emerald-700',
  A2: 'bg-teal-100 text-teal-700',
  B1: 'bg-blue-100 text-blue-700',
  B2: 'bg-violet-100 text-violet-700',
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Replace the target word (and common inflections) with _______ */
function maskWord(sentence, word) {
  if (!sentence || !word) return sentence
  const esc = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const re = new RegExp(
    `\\b${esc}(?:s|es|e?d|e?r|e?st|ing|ings|ly|ment|tion|ness|ful|less)?\\b`,
    'gi',
  )
  return sentence.replace(re, '_______')
}

/** Fetch (and server-side cache) meaning + example for one word. */
async function fetchMeaning(wordId) {
  const resp = await fetch(`/api/word-meaning/${wordId}`)
  if (!resp.ok) throw new Error('API error')
  const data = await resp.json()
  return { meaning: data.meaning || '', example: data.example_sentence || '' }
}

/** Submit SM-2 rating to the server and persist progress. */
async function submitReview(wordId, quality) {
  const resp = await fetch('/api/submit-review', {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ word_id: wordId, quality }),
  })
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}))
    throw new Error(data.error || `Server error ${resp.status}`)
  }
  return resp.json()
}

// ── Text-to-Speech ─────────────────────────────────────────────────────────────
// Voices load asynchronously on mobile — we cache globally and retry if empty.
let _ttsVoices = []
if (typeof window !== 'undefined' && window.speechSynthesis) {
  window.speechSynthesis.addEventListener('voiceschanged', () => {
    _ttsVoices = window.speechSynthesis.getVoices()
  })
  _ttsVoices = window.speechSynthesis.getVoices()
}

function _pickEnglishVoice(voices) {
  // Prefer US > GB > any English, explicitly excluding non-English voices
  return (
    voices.find(v => v.lang === 'en-US') ||
    voices.find(v => v.lang === 'en-GB') ||
    voices.find(v => v.lang === 'en-AU') ||
    voices.find(v => v.lang.startsWith('en'))
  )
}

function _doSpeak(word) {
  const voices = window.speechSynthesis.getVoices()
  if (voices.length) _ttsVoices = voices        // refresh cache
  const utter   = new SpeechSynthesisUtterance(word)
  utter.lang    = 'en-US'
  utter.rate    = 0.85
  const voice   = _pickEnglishVoice(_ttsVoices)
  if (voice) utter.voice = voice
  window.speechSynthesis.speak(utter)
}

function _speakText(text) {
  if (!window.speechSynthesis || !text) return

  const voices = window.speechSynthesis.getVoices()
  if (voices.length) {
    _ttsVoices = voices
    _doSpeak(text)
    return
  }

  let fired = false
  const handler = () => {
    if (fired) return
    fired = true
    window.speechSynthesis.removeEventListener('voiceschanged', handler)
    _doSpeak(text)
  }
  window.speechSynthesis.addEventListener('voiceschanged', handler)
  setTimeout(() => {
    if (fired) return
    fired = true
    window.speechSynthesis.removeEventListener('voiceschanged', handler)
    _doSpeak(text)
  }, 600)
}

/** Speak only the word (front face / first encounter) */
function speakWord(word) {
  if (!window.speechSynthesis || !word) return
  window.speechSynthesis.cancel()
  _speakText(word)
}

/** Speak word + meaning + example as a single utterance.
 *  Single utterance is the most reliable approach across Chrome/Safari/Edge.
 *  Parts are joined with ". " so TTS pauses naturally between them. */
function speakFull(word, meaning, example) {
  if (!window.speechSynthesis) return
  window.speechSynthesis.cancel()

  const voices = window.speechSynthesis.getVoices()
  if (voices.length) _ttsVoices = voices
  const voice = _pickEnglishVoice(_ttsVoices)

  const text = [word, meaning, example].filter(Boolean).join('. ')

  // Small delay after cancel() so Chrome is ready
  setTimeout(() => {
    const u    = new SpeechSynthesisUtterance(text)
    u.lang     = 'en-US'
    u.rate     = 0.85
    if (voice) u.voice = voice
    window.speechSynthesis.speak(u)
  }, 80)
}

// ── Thai Note ─────────────────────────────────────────────────────────────────
function ThaiNote({ wordId }) {
  const key = `thai_note_${wordId}`
  const [note, setNote] = useState(() => localStorage.getItem(key) || '')

  const MAX = 120

  function handleChange(e) {
    const val = e.target.value.slice(0, MAX)
    setNote(val)
    localStorage.setItem(key, val)
  }

  return (
    <div className="mt-4 rounded-xl border-2 border-yellow-200 bg-yellow-50 px-4 py-3">
      <div className="flex items-center justify-between mb-1.5">
        <p className="text-xs font-semibold uppercase tracking-wider text-yellow-600">
          📝 โน็ตคำแปล
        </p>
        <span className={`text-xs font-mono ${note.length >= MAX ? 'text-red-400' : 'text-yellow-400'}`}>
          {note.length}/{MAX}
        </span>
      </div>
      <textarea
        value={note}
        onChange={handleChange}
        placeholder=""
        rows={2}
        maxLength={MAX}
        className="w-full bg-transparent text-sm text-gray-700 placeholder-yellow-300
                   focus:outline-none resize-none leading-relaxed"
      />
    </div>
  )
}

// ── Spinner ───────────────────────────────────────────────────────────────────
function Spinner({ text = 'Loading…' }) {
  return (
    <div className="flex items-center justify-center gap-2.5 text-gray-400 text-sm py-2">
      <svg className="animate-spin h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10"
                stroke="currentColor" strokeWidth="4" />
        <path  className="opacity-75" fill="currentColor"
               d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
      </svg>
      <span>{text}</span>
    </div>
  )
}

// ── Rating Buttons ────────────────────────────────────────────────────────────
const RATINGS = [
  { q: 0, label: 'Forgot',    sub: 'Wrong / blackout',  emoji: '🔴',
    cls: 'bg-red-50     border-red-200     hover:border-red-400',
    txt: 'text-red-700' },
  { q: 3, label: 'Struggled', sub: 'Hard to recall',    emoji: '🟡',
    cls: 'bg-yellow-50  border-yellow-200  hover:border-yellow-400',
    txt: 'text-yellow-700' },
  { q: 4, label: 'Got It',    sub: 'With some effort',  emoji: '🟢',
    cls: 'bg-emerald-50 border-emerald-200 hover:border-emerald-400',
    txt: 'text-emerald-700' },
  { q: 5, label: 'Perfect',   sub: 'Instant recall',    emoji: '⚡',
    cls: 'bg-blue-50    border-blue-200    hover:border-blue-400',
    txt: 'text-blue-700' },
]

function RatingButtons({ onRate, locked = false, allowedOnly = null, highlightForgot = false }) {
  return (
    <div>
      <p className="text-center text-sm font-medium text-gray-500 mb-4">
        How well did you recall this word?
      </p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {RATINGS.map(r => {
          const isAllowed   = allowedOnly === null || allowedOnly.includes(r.q)
          const isDisabled  = locked || !isAllowed
          const doHighlight = highlightForgot && r.q === 0 && !locked
          return (
            <button
              key={r.q}
              onClick={() => !isDisabled && onRate(r.q)}
              disabled={isDisabled}
              className={`rate-btn flex flex-col items-center gap-2 border-2 rounded-xl px-4 py-4 cursor-pointer ${r.cls}`}
              style={doHighlight ? { outline: '3px solid #ef4444', outlineOffset: '2px', transform: 'scale(1.05)' } : {}}
            >
              <span className="text-3xl select-none">{r.emoji}</span>
              <span className={`text-sm font-bold ${r.txt}`}>{r.label}</span>
              <span className="text-xs text-gray-400">{r.sub}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── New-Word Flashcard ────────────────────────────────────────────────────────
function NewWordCard({ word: w, onRate }) {
  const [flipped,       setFlipped]       = useState(false)
  const [showRatings,   setShowRatings]   = useState(false)
  const [meaning,       setMeaning]       = useState(w.meaning           || '')
  const [example,       setExample]       = useState(w.example_sentence  || '')
  const [loadingMeaning,setLoadingMeaning]= useState(false)
  const [ratingLocked,  setRatingLocked]  = useState(false)
  const [rateError,     setRateError]     = useState('')

  // Auto-pronounce on mount
  useEffect(() => {
    const t = setTimeout(() => speakWord(w.word), 380)
    return () => clearTimeout(t)
  }, [w.word])

  async function handleShowMeaning() {
    if (flipped) return
    let m = meaning, ex = example
    if (!m) {
      setLoadingMeaning(true)
      try {
        const res = await fetchMeaning(w.id)
        m  = res.meaning
        ex = res.example
        setMeaning(m)
        setExample(ex)
      } catch (_) {
        m = `(${w.pos} · ${w.cefr_level}) Look up "${w.word}" in a dictionary.`
        setMeaning(m)
      }
      setLoadingMeaning(false)
    }
    setFlipped(true)
    setTimeout(() => setShowRatings(true), 350)
  }

  async function handleRate(q) {
    if (ratingLocked) return
    setRateError('')
    setRatingLocked(true)
    try {
      await submitReview(w.id, q)
      onRate(q)                   // advance to next word only after save succeeds
    } catch (err) {
      setRateError(`⚠️ Rating not saved: ${err.message}. Try again.`)
      setRatingLocked(false)      // unlock so user can retry
    }
  }

  return (
    <div>
      {/* 3-D flip card */}
      <div className="card-scene mb-6">
        <div className={`card-inner${flipped ? ' flipped' : ''}`} style={{ minHeight: 260 }}>

          {/* Front face */}
          <div className="card-face bg-white rounded-2xl shadow-lg p-8
                          flex flex-col items-center justify-center text-center"
               style={{ minHeight: 260 }}>
            <span className="mb-4 text-xs font-bold uppercase tracking-wider
                             bg-blue-100 text-blue-700 px-3 py-1 rounded-full select-none">
              New Word
            </span>
            <span className={`mb-6 text-xs font-bold px-3 py-1 rounded-full select-none
                             ${CEFR_CLS[w.cefr_level] || 'bg-gray-100 text-gray-600'}`}>
              {w.cefr_level}
            </span>
            <div className="flex items-center justify-center gap-3 mb-5">
              <p className="text-5xl sm:text-6xl font-extrabold text-gray-900 tracking-tight leading-none">
                {w.word}
              </p>
              <button onClick={() => speakWord(w.word)}
                      className="shrink-0 flex items-center justify-center w-11 h-11
                                 rounded-full bg-blue-50 hover:bg-blue-100 active:scale-90
                                 text-xl shadow-sm border border-blue-100
                                 transition-all duration-150 cursor-pointer">
                🔊
              </button>
            </div>
            <p className="text-sm text-gray-400">
              Think of the meaning, then tap{' '}
              <strong className="text-gray-600">Show Meaning</strong>.
            </p>
          </div>

          {/* Back face */}
          <div className="card-face card-back bg-white rounded-2xl shadow-lg
                          absolute inset-0 p-6 flex flex-col overflow-y-auto"
               style={{ minHeight: 260 }}>
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <p className="text-2xl font-extrabold text-gray-900 tracking-tight">{w.word}</p>
              <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
                {w.pos}
              </span>
              <span className={`text-xs font-bold px-2 py-0.5 rounded-full
                               ${CEFR_CLS[w.cefr_level] || 'bg-gray-100 text-gray-600'}`}>
                {w.cefr_level}
              </span>
              <button onClick={() => speakFull(w.word, meaning, example)}
                      title="Read word + meaning + example"
                      className="ml-auto flex items-center justify-center w-8 h-8
                                 rounded-full bg-blue-50 hover:bg-blue-100 active:scale-90
                                 text-base shadow-sm border border-blue-100
                                 transition-all duration-150 cursor-pointer">
                🔊
              </button>
            </div>
            <hr className="border-gray-100 mb-4" />
            <div className="mb-4">
              <p className="text-gray-800 text-base leading-relaxed">{meaning}</p>
            </div>
            {example && (
              <p className="text-gray-500 text-sm italic leading-relaxed">"{example}"</p>
            )}
            <ThaiNote wordId={w.id} />
            <p className="text-center text-xs text-gray-300 mt-auto pt-4">
              — Rate your recall below —
            </p>
          </div>

        </div>
      </div>

      {/* Show Meaning / spinner */}
      {!showRatings && (
        <div className="text-center mb-6">
          {loadingMeaning
            ? <Spinner text="Looking up definition…" />
            : (
              <button onClick={handleShowMeaning}
                      className="bg-gray-800 hover:bg-gray-900 active:scale-95 text-white
                                 font-semibold px-12 py-3.5 rounded-xl shadow-md text-base
                                 transition-all duration-150 cursor-pointer">
                Show Meaning
              </button>
            )
          }
        </div>
      )}

      {/* Rating buttons (appear after flip) */}
      {showRatings && (
        <>
          <RatingButtons onRate={handleRate} locked={ratingLocked} />
          {rateError && (
            <p className="mt-3 text-center text-xs text-red-500">{rateError}</p>
          )}
        </>
      )}
    </div>
  )
}

// ── Review (Spelling) Card ────────────────────────────────────────────────────
function ReviewCard({ word: w, onRate }) {
  const [meaning,       setMeaning]       = useState(w.meaning          || '')
  const [example,       setExample]       = useState(w.example_sentence || '')
  const [loadingMeaning,setLoadingMeaning]= useState(!w.meaning)
  const [spelling,      setSpelling]      = useState('')
  const [checkResult,   setCheckResult]   = useState(null)  // null | 'correct' | 'incorrect'
  const [hintUsed,      setHintUsed]      = useState(false)
  const [ratingLocked,  setRatingLocked]  = useState(false)
  const [rateError,     setRateError]     = useState('')
  const inputRef = useRef(null)

  // Load meaning + speak word on mount
  useEffect(() => {
    async function load() {
      if (!meaning) {
        setLoadingMeaning(true)
        try {
          const res = await fetchMeaning(w.id)
          setMeaning(res.meaning)
          setExample(res.example)
        } catch (_) {
          setMeaning(`(${w.pos} · ${w.cefr_level}) Definition unavailable.`)
        }
        setLoadingMeaning(false)
      }
    }
    load()
    setTimeout(() => speakWord(w.word), 200)
    setTimeout(() => inputRef.current?.focus(), 380)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleHint() {
    if (hintUsed || checkResult !== null) return
    setSpelling(w.word[0].toUpperCase())
    setHintUsed(true)
    inputRef.current?.focus()
  }

  function handleCheck() {
    if (!spelling.trim() || checkResult !== null) return
    const isCorrect = spelling.trim().toLowerCase() === w.word.toLowerCase()
    setCheckResult(isCorrect ? 'correct' : 'incorrect')
  }

  async function handleRate(q) {
    if (ratingLocked) return
    setRateError('')
    setRatingLocked(true)
    try {
      await submitReview(w.id, q)
      onRate(q)                   // advance to next word only after save succeeds
    } catch (err) {
      setRateError(`⚠️ Rating not saved: ${err.message}. Try again.`)
      setRatingLocked(false)      // unlock so user can retry
    }
  }

  const allowedRatings    = checkResult === 'correct' ? [4, 5] : checkResult === 'incorrect' ? [0, 3] : null
  const maskedExample     = checkResult ? example : maskWord(example, w.word)

  return (
    <div className="bg-white rounded-2xl shadow-lg p-7">

      {/* Header */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        <p className="text-xs font-bold uppercase tracking-widest text-gray-400 w-full mb-0.5">
          Listen &amp; spell the word
        </p>
        <span className={`text-xs font-bold px-3 py-1 rounded-full select-none
                         ${CEFR_CLS[w.cefr_level] || 'bg-gray-100 text-gray-600'}`}>
          {w.cefr_level}
        </span>
        <span className="text-xs font-mono bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">
          {w.pos}
        </span>
        <button onClick={() => speakFull(w.word, meaning, example)}
                title="Read word + meaning + example"
                className="ml-auto flex items-center justify-center w-9 h-9
                           rounded-full bg-blue-50 hover:bg-blue-100 active:scale-90
                           border border-blue-100 text-lg shadow-sm
                           transition-all duration-150 cursor-pointer">
          🔊
        </button>
      </div>

      {/* Meaning cue */}
      {loadingMeaning ? (
        <Spinner text="Loading definition cue…" />
      ) : (
        <div className="mb-4">
          <p className="text-gray-800 text-base leading-relaxed mb-3">{meaning || '—'}</p>
          {example && (
            <p className="text-gray-500 text-sm italic leading-relaxed">
              "{maskedExample}"
            </p>
          )}
        </div>
      )}

      <hr className="border-gray-100 my-5" />

      {/* Spelling input */}
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-2">
          ✏️ Type the word you heard
        </p>
        <div className="flex gap-2 overflow-hidden">
          <input
            ref={inputRef}
            type="text"
            value={spelling}
            onChange={e => setSpelling(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleCheck()}
            placeholder="Type your answer…"
            autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck="false"
            disabled={checkResult !== null}
            className="flex-1 min-w-0 border-2 rounded-xl px-4 py-3
                       text-gray-800 text-base font-medium
                       focus:outline-none transition-all"
            style={{
              borderColor:     checkResult === 'correct'   ? '#10b981'
                             : checkResult === 'incorrect' ? '#ef4444' : '#e5e7eb',
              backgroundColor: checkResult === 'correct'   ? '#f0fdf4'
                             : checkResult === 'incorrect' ? '#fef2f2' : '',
            }}
          />
          {/* 💡 Hint */}
          <button
            onClick={handleHint}
            disabled={hintUsed || checkResult !== null}
            title="First-letter hint (one use per word)"
            className="flex items-center justify-center w-12 shrink-0
                       rounded-xl border-2 border-amber-200
                       bg-amber-50 hover:bg-amber-100 active:scale-95
                       text-xl transition-all duration-150
                       cursor-pointer select-none
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            💡
          </button>
          {/* Check */}
          <button
            onClick={handleCheck}
            disabled={checkResult !== null}
            className="bg-gray-800 hover:bg-gray-900 active:scale-95
                       text-white font-semibold px-6 py-3 rounded-xl
                       shadow-md transition-all duration-150 cursor-pointer
                       disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Check
          </button>
        </div>

        {/* Feedback bubble */}
        {checkResult && (
          <div className="mt-3 px-4 py-2.5 rounded-xl text-sm font-medium"
               style={{ background: checkResult === 'correct' ? '#f0fdf4' : '#fef2f2' }}>
            {checkResult === 'correct' ? (
              <span style={{ color: '#059669' }}>✓ Correct! Well done.</span>
            ) : (
              <>
                <span style={{ color: '#dc2626' }}>✗ The correct spelling is: </span>
                <strong style={{ color: '#111827', fontSize: '1.05em', letterSpacing: '.02em' }}>
                  {w.word}
                </strong>
              </>
            )}
          </div>
        )}

        {/* Thai note — shown after answer is checked */}
        {checkResult && <ThaiNote wordId={w.id} />}
      </div>

      {/* Rating buttons — appear after Check */}
      {checkResult && (
        <div className="mt-6">
          <RatingButtons
            onRate={handleRate}
            locked={ratingLocked}
            allowedOnly={allowedRatings}
            highlightForgot={checkResult === 'incorrect'}
          />
          {rateError && (
            <p className="mt-3 text-center text-xs text-red-500">{rateError}</p>
          )}
        </div>
      )}
    </div>
  )
}

// ── Batch Done Screen (between batches — more words still due) ───────────────
function BatchDone({ batchScores, batchWords, totalScores, totalWords, dueRemaining, onContinue, onBack }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
      <div className="bg-white rounded-2xl shadow-lg p-8 text-center max-w-md w-full animate-slideUp">
        <div className="text-5xl mb-3 select-none">✅</div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">Batch Complete!</h2>
        <p className="text-gray-500 text-sm mb-6">
          {batchWords} words done · {dueRemaining} more still due today
        </p>

        {/* Batch score badges */}
        <div className="flex justify-center gap-6 mb-6">
          <div>
            <p className="text-3xl font-extrabold text-emerald-600">{batchScores.correct}</p>
            <p className="text-xs text-gray-400 mt-0.5">Correct</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold text-yellow-500">{batchScores.struggled}</p>
            <p className="text-xs text-gray-400 mt-0.5">Struggled</p>
          </div>
          <div>
            <p className="text-3xl font-extrabold text-red-500">{batchScores.forgot}</p>
            <p className="text-xs text-gray-400 mt-0.5">Forgot</p>
          </div>
        </div>

        {/* Overall progress so far */}
        <div className="bg-blue-50 border border-blue-100 rounded-xl px-4 py-3 mb-6 text-sm text-blue-700">
          Total this session: <strong>{totalWords}</strong> words reviewed
          &nbsp;·&nbsp;
          <strong>{totalScores.correct}</strong> correct
        </div>

        {/* Due remaining pill */}
        <div className="flex items-center justify-center gap-2 mb-7">
          <span className="text-2xl select-none">⏰</span>
          <span className="text-base font-bold text-orange-500">{dueRemaining} words still due</span>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={onContinue}
                  className="bg-emerald-600 hover:bg-emerald-700 active:scale-95
                             text-white font-semibold px-8 py-3 rounded-xl
                             shadow-md transition-all duration-150 cursor-pointer">
            Continue Reviewing →
          </button>
          <button onClick={onBack}
                  className="bg-gray-100 hover:bg-gray-200 active:scale-95
                             text-gray-600 font-semibold px-8 py-3 rounded-xl
                             transition-all duration-150 cursor-pointer">
            ← Dashboard
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Session Complete Screen ───────────────────────────────────────────────────
function SessionComplete({ scores, totalWords, sessionType, postStats, onBack, onAnother }) {
  return (
    <div className="min-h-screen flex items-center justify-center p-6"
         style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
      <div className="bg-white rounded-2xl shadow-lg p-10 text-center max-w-md w-full animate-slideUp">
        <div className="text-6xl mb-4 select-none">🎉</div>
        <h2 className="text-2xl font-bold text-gray-800 mb-2">All Done!</h2>
        <p className="text-gray-500 text-sm mb-8">
          You reviewed {totalWords} word{totalWords !== 1 ? 's' : ''} — nothing left due today! 🌟
        </p>

        {/* Score badges */}
        <div className="flex justify-center gap-8 mb-8">
          <div>
            <p className="text-4xl font-extrabold text-emerald-600">{scores.correct}</p>
            <p className="text-xs text-gray-400 mt-1">Correct<br />(Got It + Perfect)</p>
          </div>
          <div>
            <p className="text-4xl font-extrabold text-yellow-500">{scores.struggled}</p>
            <p className="text-xs text-gray-400 mt-1">Struggled</p>
          </div>
          <div>
            <p className="text-4xl font-extrabold text-red-500">{scores.forgot}</p>
            <p className="text-xs text-gray-400 mt-1">Forgot</p>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center">
          <button onClick={onBack}
                  className="bg-blue-600 hover:bg-blue-700 active:scale-95
                             text-white font-semibold px-8 py-3 rounded-xl
                             transition-all duration-150 cursor-pointer">
            ← Back to Dashboard
          </button>
          {sessionType === 'new' && (
            <button onClick={onAnother}
                    className="bg-gray-100 hover:bg-gray-200 active:scale-95
                               text-gray-700 font-semibold px-8 py-3 rounded-xl
                               transition-all duration-150 cursor-pointer">
              Learn More New Words
            </button>
          )}
        </div>

        {/* Live stats footer */}
        {postStats && (
          <div className="mt-8 pt-6 border-t border-gray-100 text-xs text-gray-400">
            <p className="mb-2 font-medium text-gray-500">Your progress after this session:</p>
            <div className="flex justify-center gap-8">
              <span>🎓 <strong className="text-gray-700">{postStats.introduced}</strong> introduced</span>
              <span>⏰ <strong className="text-gray-700">{postStats.due_today}</strong> due today</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Main Session Component ────────────────────────────────────────────────────
export default function Session({ type, level, onBack }) {
  // 'loading' | 'card' | 'empty' | 'batch-done' | 'complete'
  const [phase,        setPhase]        = useState('loading')
  const [words,        setWords]        = useState([])
  const [idx,          setIdx]          = useState(0)
  // Per-batch scores (reset each batch)
  const [scores,       setScores]       = useState({ correct: 0, struggled: 0, forgot: 0 })
  // Accumulated totals across all batches this session
  const [totalScores,  setTotalScores]  = useState({ correct: 0, struggled: 0, forgot: 0 })
  const [totalWords,   setTotalWords]   = useState(0)
  const [postStats,    setPostStats]    = useState(null)
  const [cardKey,      setCardKey]      = useState(0)

  function buildUrl(t, l) {
    if (t === 'review') return '/api/review-session'
    return l && l !== 'All'
      ? `/api/new-session?level=${encodeURIComponent(l)}`
      : '/api/new-session'
  }

  async function loadWords(t, l, keepTotals = false) {
    setPhase('loading')
    try {
      const data = await fetch(buildUrl(t, l)).then(r => r.json())
      if (!data.words || data.words.length === 0) {
        setPhase('empty')
      } else {
        setWords(data.words)
        setIdx(0)
        setScores({ correct: 0, struggled: 0, forgot: 0 })
        if (!keepTotals) {
          setTotalScores({ correct: 0, struggled: 0, forgot: 0 })
          setTotalWords(0)
        }
        setCardKey(k => k + 1)
        setPhase('card')
      }
    } catch (_) {
      setPhase('empty')
    }
  }

  // Fetch word list on mount
  useEffect(() => { loadWords(type, level) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  function handleRate(quality) {
    const s = { ...scores }
    if      (quality >= 4)  s.correct++
    else if (quality === 3) s.struggled++
    else                    s.forgot++
    setScores(s)

    const newTotal = {
      correct:   totalScores.correct   + (quality >= 4  ? 1 : 0),
      struggled: totalScores.struggled + (quality === 3 ? 1 : 0),
      forgot:    totalScores.forgot    + (quality <  3  ? 1 : 0),
    }
    const newTotalWords = totalWords + 1
    setTotalScores(newTotal)
    setTotalWords(newTotalWords)

    if (idx + 1 >= words.length) {
      // Batch done — check how many words are still due
      window.speechSynthesis?.cancel()
      fetch('/api/stats')
        .then(r => r.json())
        .then(stats => {
          setPostStats(stats)
          if (type === 'review' && (stats.due_today ?? 0) > 0) {
            // More words still due — show batch-done interstitial
            setPhase('batch-done')
          } else {
            setPhase('complete')
          }
        })
        .catch(() => setPhase('complete'))
    } else {
      setIdx(i => i + 1)
      setCardKey(k => k + 1)
    }
  }

  function handleContinueBatch() {
    setPostStats(null)
    loadWords(type, level, true)   // keepTotals = true
  }

  function handleAnother() {
    setPostStats(null)
    loadWords(type, level)
  }

  // ── Progress header values ─────────────────────────────────────────────────
  const barPct       = phase === 'complete' ? 100
                     : words.length > 0 ? Math.round(idx / words.length * 100) : 0
  const sessionLabel = type === 'review'
    ? 'Review Session'
    : (level && level !== 'All' ? `New Word Session · ${level}` : 'New Word Session')

  // ── Loading screen ─────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center"
           style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
        <div className="text-center">
          <svg className="animate-spin h-10 w-10 text-blue-500 mx-auto mb-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path   className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <p className="text-gray-500 text-sm">Loading words…</p>
        </div>
      </div>
    )
  }

  // ── Empty / all-done screen ────────────────────────────────────────────────
  if (phase === 'empty') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
           style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
        <div className="bg-white rounded-2xl shadow-lg p-10 text-center max-w-sm w-full">
          <div className="text-5xl mb-4">🎉</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">
            {type === 'new' ? 'All words introduced!' : 'Nothing due today!'}
          </h2>
          <p className="text-gray-500 text-sm mb-6">
            {type === 'new'
              ? (level && level !== 'All'
                  ? `All ${level} words have been introduced. Try another level!`
                  : 'All Oxford 3000 words have been introduced!')
              : "You're all caught up. Come back tomorrow! 🌟"}
          </p>
          <button onClick={onBack}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-semibold
                             px-8 py-3 rounded-xl transition-all duration-150 cursor-pointer">
            ← Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Batch done (more words still due) ─────────────────────────────────────
  if (phase === 'batch-done') {
    return (
      <BatchDone
        batchScores={scores}
        batchWords={words.length}
        totalScores={totalScores}
        totalWords={totalWords}
        dueRemaining={postStats?.due_today ?? 0}
        onContinue={handleContinueBatch}
        onBack={onBack}
      />
    )
  }

  // ── Session complete (due_today = 0) ──────────────────────────────────────
  if (phase === 'complete') {
    return (
      <SessionComplete
        scores={totalScores}
        totalWords={totalWords}
        sessionType={type}
        postStats={postStats}
        onBack={onBack}
        onAnother={handleAnother}
      />
    )
  }

  // ── Active card ────────────────────────────────────────────────────────────
  const w = words[idx]
  return (
    <div className="min-h-screen p-4 sm:p-6"
         style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
      <div className="max-w-lg mx-auto">

        {/* Back link */}
        <button
          onClick={() => { window.speechSynthesis?.cancel(); onBack() }}
          className="flex items-center gap-1.5 text-gray-400 hover:text-gray-700
                     text-sm font-medium mb-6 transition-colors cursor-pointer"
        >
          ← Back to Dashboard
        </button>

        {/* Session header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-widest text-gray-400">
              {sessionLabel}
            </p>
            <p className="text-sm font-semibold text-gray-600 mt-0.5">
              Word {idx + 1} of {words.length}
            </p>
          </div>
          <div className="text-right text-xs text-gray-400 space-y-0.5">
            <p><span className="text-emerald-600 font-bold">{scores.correct}</span> correct</p>
            <p><span className="text-red-500    font-bold">{scores.forgot}</span> forgot</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="bg-gray-200 rounded-full h-1.5 mb-8 overflow-hidden">
          <div className="bg-blue-500 h-full rounded-full transition-all duration-500"
               style={{ width: barPct + '%' }} />
        </div>

        {/* Card — keyed so it fully re-mounts (resets all state) for each word */}
        {type === 'new'
          ? <NewWordCard key={cardKey} word={w} onRate={handleRate} />
          : <ReviewCard  key={cardKey} word={w} onRate={handleRate} />
        }

      </div>
    </div>
  )
}
