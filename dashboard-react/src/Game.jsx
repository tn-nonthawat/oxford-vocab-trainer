/**
 * Game.jsx  –  Boss Battle: turn-based word-completion game
 *
 * Rules
 * ─────
 * • Pool  : all words the user has introduced (GET /api/word-list?category=introduced)
 * • Puzzle: word shown with N letters blanked → tap letter tiles to fill blanks
 * • Turn  : Player fills word → (correct) attack boss + small heal
 *                               (miss)    no damage
 *           → Boss always attacks player
 * • Endless: waves scale in difficulty (more blanks, higher boss HP & damage)
 *            until player HP reaches 0
 */

import React, { useState, useEffect, useRef } from 'react'
import { playTileTap, playHit, playMiss, playBossAttack, playWaveClear, playGameOver } from './sounds.js'

// ── Constants ─────────────────────────────────────────────────────────────────
const PLAYER_MAX_HP  = 100
const PLAYER_DAMAGE  = 20   // damage dealt to boss on correct answer
const PLAYER_HEAL    = 5    // HP healed on correct answer
const BOSS_BASE_HP   = 100  // boss HP = BOSS_BASE_HP × wave
const BOSS_BASE_DMG  = 5    // boss damage = BOSS_BASE_DMG × wave

const BOSSES = [
  { emoji: '🐭', name: 'Rat'    },
  { emoji: '🐱', name: 'Cat'    },
  { emoji: '🐶', name: 'Dog'    },
  { emoji: '🦊', name: 'Fox'    },
  { emoji: '🐺', name: 'Wolf'   },
  { emoji: '🐻', name: 'Bear'   },
  { emoji: '🦁', name: 'Lion'   },
  { emoji: '🐉', name: 'Dragon' },
  { emoji: '👹', name: 'Demon'  },
  { emoji: '💀', name: 'Lich'   },
]

// Misleading letter pairs for distractors
const SIMILAR = {
  a: ['e','o','u'], e: ['a','i','o'], i: ['e','y','a'], o: ['a','u','e'],
  u: ['o','a','i'], b: ['d','p','h'], d: ['b','p','t'], p: ['b','d','q'],
  m: ['n','w','r'], n: ['m','r','u'], c: ['k','s','g'], k: ['c','g','q'],
  f: ['v','t','p'], v: ['f','w','b'], g: ['j','q','c'], j: ['g','i','y'],
  l: ['i','r','t'], r: ['n','l','m'], s: ['c','z','x'], t: ['f','l','d'],
  w: ['v','m','u'], x: ['z','s','k'], y: ['i','j','e'], z: ['s','x','c'],
  h: ['n','b','k'],
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function shuffle(arr) {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

function getBlankedIndices(word, wave) {
  const numBlanks = Math.min(wave, Math.ceil(word.length / 2), word.length - 1)
  const indices = Array.from({ length: word.length }, (_, i) => i)
  // Prefer not blanking the first letter
  const pool = word.length > 1 ? indices.slice(1) : indices
  return shuffle(pool).slice(0, Math.max(1, numBlanks)).sort((a, b) => a - b)
}

function buildTiles(word, blankedIndices) {
  const missing = blankedIndices.map(i => word[i].toLowerCase())
  const usedSet  = new Set(missing)
  const extras   = []

  // One similar/misleading letter per missing letter
  for (const letter of missing) {
    for (const cand of (SIMILAR[letter] || [])) {
      if (!usedSet.has(cand) && extras.length < 8 - missing.length) {
        extras.push(cand); usedSet.add(cand); break
      }
    }
  }

  // Fill remaining slots with common letters
  const common = 'aeiounrstlcdmgph'
  let safety = 0
  while (extras.length < 8 - missing.length && safety++ < 60) {
    const c = common[Math.floor(Math.random() * common.length)]
    if (!usedSet.has(c)) { extras.push(c); usedSet.add(c) }
  }

  return shuffle([...missing, ...extras]).map((letter, id) => ({ id, letter, used: false }))
}

// ── Sub-components ────────────────────────────────────────────────────────────

function HPBar({ current, max, color, label }) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (current / max) * 100)) : 0
  return (
    <div>
      <div className="flex justify-between text-xs font-semibold mb-1" style={{ color }}>
        <span>{label}</span>
        <span className="tabular-nums">{Math.max(0, Math.round(current))} / {max}</span>
      </div>
      <div className="rounded-full h-3 overflow-hidden" style={{ background: 'rgba(255,255,255,0.1)' }}>
        <div className="h-full rounded-full transition-all duration-500"
             style={{ width: `${pct}%`, background: color }} />
      </div>
    </div>
  )
}

function WordDisplay({ word, blankedIndices, filledLetters }) {
  return (
    <div className="flex items-center justify-center gap-1 flex-wrap py-2">
      {word.split('').map((letter, i) => {
        const slot = blankedIndices.indexOf(i)
        const isBlanked = slot !== -1
        const filled = isBlanked ? filledLetters[slot] : null
        return (
          <div key={i} className={[
            'w-9 h-10 flex items-center justify-center rounded-lg font-bold text-xl select-none',
            isBlanked
              ? filled
                ? 'bg-blue-100 border-2 border-blue-400 text-blue-800'
                : 'bg-gray-100 border-2 border-dashed border-gray-300 text-gray-300'
              : 'text-gray-800',
          ].join(' ')}>
            {isBlanked ? (filled ?? '?') : letter}
          </div>
        )
      })}
    </div>
  )
}

function LetterTiles({ tiles, onTap, disabled }) {
  return (
    <div className="flex flex-wrap justify-center gap-2">
      {tiles.map(tile => (
        <button
          key={tile.id}
          onClick={() => onTap(tile.id)}
          disabled={tile.used || disabled}
          className={[
            'w-11 h-11 rounded-xl text-lg font-bold uppercase transition-all duration-150 select-none',
            tile.used || disabled
              ? 'bg-gray-700 text-gray-600 border-2 border-gray-600 cursor-not-allowed'
              : 'bg-white border-2 border-blue-300 text-blue-800 shadow-md hover:bg-blue-50 hover:border-blue-500 active:scale-90 cursor-pointer',
          ].join(' ')}
        >
          {tile.letter}
        </button>
      ))}
    </div>
  )
}

const CEFR_CLS = {
  A1: 'bg-emerald-100 text-emerald-700',
  A2: 'bg-teal-100 text-teal-700',
  B1: 'bg-blue-100 text-blue-700',
  B2: 'bg-violet-100 text-violet-700',
}

// ── Main component ────────────────────────────────────────────────────────────

export default function Game({ onBack }) {
  const [phase,      setPhase]      = useState('loading')
  const [words,      setWords]      = useState([])
  const [wordIdx,    setWordIdx]    = useState(0)
  const [wave,       setWave]       = useState(1)
  const [bossHP,     setBossHP]     = useState(BOSS_BASE_HP)
  const [playerHP,   setPlayerHP]   = useState(PLAYER_MAX_HP)

  // Puzzle
  const [blankedIndices, setBlankedIndices] = useState([])
  const [tiles,          setTiles]          = useState([])
  const [filledLetters,  setFilledLetters]  = useState([])
  const [answerLocked,   setAnswerLocked]   = useState(false)

  // Feedback
  const [bossFlash,   setBossFlash]   = useState(false)
  const [playerShake, setPlayerShake] = useState(false)
  const [lastResult,  setLastResult]  = useState(null) // null | 'correct' | 'miss'
  const [message,     setMessage]     = useState('')

  // Scores
  const [correct, setCorrect] = useState(0)
  const [wrong,   setWrong]   = useState(0)

  const mutedRef = useRef(false)
  const [muted, setMuted] = useState(false)
  function sound(fn) { if (!mutedRef.current) fn() }

  const boss = BOSSES[Math.min(wave - 1, BOSSES.length - 1)]

  // ── Load word pool on mount ──────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false
    fetch('/api/word-list?category=introduced', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (cancelled) return
        if (!data.words?.length) { setPhase('no-words'); return }
        setWords(shuffle(data.words))
        setPhase('player-turn')
      })
      .catch(() => { if (!cancelled) setPhase('no-words') })
    return () => { cancelled = true }
  }, [])

  // ── Setup puzzle on each new player-turn ─────────────────────────────────
  useEffect(() => {
    if (phase !== 'player-turn' || !words.length) return
    const w = words[wordIdx % words.length]
    const blanked = getBlankedIndices(w.word, wave)
    setBlankedIndices(blanked)
    setTiles(buildTiles(w.word, blanked))
    setFilledLetters(new Array(blanked.length).fill(null))
    setLastResult(null)
    setMessage('')
    setAnswerLocked(false)
  }, [phase, wordIdx, wave, words])

  // ── Tap a letter tile ─────────────────────────────────────────────────────
  function tapTile(tileId) {
    if (answerLocked) return
    const nextSlot = filledLetters.findIndex(l => l === null)
    if (nextSlot === -1) return
    const tile = tiles.find(t => t.id === tileId)
    if (!tile || tile.used) return

    sound(playTileTap)
    const newFilled = [...filledLetters]
    newFilled[nextSlot] = tile.letter
    setFilledLetters(newFilled)
    setTiles(prev => prev.map(t => t.id === tileId ? { ...t, used: true } : t))

    if (nextSlot === blankedIndices.length - 1) {
      setAnswerLocked(true)
      const currentWord = words[wordIdx % words.length].word
      const isCorrect = blankedIndices.every((ci, slot) =>
        currentWord[ci].toLowerCase() === newFilled[slot]
      )
      setTimeout(() => resolveAnswer(isCorrect, currentWord, playerHP, bossHP, wave), 300)
    }
  }

  function resolveAnswer(isCorrect, wordStr, curPlayerHP, curBossHP, curWave) {
    const curBoss = BOSSES[Math.min(curWave - 1, BOSSES.length - 1)]

    if (isCorrect) {
      const newBossHP   = Math.max(0, curBossHP - PLAYER_DAMAGE)
      const newPlayerHP = Math.min(PLAYER_MAX_HP, curPlayerHP + PLAYER_HEAL)
      setBossHP(newBossHP)
      setPlayerHP(newPlayerHP)
      sound(playHit)
      setBossFlash(true)
      setTimeout(() => setBossFlash(false), 500)
      setLastResult('correct')
      setCorrect(c => c + 1)
      setMessage(`✅ Hit! -${PLAYER_DAMAGE} to ${curBoss.name} · +${PLAYER_HEAL} HP`)

      if (newBossHP <= 0) {
        const nextWave    = curWave + 1
        const nextBoss    = BOSSES[Math.min(nextWave - 1, BOSSES.length - 1)]
        sound(playWaveClear)
        setMessage(`🎉 ${curBoss.name} defeated! Wave ${nextWave}: ${nextBoss.name} appears!`)
        setTimeout(() => {
          setWave(nextWave)
          setBossHP(BOSS_BASE_HP * nextWave)
          setWordIdx(i => i + 1)
          setPhase('player-turn')
        }, 1800)
        return
      }

      setTimeout(() => bossTurn(newPlayerHP, curWave, curBoss.name), 1400)
    } else {
      sound(playMiss)
      setLastResult('miss')
      setWrong(w => w + 1)
      setMessage(`❌ Miss! Correct: "${wordStr}"`)
      setTimeout(() => bossTurn(curPlayerHP, curWave, curBoss.name), 1400)
    }
  }

  function bossTurn(curPlayerHP, curWave, bossName) {
    const dmg   = BOSS_BASE_DMG * curWave
    const newHP = curPlayerHP - dmg
    setPlayerHP(Math.max(0, newHP))
    sound(playBossAttack)
    setPlayerShake(true)
    setTimeout(() => setPlayerShake(false), 500)
    setMessage(`💥 ${bossName} attacks! -${dmg} HP`)

    if (newHP <= 0) {
      sound(playGameOver)
      setTimeout(() => setPhase('game-over'), 1000)
    } else {
      setTimeout(() => {
        setWordIdx(i => i + 1)
        setPhase('player-turn')
      }, 1200)
    }
  }

  function restartGame() {
    setWords(prev => shuffle([...prev]))
    setWordIdx(0)
    setWave(1)
    setBossHP(BOSS_BASE_HP)
    setPlayerHP(PLAYER_MAX_HP)
    setCorrect(0)
    setWrong(0)
    setMessage('')
    setLastResult(null)
    setAnswerLocked(false)
    setBossFlash(false)
    setPlayerShake(false)
    setPhase('player-turn')
  }

  // ── Loading ───────────────────────────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="min-h-screen flex items-center justify-center"
           style={{ background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' }}>
        <div className="text-center">
          <div className="text-6xl mb-4 animate-bounce select-none">⚔️</div>
          <p className="text-purple-300 text-sm">Loading battle…</p>
        </div>
      </div>
    )
  }

  // ── No words ──────────────────────────────────────────────────────────────
  if (phase === 'no-words') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
           style={{ background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' }}>
        <div className="bg-white rounded-2xl shadow-xl p-10 text-center max-w-sm w-full">
          <div className="text-5xl mb-4 select-none">📚</div>
          <h2 className="text-xl font-bold text-gray-800 mb-2">No words to battle with!</h2>
          <p className="text-gray-500 text-sm mb-6">
            Study some vocabulary words first, then come back to fight.
          </p>
          <button onClick={onBack}
                  className="bg-blue-600 hover:bg-blue-700 active:scale-95 text-white
                             font-semibold px-8 py-3 rounded-xl transition-all cursor-pointer">
            ← Back to Dashboard
          </button>
        </div>
      </div>
    )
  }

  // ── Game Over ─────────────────────────────────────────────────────────────
  if (phase === 'game-over') {
    return (
      <div className="min-h-screen flex items-center justify-center p-6"
           style={{ background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' }}>
        <div className="rounded-2xl shadow-2xl p-10 text-center max-w-sm w-full animate-slideUp"
             style={{ background: 'rgba(17,17,34,0.95)', border: '1px solid rgba(255,255,255,0.1)' }}>
          <div className="text-6xl mb-3 select-none">💀</div>
          <h2 className="text-2xl font-bold text-white mb-1">Defeated!</h2>
          <p className="text-gray-400 text-sm mb-6">
            Reached Wave {wave} · {correct + wrong} words battled
          </p>
          <div className="flex justify-center gap-8 mb-8">
            <div>
              <p className="text-3xl font-extrabold text-emerald-400 tabular-nums">{correct}</p>
              <p className="text-xs text-gray-500 mt-1">Correct</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-red-400 tabular-nums">{wrong}</p>
              <p className="text-xs text-gray-500 mt-1">Missed</p>
            </div>
            <div>
              <p className="text-3xl font-extrabold text-purple-400 tabular-nums">{wave}</p>
              <p className="text-xs text-gray-500 mt-1">Wave</p>
            </div>
          </div>
          <div className="flex flex-col gap-3">
            <button onClick={restartGame}
                    className="bg-red-600 hover:bg-red-700 active:scale-95 text-white
                               font-semibold px-8 py-3 rounded-xl shadow transition-all cursor-pointer">
              ⚔️ Play Again
            </button>
            <button onClick={onBack}
                    className="hover:bg-white/10 active:scale-95 text-gray-400
                               font-semibold px-8 py-3 rounded-xl transition-all cursor-pointer">
              ← Dashboard
            </button>
          </div>
        </div>
      </div>
    )
  }

  // ── Battle screen ─────────────────────────────────────────────────────────
  const currentWord  = words.length ? words[wordIdx % words.length] : null
  const isPlayerTurn = phase === 'player-turn'
  const bossMaxHP    = BOSS_BASE_HP * wave

  return (
    <div className="min-h-screen p-4 sm:p-6"
         style={{ background: 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' }}>
      <div className="max-w-lg mx-auto">

        {/* Back + mute */}
        <div className="flex items-center justify-between mb-4">
          <button onClick={onBack}
                  className="flex items-center gap-1.5 text-gray-500 hover:text-gray-300
                             text-sm transition-colors cursor-pointer select-none">
            ← Dashboard
          </button>
          <button
            onClick={() => { mutedRef.current = !mutedRef.current; setMuted(m => !m) }}
            className="text-xl select-none cursor-pointer opacity-60 hover:opacity-100 transition-opacity"
            title={muted ? 'Unmute' : 'Mute'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        </div>

        {/* Wave badge */}
        <div className="text-center mb-3">
          <span className="text-xs font-bold uppercase tracking-widest text-purple-300
                           bg-purple-900/40 px-3 py-1 rounded-full select-none">
            ⚔️ Wave {wave} · {boss.name}
          </span>
        </div>

        {/* Boss card */}
        <div className={[
          'rounded-2xl p-5 mb-3 transition-all duration-200',
          bossFlash
            ? 'ring-2 ring-red-500'
            : '',
        ].join(' ')}
          style={{ background: bossFlash ? 'rgba(127,0,0,0.6)' : 'rgba(17,24,39,0.85)' }}>
          <div className={`text-center mb-3 transition-transform duration-200 select-none ${bossFlash ? 'scale-90' : ''}`}>
            <span className="text-6xl">{boss.emoji}</span>
          </div>
          <HPBar current={bossHP} max={bossMaxHP} color="#ef4444" label={boss.name} />
        </div>

        {/* Message banner */}
        {message && (
          <div className={[
            'text-center text-sm font-semibold py-2.5 px-4 rounded-xl mb-3',
            lastResult === 'correct'
              ? 'text-emerald-300 border border-emerald-800'
              : 'text-red-300 border border-red-900',
          ].join(' ')}
            style={{ background: lastResult === 'correct' ? 'rgba(6,78,59,0.5)' : 'rgba(127,29,29,0.5)' }}>
            {message}
          </div>
        )}

        {/* Player card */}
        <div className={[
          'rounded-2xl p-4 mb-3 transition-all duration-200',
          playerShake ? 'ring-2 ring-yellow-400' : '',
        ].join(' ')}
          style={{ background: playerShake ? 'rgba(120,80,0,0.5)' : 'rgba(31,41,55,0.85)' }}>
          <div className="flex items-center gap-3 mb-2">
            <span className={`text-3xl select-none transition-transform duration-200 ${playerShake ? 'scale-125' : ''}`}>
              🧙
            </span>
            <div className="flex-1">
              <HPBar current={playerHP} max={PLAYER_MAX_HP} color="#3b82f6" label="You" />
            </div>
          </div>
          <div className="flex gap-2 mt-1">
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold text-emerald-400"
                  style={{ background: 'rgba(6,78,59,0.4)' }}>
              ✓ {correct}
            </span>
            <span className="text-xs px-2 py-0.5 rounded-full font-semibold text-red-400"
                  style={{ background: 'rgba(127,29,29,0.4)' }}>
              ✗ {wrong}
            </span>
          </div>
        </div>

        {/* Word puzzle */}
        {currentWord && (
          <div className="bg-white rounded-2xl p-5 mb-3">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-400 text-center mb-2 select-none">
              {isPlayerTurn && !answerLocked ? '⚔️ Complete the word' : '⏳ …'}
            </p>
            <div className="flex justify-center mb-3">
              <span className={`text-xs font-bold px-2.5 py-0.5 rounded-full select-none
                               ${CEFR_CLS[currentWord.cefr_level] || 'bg-gray-100 text-gray-600'}`}>
                {currentWord.cefr_level}{currentWord.pos ? ` · ${currentWord.pos}` : ''}
              </span>
            </div>
            <WordDisplay
              word={currentWord.word}
              blankedIndices={blankedIndices}
              filledLetters={filledLetters}
            />
            {lastResult === 'miss' && (
              <p className="text-center text-sm text-red-500 font-medium mt-3 select-none">
                Correct: <strong>{currentWord.word}</strong>
              </p>
            )}
            {lastResult === 'correct' && (
              <p className="text-center text-sm text-emerald-600 font-medium mt-3 select-none">
                ✓ {currentWord.word}
              </p>
            )}
          </div>
        )}

        {/* Letter tiles */}
        <div className="rounded-2xl p-4" style={{ background: 'rgba(31,41,55,0.85)' }}>
          {isPlayerTurn && !answerLocked ? (
            <>
              <p className="text-xs text-gray-400 text-center mb-3 select-none">
                Tap letters to fill the blanks
              </p>
              <LetterTiles tiles={tiles} onTap={tapTile} disabled={false} />
            </>
          ) : (
            <p className="text-xs text-gray-600 text-center py-2 select-none">
              {answerLocked ? '…' : '⚔️ Boss turn'}
            </p>
          )}
        </div>

      </div>
    </div>
  )
}
