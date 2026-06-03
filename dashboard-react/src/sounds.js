/**
 * sounds.js  –  Web Audio API chiptune sound effects for Boss Battle
 *
 * AudioContext is created lazily on first call (satisfies browser autoplay policy).
 * All functions are no-ops if the browser has no Web Audio support.
 */

let _ctx = null

function getCtx() {
  if (!_ctx) _ctx = new (window.AudioContext || window.webkitAudioContext)()
  return _ctx
}

// Base primitive: one oscillator with optional frequency sweep + volume envelope
function tone(freq, endFreq, duration, type = 'square', vol = 0.25) {
  try {
    const c   = getCtx()
    const osc = c.createOscillator()
    const g   = c.createGain()
    osc.connect(g)
    g.connect(c.destination)
    osc.type = type
    osc.frequency.setValueAtTime(freq, c.currentTime)
    if (endFreq !== freq)
      osc.frequency.linearRampToValueAtTime(endFreq, c.currentTime + duration)
    g.gain.setValueAtTime(vol, c.currentTime)
    g.gain.exponentialRampToValueAtTime(0.001, c.currentTime + duration)
    osc.start(c.currentTime)
    osc.stop(c.currentTime + duration + 0.02)
  } catch (_) {}
}

function later(fn, seconds) { setTimeout(fn, seconds * 1000) }

// ── Public sound effects ──────────────────────────────────────────────────────

/** Soft click when tapping a letter tile */
export function playTileTap() {
  tone(700, 700, 0.04, 'square', 0.12)
}

/** Player lands a correct hit on the boss */
export function playHit() {
  tone(520, 280, 0.10, 'square', 0.28)
  later(() => tone(380, 220, 0.08, 'square', 0.18), 0.06)
}

/** Player misses (wrong answer) */
export function playMiss() {
  tone(220, 130, 0.20, 'sawtooth', 0.22)
}

/** Boss attacks the player */
export function playBossAttack() {
  tone(160, 90,  0.15, 'sawtooth', 0.28)
  later(() => tone(190, 75, 0.10, 'square', 0.18), 0.05)
}

/** Boss defeated — ascending fanfare C-E-G-C */
export function playWaveClear() {
  ;[523, 659, 784, 1047].forEach((f, i) =>
    later(() => tone(f, f, 0.14, 'square', 0.22), i * 0.11)
  )
}

/** Player runs out of HP — descending sad phrase */
export function playGameOver() {
  ;[392, 330, 277, 220].forEach((f, i) =>
    later(() => tone(f, f * 0.88, 0.28, 'sawtooth', 0.18), i * 0.24)
  )
}
