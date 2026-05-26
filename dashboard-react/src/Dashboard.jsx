/**
 * Dashboard.jsx  –  Oxford 3000 Vocabulary Trainer
 *
 * All data is fetched live from GET /api/stats on the Flask backend.
 * The Vite dev-server proxy (vite.config.js) forwards /api/* to port 5000,
 * so session cookies work transparently.
 *
 * Features
 * --------
 *  • useDashboardStats()  — fetches /api/stats, handles loading / error / 401
 *  • Loading screen       — spinner while the first fetch is in-flight
 *  • Error screen         — friendly message + retry button on network failure
 *  • CEFR filter          — pill buttons in "Start Studying" card; selection
 *                           is persisted to localStorage and affects the
 *                           "words remaining" label on the Learn New Words btn
 *  • Draggable layout     — react-grid-layout; positions saved to localStorage
 */

import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react'
import GridLayout from 'react-grid-layout'
import { useWindowSize } from './hooks/useWindowSize'
import 'react-grid-layout/css/styles.css'
import 'react-resizable/css/styles.css'

// ─────────────────────────────────────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────
const LS_LAYOUT_KEY  = 'oxfordDashboardLayout'
const LS_CEFR_KEY    = 'oxfordCefrFilter'
const LS_HIDDEN_KEY  = 'oxfordHiddenCards'

// ── Card display metadata (used in Add/Remove UI) ─────────────────────────────
const CARD_META = {
  'hero':        { label: 'Total Words',        icon: '📊' },
  'cefr-A1':     { label: 'A1 · Beginner',      icon: '🌱' },
  'cefr-A2':     { label: 'A2 · Elementary',    icon: '🍀' },
  'cefr-B1':     { label: 'B1 · Intermediate',  icon: '🔵' },
  'cefr-B2':     { label: 'B2 · Upper-Int.',    icon: '🟣' },
  'stat-intro':  { label: 'Words Introduced',   icon: '🎓' },
  'stat-due':    { label: 'Due for Review',     icon: '⏰' },
  'stat-streak': { label: 'Study Streak',       icon: '🔥' },
  'dist-bar':    { label: 'Level Distribution', icon: '📈' },
  'progress':    { label: 'Progress Detail',    icon: '📋' },
  'study':       { label: 'Start Studying',     icon: '🚀' },
}

const CEFR_FILTERS = ['All', 'A1', 'A2', 'B1', 'B2']

// ─────────────────────────────────────────────────────────────────────────────
//  CEFR LEVEL METADATA
// ─────────────────────────────────────────────────────────────────────────────
const CEFR_META = [
  {
    level: 'A1', label: 'Beginner', icon: '🌱',
    bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200',
    accent: '#059669', accentLight: '#d1fae5',
  },
  {
    level: 'A2', label: 'Elementary', icon: '🌿',
    bg: 'bg-teal-50', text: 'text-teal-700', border: 'border-teal-200',
    accent: '#0d9488', accentLight: '#ccfbf1',
  },
  {
    level: 'B1', label: 'Intermediate', icon: '🔵',
    bg: 'bg-blue-50', text: 'text-blue-700', border: 'border-blue-200',
    accent: '#2563eb', accentLight: '#dbeafe',
  },
  {
    level: 'B2', label: 'Upper-Interm.', icon: '🟣',
    bg: 'bg-violet-50', text: 'text-violet-700', border: 'border-violet-200',
    accent: '#7c3aed', accentLight: '#ede9fe',
  },
]

// ─────────────────────────────────────────────────────────────────────────────
//  DEFAULT GRID LAYOUTS  (lg / md / sm breakpoints)
//  Columns: 12 (lg/md), 4 (sm/mobile)
//  Each item: { i, x, y, w, h }
// ─────────────────────────────────────────────────────────────────────────────
const DEFAULT_LAYOUTS = {
  lg: [
    { i: 'hero',        x: 0,  y: 0,  w: 12, h: 3 },
    { i: 'cefr-A1',     x: 0,  y: 3,  w: 3,  h: 4 },
    { i: 'cefr-A2',     x: 3,  y: 3,  w: 3,  h: 4 },
    { i: 'cefr-B1',     x: 6,  y: 3,  w: 3,  h: 4 },
    { i: 'cefr-B2',     x: 9,  y: 3,  w: 3,  h: 4 },
    { i: 'stat-intro',  x: 0,  y: 7,  w: 4,  h: 3 },
    { i: 'stat-due',    x: 4,  y: 7,  w: 4,  h: 3 },
    { i: 'stat-streak', x: 8,  y: 7,  w: 4,  h: 3 },
    { i: 'dist-bar',    x: 0,  y: 10, w: 12, h: 3 },
    { i: 'progress',    x: 0,  y: 13, w: 7,  h: 8 },
    { i: 'study',       x: 7,  y: 13, w: 5,  h: 8 },
  ],
  md: [
    { i: 'hero',        x: 0, y: 0,  w: 12, h: 3 },
    { i: 'cefr-A1',     x: 0, y: 3,  w: 3,  h: 4 },
    { i: 'cefr-A2',     x: 3, y: 3,  w: 3,  h: 4 },
    { i: 'cefr-B1',     x: 6, y: 3,  w: 3,  h: 4 },
    { i: 'cefr-B2',     x: 9, y: 3,  w: 3,  h: 4 },
    { i: 'stat-intro',  x: 0, y: 7,  w: 4,  h: 3 },
    { i: 'stat-due',    x: 4, y: 7,  w: 4,  h: 3 },
    { i: 'stat-streak', x: 8, y: 7,  w: 4,  h: 3 },
    { i: 'dist-bar',    x: 0, y: 10, w: 12, h: 3 },
    { i: 'progress',    x: 0, y: 13, w: 12, h: 8 },
    { i: 'study',       x: 0, y: 21, w: 12, h: 8 },
  ],
  sm: [
    { i: 'hero',        x: 0, y: 0,  w: 4, h: 3 },
    { i: 'cefr-A1',     x: 0, y: 3,  w: 2, h: 4 },
    { i: 'cefr-A2',     x: 2, y: 3,  w: 2, h: 4 },
    { i: 'cefr-B1',     x: 0, y: 7,  w: 2, h: 4 },
    { i: 'cefr-B2',     x: 2, y: 7,  w: 2, h: 4 },
    { i: 'stat-intro',  x: 0, y: 11, w: 4, h: 3 },
    { i: 'stat-due',    x: 0, y: 14, w: 4, h: 3 },
    { i: 'stat-streak', x: 0, y: 17, w: 4, h: 3 },
    { i: 'dist-bar',    x: 0, y: 20, w: 4, h: 4 },
    { i: 'progress',    x: 0, y: 24, w: 4, h: 8 },
    { i: 'study',       x: 0, y: 32, w: 4, h: 9 },
  ],
}

// ─────────────────────────────────────────────────────────────────────────────
//  LAYOUT PERSISTENCE HELPERS
// ─────────────────────────────────────────────────────────────────────────────
function loadLayouts() {
  try {
    const raw = localStorage.getItem(LS_LAYOUT_KEY)
    if (raw) return JSON.parse(raw)
  } catch (_) {}
  return DEFAULT_LAYOUTS
}

function saveLayouts(layouts) {
  try {
    localStorage.setItem(LS_LAYOUT_KEY, JSON.stringify(layouts))
  } catch (_) {}
}

function loadHidden() {
  try {
    const raw = localStorage.getItem(LS_HIDDEN_KEY)
    if (raw) return new Set(JSON.parse(raw))
  } catch (_) {}
  return new Set()
}

function saveHidden(set) {
  try {
    localStorage.setItem(LS_HIDDEN_KEY, JSON.stringify([...set]))
  } catch (_) {}
}

// ─────────────────────────────────────────────────────────────────────────────
//  useDashboardStats  — fetch live data from GET /api/stats
//
//  Returns { data, loading, error, refetch }
//  data shape: { username, total, levelCounts, progress, streak, mastery }
// ─────────────────────────────────────────────────────────────────────────────
function useDashboardStats() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)
  const [tick,    setTick]    = useState(0)   // bump to re-run the effect

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    fetch('/api/stats', { credentials: 'include' })
      .then(res => {
        if (res.status === 401) {
          window.location.href = '/login'
          return null
        }
        if (!res.ok) throw new Error(`Server responded with HTTP ${res.status}`)
        return res.json()
      })
      .then(json => {
        if (!cancelled && json) {
          setData({
            username   : json.username    ?? 'User',
            total      : json.total       ?? 0,
            levelCounts: json.level_counts ?? {},
            progress: {
              introduced: json.introduced ?? 0,
              due_today : json.due_today  ?? 0,
            },
            streak : json.streak     ?? 0,
            mastery: {
              mastered  : json.mastered   ?? 0,
              learning  : json.learning   ?? 0,
              struggling: json.struggling ?? 0,
            },
          })
        }
      })
      .catch(err => { if (!cancelled) setError(err.message) })
      .finally(()  => { if (!cancelled) setLoading(false)   })

    return () => { cancelled = true }
  }, [tick])

  return { data, loading, error, refetch: () => setTick(t => t + 1) }
}

// ─────────────────────────────────────────────────────────────────────────────
//  useImportState  — polls /import-status while an import is in progress
//
//  Returns { importState, triggerImport }
// ─────────────────────────────────────────────────────────────────────────────
function useImportState({ enabled, onDone }) {
  const [importState, setImportState] = useState(null)
  const pollRef = useRef(null)

  const poll = useCallback(() => {
    fetch('/import-status', { credentials: 'include' })
      .then(r => r.json())
      .then(st => {
        setImportState(st)
        if (st.status === 'running') {
          pollRef.current = setTimeout(poll, 1200)
        } else if (st.status === 'done') {
          onDone()   // tell Dashboard to refetch /api/stats
        }
      })
      .catch(() => {})
  }, [onDone])

  useEffect(() => {
    if (!enabled) return
    poll()
    return () => clearTimeout(pollRef.current)
  }, [enabled, poll])

  const triggerImport = useCallback(async () => {
    setImportState({ status: 'running', pages_done: 0, total_pages: 0,
                     words_found: 0, message: 'Starting…' })
    try { await fetch('/import-data', { method: 'POST', credentials: 'include' }) }
    catch (_) {}
    clearTimeout(pollRef.current)
    pollRef.current = setTimeout(poll, 600)
  }, [poll])

  return { importState, triggerImport }
}

// ─────────────────────────────────────────────────────────────────────────────
//  ImportPanel  — shown when total === 0 (DB empty) or import is running
// ─────────────────────────────────────────────────────────────────────────────
function ImportPanel({ importState, onTrigger }) {
  if (!importState) {
    // Still fetching initial import status
    return (
      <div className="min-h-screen flex items-center justify-center"
           style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Checking status…</p>
        </div>
      </div>
    )
  }

  const st = importState

  return (
    <div className="max-w-lg mx-auto p-6 animate-fadeIn">

      {/* ── Idle / empty ──────────────────────────────────────────────────── */}
      {(st.status === 'idle' || st.status === 'done') && (
        <div className="bg-white rounded-2xl shadow-lg p-10 text-center">
          <div className="text-6xl mb-4 select-none">📄</div>
          <h2 className="text-2xl font-bold mb-2">No vocabulary data yet</h2>
          <p className="text-gray-500 text-sm mb-1 max-w-md mx-auto">
            Click below and the app will parse{' '}
            <code className="bg-gray-100 px-1.5 py-0.5 rounded text-xs font-mono">
              American_Oxford_3000.pdf
            </code>{' '}
            directly — no terminal needed.
          </p>
          <p className="text-gray-400 text-xs mb-8">Typical time: 10–30 s.</p>
          <button
            onClick={onTrigger}
            className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700
                       active:scale-95 text-white font-semibold px-8 py-3
                       rounded-xl shadow-md transition-all duration-150 cursor-pointer"
          >
            <span className="text-xl">📥</span> Import PDF Word List
          </button>
        </div>
      )}

      {/* ── Running ───────────────────────────────────────────────────────── */}
      {st.status === 'running' && (
        <div className="bg-white rounded-2xl shadow-lg p-8">
          <div className="flex items-center gap-3 mb-6">
            <svg className="animate-spin h-7 w-7 text-blue-500 shrink-0"
                 fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10"
                      stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
            </svg>
            <h2 className="text-lg font-bold">Importing vocabulary from PDF…</h2>
          </div>

          {/* Progress bar */}
          <div className="bg-gray-100 rounded-full h-5 overflow-hidden mb-3">
            <div
              className="h-full rounded-full transition-all duration-700
                         bg-gradient-to-r from-blue-500 to-indigo-500"
              style={{ width: st.total_pages > 0
                ? `${Math.round(st.pages_done / st.total_pages * 100)}%`
                : '5%' }}
            />
          </div>

          <div className="flex justify-between text-xs text-gray-500 mb-4">
            <span>
              Page <strong>{st.pages_done}</strong> of{' '}
              <strong>{st.total_pages || '…'}</strong>
            </span>
            <span>
              <strong className="text-blue-600 text-sm">{st.words_found}</strong> words found
            </span>
          </div>
          <p className="text-sm text-gray-600 italic">{st.message}</p>
          <p className="mt-4 text-xs text-gray-400">⏳ Auto-refreshes on completion.</p>
        </div>
      )}

      {/* ── Error ─────────────────────────────────────────────────────────── */}
      {st.status === 'error' && (
        <div className="bg-red-50 border border-red-200 rounded-2xl p-8 text-center">
          <div className="text-4xl mb-3 select-none">❌</div>
          <h2 className="text-lg font-bold text-red-700 mb-2">Import failed</h2>
          <p className="text-sm text-red-600 mb-6 font-mono break-all">{st.message}</p>
          <button
            onClick={onTrigger}
            className="bg-red-600 hover:bg-red-700 text-white text-sm
                       px-6 py-2.5 rounded-xl cursor-pointer transition-colors"
          >
            ↺ Try again
          </button>
        </div>
      )}

    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  LOADING SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function LoadingScreen() {
  return (
    <div className="min-h-screen flex flex-col">
      {/* Navbar skeleton */}
      <header className="bg-white shadow-sm sticky top-0 z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <span className="text-3xl select-none">📚</span>
          <div>
            <h1 className="text-lg font-bold text-blue-800 leading-tight">
              Oxford 3000 Vocabulary Trainer
            </h1>
          </div>
        </div>
      </header>

      {/* Centered spinner */}
      <div className="flex-1 flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div
            className="w-12 h-12 rounded-full border-4 border-blue-100 border-t-blue-600 animate-spin"
            aria-label="Loading"
          />
          <p className="text-sm text-gray-400 select-none">Loading your dashboard…</p>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  ERROR SCREEN
// ─────────────────────────────────────────────────────────────────────────────
function ErrorScreen({ message }) {
  return (
    <div className="min-h-screen flex items-center justify-center px-4">
      <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-8 max-w-md w-full text-center">
        <div className="text-5xl mb-4 select-none">⚠️</div>
        <h2 className="text-lg font-bold text-gray-800 mb-2">Failed to load dashboard</h2>
        <p className="text-sm text-red-500 mb-3 font-mono break-all">{message}</p>
        <p className="text-xs text-gray-400 mb-6">
          Make sure the Flask server is running on port 5000 and you are logged in.
        </p>
        <button
          onClick={() => window.location.reload()}
          className="bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold
                     px-6 py-2 rounded-full transition-colors cursor-pointer"
        >
          Try again
        </button>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  DRAG HANDLE  — floating grip icon shown on card hover
// ─────────────────────────────────────────────────────────────────────────────
function DragHandle() {
  return (
    <div
      className="drag-hint absolute top-2 right-2 z-10 text-gray-300 select-none"
      title="Drag to rearrange"
    >
      <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
        <circle cx="5" cy="4"  r="1.4"/>
        <circle cx="11" cy="4"  r="1.4"/>
        <circle cx="5" cy="8"  r="1.4"/>
        <circle cx="11" cy="8"  r="1.4"/>
        <circle cx="5" cy="12" r="1.4"/>
        <circle cx="11" cy="12" r="1.4"/>
      </svg>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CARD WRAPPER
// ─────────────────────────────────────────────────────────────────────────────
function Card({ children, className = '', padding = 'p-5' }) {
  return (
    <div
      className={`card-base relative bg-white rounded-2xl shadow-sm border
                  border-gray-100 h-full w-full overflow-hidden
                  transition-shadow duration-200 ${padding} ${className}`}
    >
      <DragHandle />
      {children}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  HERO CARD  — total word count  (matches Jinja: white card, blue number)
// ─────────────────────────────────────────────────────────────────────────────
function HeroCard({ total }) {
  return (
    <Card>
      <div className="flex flex-col items-center justify-center h-full text-center">
        <p className="text-sm uppercase tracking-widest text-gray-400 mb-1 select-none">
          Total Words in Database
        </p>
        <p className="text-7xl font-extrabold text-blue-600 leading-none tabular-nums">
          {total.toLocaleString()}
        </p>
        <p className="mt-2 text-gray-500 text-sm select-none">words ready for study</p>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  CEFR LEVEL CARD  (matches Jinja: icon + count + level + label, no mini bar)
// ─────────────────────────────────────────────────────────────────────────────
function CefrCard({ meta, count, total }) {
  return (
    <Card padding="p-0" className={`${meta.bg} border ${meta.border}`}>
      <div className="flex flex-col items-center justify-center h-full text-center px-4 py-5 gap-1">
        <DragHandle />
        <span className="text-2xl select-none mb-1">{meta.icon}</span>
        <p className={`text-3xl font-bold tabular-nums ${meta.text}`}>
          {count.toLocaleString()}
        </p>
        <p className={`text-xs font-semibold ${meta.text} mt-1`}>{meta.level}</p>
        <p className="text-xs text-gray-500">{meta.label}</p>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  STAT CARD  — single metric (introduced / due / streak)
// ─────────────────────────────────────────────────────────────────────────────
function StatCard({ icon, value, label, valueClass = 'text-gray-800' }) {
  return (
    <Card>
      <div className="flex items-center gap-4 h-full">
        <span className="text-4xl select-none shrink-0">{icon}</span>
        <div className="min-w-0">
          <p className={`text-3xl font-extrabold tabular-nums leading-none ${valueClass}`}>
            {typeof value === 'number' ? value.toLocaleString() : value}
          </p>
          <p className="text-sm text-gray-500 mt-1 truncate">{label}</p>
        </div>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  DISTRIBUTION BAR CARD  (matches Jinja: pastel bg segments + plain legend)
// ─────────────────────────────────────────────────────────────────────────────
function DistributionCard({ levelCounts, total }) {
  return (
    <Card>
      <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-3 select-none">
        Level Distribution
      </p>
      <div className="flex rounded-full overflow-hidden h-5 gap-px">
        {CEFR_META.map(({ level, bg }) => {
          const pct = total > 0 ? (levelCounts[level] / total * 100).toFixed(1) : 0
          return (
            <div
              key={level}
              className={`h-full transition-all duration-700 ${bg}`}
              style={{ width: `${pct}%` }}
              title={`${level}: ${levelCounts[level]?.toLocaleString()} words (${pct}%)`}
            />
          )
        })}
      </div>
      <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
        {CEFR_META.map(({ level, icon }) => {
          const pct = total > 0 ? (levelCounts[level] / total * 100).toFixed(1) : 0
          return (
            <span key={level} className="select-none">
              {icon} <strong>{level}</strong> {pct}%
            </span>
          )
        })}
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  PROGRESS CARD
// ─────────────────────────────────────────────────────────────────────────────
function ProgressCard({ progress, mastery, total }) {
  const introPct = total > 0 ? (progress.introduced / total * 100).toFixed(1) : 0

  return (
    <Card>
      <p className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-5 select-none">
        📈 Your Progress
      </p>

      {/* Introduction progress bar */}
      <div className="mb-5">
        <div className="flex justify-between items-baseline mb-2">
          <span className="text-sm font-medium text-gray-700">Words Introduced</span>
          <span className="text-sm font-bold text-blue-600 tabular-nums">
            {progress.introduced.toLocaleString()} / {total.toLocaleString()}
          </span>
        </div>
        <div className="bg-gray-100 rounded-full h-3 overflow-hidden">
          <div
            className="h-full rounded-full progress-fill bg-gradient-to-r from-blue-500 to-indigo-500"
            style={{ width: `${introPct}%` }}
          />
        </div>
        <p className="text-xs text-gray-400 mt-1.5">
          {introPct}% of Oxford 3000 introduced
        </p>
      </div>

      {/* Memory breakdown */}
      <p className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3 select-none">
        Memory Breakdown
      </p>
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-extrabold text-emerald-600 tabular-nums">
            {mastery.mastered.toLocaleString()}
          </p>
          <p className="text-xs font-bold text-emerald-700 mt-1">Mastered</p>
          <p className="text-xs text-gray-400 mt-0.5">4+ reviews</p>
        </div>
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-extrabold text-blue-600 tabular-nums">
            {mastery.learning.toLocaleString()}
          </p>
          <p className="text-xs font-bold text-blue-700 mt-1">Learning</p>
          <p className="text-xs text-gray-400 mt-0.5">1–3 reviews</p>
        </div>
        <div className="bg-red-50 border border-red-100 rounded-xl p-4 text-center">
          <p className="text-2xl font-extrabold text-red-500 tabular-nums">
            {mastery.struggling.toLocaleString()}
          </p>
          <p className="text-xs font-bold text-red-600 mt-1">Struggling</p>
          <p className="text-xs text-gray-400 mt-0.5">needs work</p>
        </div>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  STUDY CARD  — CEFR filter + action buttons
//
//  The selected CEFR level is stored in localStorage under LS_CEFR_KEY so it
//  persists across page reloads.  It gates the "Learn New Words" button: the
//  remaining-words label updates to reflect the chosen level, and when the
//  button is clicked the /api/new-session endpoint is called with ?level=X.
// ─────────────────────────────────────────────────────────────────────────────
function StudyCard({ progress, total, levelCounts, onStartSession, onToast }) {
  // ── Initialise filter from localStorage (falls back to 'All') ──────────────
  const [cefrFilter, setCefrFilter] = useState(() => {
    try { return localStorage.getItem(LS_CEFR_KEY) || 'All' } catch { return 'All' }
  })

  const handleFilterChange = useCallback((level) => {
    setCefrFilter(level)
    try { localStorage.setItem(LS_CEFR_KEY, level) } catch {}
  }, [])

  // ── Derive remaining words for the active filter ───────────────────────────
  // 'All'  → total words in DB minus what the user has already introduced
  // A1–B2  → total words at that CEFR level in the DB
  //          (a per-level introduced count would need a new API endpoint)
  const remaining = cefrFilter === 'All'
    ? Math.max(0, total - progress.introduced)
    : (levelCounts[cefrFilter] ?? 0)

  const remainingLabel = cefrFilter === 'All'
    ? `${remaining.toLocaleString()} words remaining`
    : `${remaining.toLocaleString()} ${cefrFilter} words in database`

  const levelDescription = cefrFilter === 'All'
    ? 'Introduce vocabulary at your level'
    : `Filtered to ${cefrFilter} · ${CEFR_META.find(m => m.level === cefrFilter)?.label ?? ''}`

  const hasDue = progress.due_today > 0

  function handleReviewClick() {
    if (hasDue) {
      onStartSession({ type: 'review', level: 'All' })
    } else {
      onToast('✅ Nothing due for review today – come back tomorrow!')
    }
  }

  return (
    <Card>
      <div className="flex flex-col h-full gap-3">

        {/* Header */}
        <p className="text-lg font-semibold text-gray-700 select-none shrink-0">
          🚀 Start Studying
        </p>

        {/* ── CEFR level filter pills ─────────────────────────────────────── */}
        <div className="flex gap-1.5 flex-wrap shrink-0">
          {CEFR_FILTERS.map(level => {
            const meta  = CEFR_META.find(m => m.level === level)
            const isAll = level === 'All'
            const active = cefrFilter === level

            return (
              <button
                key={level}
                onClick={() => handleFilterChange(level)}
                className={[
                  'no-drag text-xs font-semibold px-2.5 py-1 rounded-full',
                  'transition-all duration-150 cursor-pointer select-none',
                  active
                    ? isAll
                      ? 'bg-blue-600 text-white shadow-sm'
                      : 'text-white shadow-sm'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-700',
                ].join(' ')}
                style={active && !isAll ? { background: meta?.accent } : undefined}
                title={meta ? `Filter to ${meta.label}` : 'Show all levels'}
              >
                {level}
              </button>
            )
          })}
        </div>

        {/* ── Action buttons ──────────────────────────────────────────────── */}
        <div className="flex flex-col gap-3 flex-1 min-h-0">

          {/* Learn New Words — matches Jinja: rounded-2xl p-6, text-lg, icon text-5xl */}
          <button
            onClick={() => onStartSession({ type: 'new', level: cefrFilter })}
            className="no-drag group flex items-center gap-5 bg-blue-600 hover:bg-blue-700
                       active:scale-95 text-white rounded-2xl shadow-lg p-6
                       transition-all duration-200 cursor-pointer text-left flex-1"
          >
            <span className="text-5xl select-none group-hover:scale-110 transition-transform shrink-0">
              ✨
            </span>
            <div>
              <p className="text-lg font-bold leading-tight">Learn New Words</p>
              <p className="text-blue-200 text-sm mt-1">{levelDescription}</p>
              <p className="text-blue-100 text-xs mt-2 font-medium tabular-nums">
                {remainingLabel}
              </p>
            </div>
          </button>

          {/* Review Words — matches Jinja: rounded-2xl p-6, text-lg, icon text-5xl */}
          <button
            onClick={handleReviewClick}
            className={[
              'no-drag group flex items-center gap-5 text-white rounded-2xl shadow-lg p-6',
              'transition-all duration-200 text-left flex-1 cursor-pointer',
              hasDue
                ? 'bg-emerald-600 hover:bg-emerald-700 active:scale-95'
                : 'bg-gray-400 hover:bg-gray-500 active:scale-95',
            ].join(' ')}
          >
            <span className="text-5xl select-none group-hover:scale-110 transition-transform shrink-0">
              🔁
            </span>
            <div>
              <p className="text-lg font-bold leading-tight">Review Words</p>
              <p className="text-sm mt-1 opacity-80">Spaced-repetition flashcard session</p>
              <p className="text-xs mt-2 font-medium opacity-90 tabular-nums">
                {hasDue
                  ? `${progress.due_today.toLocaleString()} words due today`
                  : 'Nothing due – great job! 🎉'}
              </p>
            </div>
          </button>

        </div>
      </div>
    </Card>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  TOAST  — lightweight auto-dismiss notification (matches Jinja showToast)
// ─────────────────────────────────────────────────────────────────────────────
function Toast({ message, onDone, topOffset = 80 }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4500)
    return () => clearTimeout(t)
  }, [onDone])

  return (
    <div
      className="fixed left-0 right-0 z-50 flex justify-center pointer-events-none px-4"
      style={{ top: topOffset + 8 }}
    >
      <div className="bg-gray-900 text-white text-sm font-medium
                      px-5 py-3 rounded-xl shadow-xl max-w-sm w-full text-center
                      animate-slideUp select-none">
        {message}
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  RESET LAYOUT BUTTON
// ─────────────────────────────────────────────────────────────────────────────
function ResetButton({ onReset }) {
  return (
    <button
      onClick={onReset}
      title="Reset layout to default"
      className="no-drag flex items-center gap-1.5 text-xs text-gray-400 hover:text-blue-600
                 bg-white hover:bg-blue-50 border border-gray-200 hover:border-blue-200
                 px-3 py-1.5 rounded-full transition-all duration-150 cursor-pointer
                 shadow-sm select-none"
    >
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
        <path d="M3 3v5h5"/>
      </svg>
      Reset layout
    </button>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
//  MAIN DASHBOARD
// ─────────────────────────────────────────────────────────────────────────────
export default function Dashboard({ onStartSession }) {
  const { width } = useWindowSize()

  // ── Breakpoints ────────────────────────────────────────────────────────────
  const cols   = width < 640 ? 4 : 12
  const rowH   = width < 640 ? 38 : 44
  const margin = [12, 12]

  // ── Edit-mode toggle (must click to enable dragging) ──────────────────────
  const [editMode, setEditMode] = useState(false)

  // ── Navbar dropdown menu ──────────────────────────────────────────────────
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef(null)
  useEffect(() => {
    if (!menuOpen) return
    function handleOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    document.addEventListener('touchstart', handleOutside)
    return () => {
      document.removeEventListener('mousedown', handleOutside)
      document.removeEventListener('touchstart', handleOutside)
    }
  }, [menuOpen])

  // ── Layout state (persisted to localStorage) ───────────────────────────────
  const [layouts,     setLayouts]     = useState(loadLayouts)
  const [hiddenCards, setHiddenCards] = useState(loadHidden)

  const currentLayout = useMemo(() => {
    const base = width < 640  ? (layouts.sm ?? DEFAULT_LAYOUTS.sm)
               : width < 1024 ? (layouts.md ?? DEFAULT_LAYOUTS.md)
               :                 (layouts.lg ?? DEFAULT_LAYOUTS.lg)
    return base.filter(item => !hiddenCards.has(item.i))
  }, [layouts, width, hiddenCards])

  const handleLayoutChange = useCallback((newLayout) => {
    setLayouts(prev => {
      const key  = width < 640 ? 'sm' : width < 1024 ? 'md' : 'lg'
      const next = { ...prev, [key]: newLayout }
      saveLayouts(next)
      return next
    })
  }, [width])

  const handleReset = useCallback(() => {
    setLayouts(DEFAULT_LAYOUTS)
    saveLayouts(DEFAULT_LAYOUTS)
    const empty = new Set()
    setHiddenCards(empty)
    saveHidden(empty)
  }, [])

  // ── Hide / show card ────────────────────────────────────────────────────────
  const handleHideCard = useCallback((cardId) => {
    setHiddenCards(prev => {
      const next = new Set(prev)
      next.add(cardId)
      saveHidden(next)
      return next
    })
  }, [])

  const handleShowCard = useCallback((cardId) => {
    setHiddenCards(prev => {
      const next = new Set(prev)
      next.delete(cardId)
      saveHidden(next)
      return next
    })
    // Ensure the card exists in all breakpoint layouts (append at bottom if missing)
    setLayouts(prev => {
      const updated = {}
      for (const bp of ['sm', 'md', 'lg']) {
        const bpLayout = prev[bp] ?? DEFAULT_LAYOUTS[bp]
        if (bpLayout.some(item => item.i === cardId)) {
          updated[bp] = bpLayout          // already in layout, just unhiding
        } else {
          const defItem = DEFAULT_LAYOUTS[bp].find(item => item.i === cardId)
          const maxY    = bpLayout.reduce((m, item) => Math.max(m, item.y + item.h), 0)
          updated[bp]   = [...bpLayout, { ...defItem, y: maxY }]
        }
      }
      saveLayouts(updated)
      return updated
    })
  }, [])

  // ── API data ───────────────────────────────────────────────────────────────
  const { data, loading, error, refetch } = useDashboardStats()

  // ── Toast state (rendered outside GridLayout to avoid CSS-transform breakage)
  const [toast, setToast] = useState('')

  // ── Header height — measured dynamically so Toast always clears the navbar
  const [headerH, setHeaderH] = useState(80)
  useEffect(() => {
    const el = document.getElementById('main-navbar')
    if (!el) return
    setHeaderH(el.offsetHeight)
    const obs = new ResizeObserver(() => setHeaderH(el.offsetHeight))
    obs.observe(el)
    return () => obs.disconnect()
  }, [])

  // ── Import state (only active when DB is empty or re-import triggered) ──────
  const needsImport      = !loading && !error && data?.total === 0
  const [reimporting, setReimporting] = useState(false)
  const importEnabled    = needsImport || reimporting

  const { importState, triggerImport } = useImportState({
    enabled: importEnabled,
    onDone : useCallback(() => {
      setReimporting(false)
      refetch()             // re-fetch /api/stats after import completes
    }, [refetch]),
  })

  if (loading) return <LoadingScreen />
  if (error)   return <ErrorScreen message={error} />

  const { username, total, levelCounts, progress, mastery, streak } = data

  // ── Shared navbar ──────────────────────────────────────────────────────────
  const Navbar = (
    <header id="main-navbar" className="bg-white shadow-sm sticky top-0 z-50 border-b border-gray-100">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 select-none">
          <span className="text-3xl">📚</span>
          <div>
            <h1 className="text-lg font-bold text-blue-800 leading-tight">
              Oxford 3000 Vocabulary Trainer
            </h1>
            <p className="text-xs text-gray-400 hidden sm:block">
              American Oxford 3000 · CEFR A1–B2
            </p>
          </div>
        </div>

        {/* ── Single menu button → dropdown ───────────────────────────────── */}
        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(o => !o)}
            className={[
              'no-drag flex items-center gap-2 text-xs font-semibold',
              'px-3 py-2 rounded-full border transition-all duration-150 cursor-pointer select-none shadow-sm',
              menuOpen || editMode
                ? 'bg-blue-600 text-white border-blue-500 hover:bg-blue-700'
                : 'bg-white text-gray-600 border-gray-200 hover:text-blue-600 hover:border-blue-200 hover:bg-blue-50',
            ].join(' ')}
            title="Menu"
          >
            {/* Person icon */}
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="8" r="4"/>
              <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/>
            </svg>
            <span className="hidden sm:inline max-w-[90px] truncate">{username}</span>
            {/* Caret */}
            <svg
              width="10" height="10" viewBox="0 0 10 10" fill="currentColor"
              className={`transition-transform duration-200 ${menuOpen ? 'rotate-180' : ''}`}
            >
              <path d="M1 3l4 4 4-4"/>
            </svg>
          </button>

          {/* Dropdown panel */}
          {menuOpen && (
            <div className="absolute right-0 top-full mt-2 bg-white rounded-2xl shadow-xl
                            border border-gray-100 py-1.5 min-w-[200px] z-[60]
                            animate-slideUp origin-top-right">

              {/* Username header */}
              <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
                <span className="text-base">👤</span>
                <span className="text-sm font-semibold text-gray-700 truncate">{username}</span>
              </div>

              {/* Edit Layout / Done */}
              <button
                onClick={() => { setEditMode(e => !e); setMenuOpen(false) }}
                className="w-full text-left px-4 py-2.5 text-sm text-gray-700
                           hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2.5
                           transition-colors cursor-pointer"
              >
                <span>{editMode ? '✓' : '✏️'}</span>
                <span>{editMode ? 'Done editing' : 'Edit Layout'}</span>
              </button>

              {/* Reset Layout — only in edit mode */}
              {editMode && (
                <button
                  onClick={() => { handleReset(); setMenuOpen(false) }}
                  className="w-full text-left px-4 py-2.5 text-sm text-orange-500
                             hover:bg-orange-50 flex items-center gap-2.5
                             transition-colors cursor-pointer"
                >
                  <span>↺</span>
                  <span>Reset Layout</span>
                </button>
              )}

              {/* Re-import — only when words exist */}
              {total > 0 && (
                <button
                  onClick={() => { setReimporting(true); triggerImport(); setMenuOpen(false) }}
                  disabled={reimporting}
                  className="w-full text-left px-4 py-2.5 text-sm text-gray-700
                             hover:bg-gray-50 flex items-center gap-2.5
                             transition-colors cursor-pointer
                             disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  <span>↺</span>
                  <span>{reimporting ? 'Importing…' : 'Re-import words'}</span>
                </button>
              )}

              {/* Logout */}
              <div className="border-t border-gray-100 mt-1 pt-1">
                <button
                  onClick={() => { window.location.href = '/logout' }}
                  className="w-full text-left px-4 py-2.5 text-sm text-red-500
                             hover:bg-red-50 flex items-center gap-2.5
                             transition-colors cursor-pointer"
                >
                  <span>🚪</span>
                  <span>Logout</span>
                </button>
              </div>

            </div>
          )}
        </div>
      </div>
    </header>
  )

  // ── Show import panel when DB empty ───────────────────────────────────────
  if (needsImport) {
    return (
      <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
        {Navbar}
        <ImportPanel importState={importState} onTrigger={triggerImport} />
      </div>
    )
  }

  // ── Re-import progress overlay ─────────────────────────────────────────────
  // (shown as a modal over the dashboard while re-import is running)
  const ReimportOverlay = reimporting && importState && (
    <div className="fixed inset-0 z-40 flex items-center justify-center
                    bg-black/30 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-xl p-8 w-full max-w-md mx-4">
        <div className="flex items-center gap-3 mb-5">
          <svg className="animate-spin h-6 w-6 text-blue-500 shrink-0" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
          </svg>
          <h2 className="text-base font-bold">Re-importing vocabulary…</h2>
        </div>
        <div className="bg-gray-100 rounded-full h-3 overflow-hidden mb-2">
          <div className="h-full rounded-full bg-gradient-to-r from-blue-500 to-indigo-500 transition-all duration-700"
               style={{ width: importState.total_pages > 0
                 ? `${Math.round(importState.pages_done / importState.total_pages * 100)}%`
                 : '5%' }} />
        </div>
        <p className="text-xs text-gray-500 text-center">
          {importState.message || '…'}
        </p>
      </div>
    </div>
  )

  // ── Card registry ──────────────────────────────────────────────────────────
  const cardMap = {
    'hero':        <HeroCard total={total} />,
    'cefr-A1':     <CefrCard meta={CEFR_META[0]} count={levelCounts.A1 ?? 0} total={total} />,
    'cefr-A2':     <CefrCard meta={CEFR_META[1]} count={levelCounts.A2 ?? 0} total={total} />,
    'cefr-B1':     <CefrCard meta={CEFR_META[2]} count={levelCounts.B1 ?? 0} total={total} />,
    'cefr-B2':     <CefrCard meta={CEFR_META[3]} count={levelCounts.B2 ?? 0} total={total} />,
    'stat-intro':  <StatCard icon="🎓" value={progress.introduced} label="words introduced" />,
    'stat-due':    <StatCard
                     icon="⏰"
                     value={progress.due_today}
                     label="due for review today"
                     valueClass={progress.due_today > 0 ? 'text-orange-500' : 'text-gray-800'}
                   />,
    'stat-streak': <StatCard
                     icon="🔥"
                     value={`${streak} day${streak !== 1 ? 's' : ''}`}
                     label="study streak"
                     valueClass="text-orange-500"
                   />,
    'dist-bar':    <DistributionCard levelCounts={levelCounts} total={total} />,
    'progress':    <ProgressCard progress={progress} mastery={mastery} total={total} />,
    'study':       <StudyCard progress={progress} total={total} levelCounts={levelCounts} onStartSession={onStartSession} onToast={setToast} />,
  }

  return (
    <div className="min-h-screen">
      {toast && <Toast message={toast} onDone={() => setToast('')} topOffset={headerH} />}
      {ReimportOverlay}
      {Navbar}

      {/* ── Banner: edit-mode active ──────────────────────────────────────── */}
      {editMode ? (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-4 pb-1">
          <div className="flex items-center gap-2.5 text-xs font-medium
                          text-blue-700 bg-blue-50 border border-blue-200
                          rounded-xl px-4 py-2.5 select-none animate-slideUp">
            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
              <circle cx="5" cy="4"  r="1.4"/>
              <circle cx="11" cy="4"  r="1.4"/>
              <circle cx="5" cy="8"  r="1.4"/>
              <circle cx="11" cy="8"  r="1.4"/>
              <circle cx="5" cy="12" r="1.4"/>
              <circle cx="11" cy="12" r="1.4"/>
            </svg>
            <span>
              Drag to rearrange · hover a card and tap <strong>✕</strong> to remove — click{' '}
              <strong>✓ Done</strong> when finished
            </span>
          </div>
        </div>
      ) : null}

      {/* ── Draggable grid ───────────────────────────────────────────────── */}
      <main className={`max-w-7xl mx-auto px-4 sm:px-6 pb-10 ${editMode ? 'edit-mode' : ''}`}>
        <GridLayout
          layout={currentLayout}
          cols={cols}
          rowHeight={rowH}
          margin={margin}
          width={Math.min(width - 32, 1280)}
          onLayoutChange={handleLayoutChange}
          draggableCancel=".no-drag"
          isDraggable={editMode}
          resizable={false}
          compactType="vertical"
          preventCollision={false}
          useCSSTransforms
        >
          {currentLayout.map(({ i }) => (
            <div key={i} className="relative group/card">
              {/* ✕ Remove button — only in edit mode */}
              {editMode && (
                <button
                  onClick={() => handleHideCard(i)}
                  className="no-drag absolute top-2 right-2 z-20
                             w-7 h-7 bg-red-500 hover:bg-red-600 active:scale-90
                             text-white text-sm font-bold rounded-full
                             flex items-center justify-center
                             shadow-lg transition-all duration-150 cursor-pointer"
                  title={`Remove "${CARD_META[i]?.label ?? i}"`}
                >
                  ✕
                </button>
              )}
              {cardMap[i] ?? null}
            </div>
          ))}
        </GridLayout>
      </main>

      {/* ── Add Cards panel — shown in edit mode when cards are hidden ────── */}
      {editMode && hiddenCards.size > 0 && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 pb-4 animate-slideUp">
          <div className="border-2 border-dashed border-blue-200 rounded-2xl p-4 bg-blue-50/40">
            <p className="text-xs font-semibold text-blue-500 uppercase tracking-wider mb-3 select-none">
              ＋ Add cards back
            </p>
            <div className="flex flex-wrap gap-2">
              {[...hiddenCards].map(cardId => (
                <button
                  key={cardId}
                  onClick={() => handleShowCard(cardId)}
                  className="no-drag flex items-center gap-1.5
                             bg-white border border-gray-200 hover:border-blue-400
                             hover:bg-blue-50 text-sm text-gray-700
                             px-3 py-2 rounded-xl shadow-sm
                             transition-all duration-150 cursor-pointer select-none"
                >
                  <span>{CARD_META[cardId]?.icon ?? '📄'}</span>
                  <span>{CARD_META[cardId]?.label ?? cardId}</span>
                  <span className="text-blue-500 font-bold ml-0.5 text-base leading-none">＋</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Footer ───────────────────────────────────────────────────────── */}
      <footer className="text-center text-xs text-gray-400 pb-6 select-none">
        Oxford 3000 Vocabulary Trainer &middot; American Oxford 3000 &middot; CEFR A1–B2
      </footer>
    </div>
  )
}
