import React, { useState, useEffect, useMemo } from 'react'

// ── Date helpers ───────────────────────────────────────────────────────────────

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

function fmtShort(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  return `${d.getDate()}/${d.getMonth() + 1}`
}

function fmtMed(dateStr) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

// ── Data fetching ──────────────────────────────────────────────────────────────

function useAnalytics() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    Promise.all([
      fetch('/api/analytics/history',   { credentials: 'include' }).then(r => r.json()),
      fetch('/api/analytics/forecast',  { credentials: 'include' }).then(r => r.json()),
      fetch('/api/analytics/breakdown', { credentials: 'include' }).then(r => r.json()),
      fetch('/api/analytics/heatmap',   { credentials: 'include' }).then(r => r.json()),
    ])
      .then(([hist, fore, brk, heat]) => { if (!cancelled) setData({ hist, fore, brk, heat }) })
      .catch(e => { if (!cancelled) setError(e.message) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  return { data, loading, error }
}

// ── Health Stats ───────────────────────────────────────────────────────────────

function HealthStats({ brk }) {
  const h = brk?.health ?? {}
  const avgEf = h.avg_ef ?? 0
  const efColor = avgEf >= 2.0 ? 'text-emerald-600' : avgEf >= 1.6 ? 'text-amber-500' : 'text-red-500'
  const efSub   = avgEf >= 2.0 ? 'Good retention' : avgEf >= 1.6 ? 'Fair retention' : 'Needs practice'

  const items = [
    { icon: '🎓', value: (h.total_introduced ?? 0).toLocaleString(), label: 'Introduced',    sub: 'words studied',      color: 'text-blue-600' },
    { icon: '🔄', value: (h.total_reviews    ?? 0).toLocaleString(), label: 'Total Reviews', sub: 'all-time reps',      color: 'text-indigo-600' },
    { icon: '🔥', value: `${h.streak ?? 0}d`,                        label: 'Streak',        sub: 'consecutive days',   color: 'text-orange-500' },
    { icon: '💡', value: avgEf ? avgEf.toFixed(2) : '—',             label: 'Avg Ease',      sub: efSub,                color: efColor },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      {items.map(({ icon, value, label, sub, color }) => (
        <div key={label} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4 text-center">
          <div className="text-3xl mb-1 select-none">{icon}</div>
          <div className={`text-2xl font-extrabold tabular-nums ${color}`}>{value}</div>
          <div className="text-xs font-semibold text-gray-600 mt-0.5">{label}</div>
          <div className="text-xs text-gray-400">{sub}</div>
        </div>
      ))}
    </div>
  )
}

// ── Activity Chart — vertical bars, last 30 days ───────────────────────────────

function ActivityChart({ hist, totalWords, totalIntroduced }) {
  const todayStr = useMemo(() => new Date().toISOString().slice(0, 10), [])

  const days = useMemo(() => {
    const lookup = {}
    for (const r of (hist?.history ?? [])) lookup[r.date] = r.count
    return Array.from({ length: 30 }, (_, i) => {
      const d = addDays(todayStr, i - 29)
      return { date: d, count: lookup[d] ?? 0 }
    })
  }, [hist, todayStr])

  const maxCount   = Math.max(...days.map(d => d.count), 1)
  const total30    = days.reduce((s, d) => s + d.count, 0)
  const activeDays = days.filter(d => d.count > 0).length

  const etaLabel = useMemo(() => {
    const avg = total30 / 30
    if (avg < 0.1 || !totalWords || !totalIntroduced) return null
    const remaining = Math.max(0, totalWords - totalIntroduced)
    if (remaining === 0) return 'All words introduced! 🎉'
    const days = Math.ceil(remaining / avg)
    return days <= 365
      ? `~${days} days to finish at this pace`
      : `~${(days / 365).toFixed(1)} years to finish at this pace`
  }, [total30, totalWords, totalIntroduced])

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">📅 Daily Activity</p>
          <p className="text-xs text-gray-400 mt-0.5">New words per day · last 30 days</p>
          {etaLabel && <p className="text-xs text-indigo-500 mt-0.5">{etaLabel}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-blue-600 tabular-nums">{total30} words</p>
          <p className="text-xs text-gray-400">{activeDays} active days</p>
        </div>
      </div>

      {/* Bars */}
      <div className="flex items-end gap-px" style={{ height: 64 }}>
        {days.map(({ date, count }) => {
          const isToday = date === todayStr
          const h = count > 0 ? Math.max(6, Math.round(count / maxCount * 64)) : 3
          return (
            <div key={date} className="flex-1 group relative flex flex-col justify-end" style={{ height: 64 }}>
              <div
                className={`w-full rounded-sm transition-colors ${
                  count === 0 ? 'bg-gray-100' :
                  isToday    ? 'bg-blue-500' : 'bg-blue-300 group-hover:bg-blue-500'
                }`}
                style={{ height: h }}
              />
              {count > 0 && (
                <div className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                                bg-gray-900 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap
                                opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow">
                  {fmtMed(date)}: {count}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* X-axis labels */}
      <div className="flex mt-1.5">
        {days.map(({ date }, i) => (
          <div key={date} className="flex-1 text-center overflow-hidden">
            {(i === 0 || i === 7 || i === 14 || i === 21 || i === 29) && (
              <span className="text-xs text-gray-400 select-none">{fmtShort(date)}</span>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Review Forecast — horizontal bars, next 14 days ───────────────────────────

function ForecastChart({ fore }) {
  const todayStr = fore?.today ?? new Date().toISOString().slice(0, 10)

  const days = useMemo(() => {
    const lookup = {}
    for (const r of (fore?.forecast ?? [])) lookup[r.date] = r.count
    return Array.from({ length: 14 }, (_, i) => {
      const d = addDays(todayStr, i)
      return { date: d, count: lookup[d] ?? 0, isToday: i === 0 }
    })
  }, [fore, todayStr])

  const maxCount = Math.max(...days.map(d => d.count), 1)
  const total    = days.reduce((s, d) => s + d.count, 0)

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">🔮 Review Forecast</p>
          <p className="text-xs text-gray-400 mt-0.5">Words due per day · next 14 days</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-emerald-600 tabular-nums">{total}</p>
          <p className="text-xs text-gray-400">total due</p>
        </div>
      </div>

      <div className="space-y-1.5">
        {days.map(({ date, count, isToday }) => (
          <div key={date} className="flex items-center gap-2">
            <span className={`text-xs w-14 shrink-0 tabular-nums ${
              isToday ? 'font-bold text-blue-600' : 'text-gray-500'
            }`}>
              {isToday ? 'Today' : fmtShort(date)}
            </span>
            <div className="flex-1 bg-gray-100 rounded-full h-3.5 overflow-hidden">
              {count > 0 && (
                <div
                  className={`h-full rounded-full transition-all ${isToday ? 'bg-blue-500' : 'bg-emerald-400'}`}
                  style={{ width: `${Math.max(4, count / maxCount * 100)}%` }}
                />
              )}
            </div>
            <span className={`text-xs tabular-nums w-6 text-right ${
              count > 0 ? 'text-gray-700 font-medium' : 'text-gray-300'
            }`}>
              {count || '—'}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── CEFR Mastery Breakdown — stacked bars per level ───────────────────────────

const LEVEL_STYLES = {
  A1: { pill: 'bg-emerald-100 text-emerald-700', label: 'Beginner' },
  A2: { pill: 'bg-teal-100 text-teal-700',       label: 'Elementary' },
  B1: { pill: 'bg-blue-100 text-blue-700',        label: 'Intermediate' },
  B2: { pill: 'bg-violet-100 text-violet-700',    label: 'Upper-Interm.' },
}

function CefrBreakdown({ brk }) {
  const rows = brk?.cefr_breakdown ?? []

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-0.5">📊 Mastery by Level</p>
      <p className="text-xs text-gray-400 mb-4">Introduced words per CEFR level</p>

      {rows.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6 select-none">No data yet — start studying!</p>
      ) : (
        <div className="space-y-5">
          {rows.map(r => {
            const styles    = LEVEL_STYLES[r.cefr_level] ?? LEVEL_STYLES.A1
            const total     = r.total_introduced
            const introPct  = r.total_in_level > 0 ? (r.total_introduced / r.total_in_level * 100) : 0
            const mPct      = total > 0 ? (r.mastered   / total * 100) : 0
            const lPct      = total > 0 ? (r.learning   / total * 100) : 0
            const sPct      = total > 0 ? (r.struggling / total * 100) : 0

            return (
              <div key={r.cefr_level}>
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${styles.pill}`}>
                      {r.cefr_level}
                    </span>
                    <span className="text-xs text-gray-500">{styles.label}</span>
                  </div>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {r.total_introduced} / {r.total_in_level}
                    <span className="text-gray-400 ml-1">({introPct.toFixed(0)}%)</span>
                  </span>
                </div>

                {/* Gray background = total in level; colored fill = introduced */}
                <div className="bg-gray-100 rounded-full h-4 overflow-hidden">
                  <div className="h-full flex" style={{ width: `${introPct}%` }}>
                    {r.mastered   > 0 && <div className="bg-emerald-500 h-full" style={{ width: `${mPct}%` }} title={`Mastered: ${r.mastered}`} />}
                    {r.learning   > 0 && <div className="bg-blue-400 h-full"    style={{ width: `${lPct}%` }} title={`Learning: ${r.learning}`} />}
                    {r.struggling > 0 && <div className="bg-red-400 h-full"     style={{ width: `${sPct}%` }} title={`Struggling: ${r.struggling}`} />}
                  </div>
                </div>

                <div className="flex gap-3 mt-1 text-xs text-gray-500 flex-wrap">
                  {r.mastered   > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0" />{r.mastered} mastered</span>}
                  {r.learning   > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0"   />{r.learning} learning</span>}
                  {r.struggling > 0 && <span className="flex items-center gap-1"><span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0"    />{r.struggling} struggling</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="mt-4 pt-3 border-t border-gray-100 flex flex-wrap gap-3 text-xs text-gray-400">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 shrink-0" /> Mastered (4+)</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-blue-400 shrink-0"   /> Learning (1–3)</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-red-400 shrink-0"    /> Struggling</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200 shrink-0"   /> Not started</span>
      </div>
    </div>
  )
}

// ── Weekly Pattern — vertical bars Mon–Sun ────────────────────────────────────

const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

function WeeklyPattern({ brk }) {
  // weekly_pattern is [Sun, Mon, Tue, Wed, Thu, Fri, Sat]; reorder to Mon–Sun for display
  const raw      = brk?.weekly_pattern ?? [0, 0, 0, 0, 0, 0, 0]
  const days     = [1, 2, 3, 4, 5, 6, 0].map(i => ({ label: DAY_LABELS[i], count: raw[i] }))
  const maxCount = Math.max(...days.map(d => d.count), 1)
  const total    = days.reduce((s, d) => s + d.count, 0)
  const bestDay  = days.reduce((b, d) => d.count > b.count ? d : b, days[0])

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">📆 Weekly Pattern</p>
          <p className="text-xs text-gray-400 mt-0.5">New words by day of week · all-time</p>
          {total > 0 && (
            <p className="text-xs text-purple-500 mt-0.5">Best day: {bestDay.label} ({bestDay.count})</p>
          )}
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-purple-600 tabular-nums">{total}</p>
          <p className="text-xs text-gray-400">total words</p>
        </div>
      </div>

      <div className="flex items-end gap-2" style={{ height: 64 }}>
        {days.map(({ label, count }) => {
          const h      = count > 0 ? Math.max(6, Math.round(count / maxCount * 64)) : 3
          const isMax  = count > 0 && count === maxCount
          return (
            <div key={label} className="flex-1 group relative flex flex-col justify-end" style={{ height: 64 }}>
              <div
                className={`w-full rounded-sm transition-colors ${
                  count === 0 ? 'bg-gray-100' :
                  isMax ? 'bg-purple-500' : 'bg-purple-300 group-hover:bg-purple-500'
                }`}
                style={{ height: h }}
                title={`${label}: ${count}`}
              />
              {count > 0 && (
                <div className="pointer-events-none absolute bottom-full mb-1 left-1/2 -translate-x-1/2
                                bg-gray-900 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap
                                opacity-0 group-hover:opacity-100 transition-opacity z-20 shadow">
                  {label}: {count}
                </div>
              )}
            </div>
          )
        })}
      </div>

      <div className="flex gap-2 mt-1.5">
        {days.map(({ label }) => (
          <div key={label} className="flex-1 text-center">
            <span className="text-xs text-gray-400 select-none">{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

// ── Hardest Words — lowest ease factor ───────────────────────────────────────

function HardestWords({ brk }) {
  const words = brk?.hardest_words ?? []

  function efStyle(ef) {
    if (ef < 1.5) return 'text-red-600 bg-red-50 border-red-200'
    if (ef < 1.8) return 'text-amber-600 bg-amber-50 border-amber-200'
    return 'text-gray-500 bg-gray-50 border-gray-200'
  }

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <p className="text-sm font-semibold text-gray-700 mb-0.5">🔴 Hardest Words</p>
      <p className="text-xs text-gray-400 mb-4">Lowest ease factor · needs most practice</p>

      {words.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6 select-none">No reviews yet</p>
      ) : (
        <ul className="space-y-2">
          {words.map((w, i) => (
            <li key={w.word} className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs text-gray-300 tabular-nums w-4 shrink-0">{i + 1}</span>
                <span className="font-semibold text-gray-800 text-sm truncate">{w.word}</span>
                {w.pos && <span className="text-xs text-gray-400 shrink-0">{w.pos}</span>}
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-xs font-medium text-gray-400 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
                  {w.cefr_level}
                </span>
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded border tabular-nums ${efStyle(w.easiness_factor)}`}>
                  {w.easiness_factor}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-gray-400 mt-4 pt-3 border-t border-gray-100">
        EF &lt;1.5 = very hard · 1.5–1.8 = hard · 1.8+ = normal
      </p>
    </div>
  )
}

// ── Activity Heatmap — GitHub-style calendar, last 18 weeks ──────────────────

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const HEATMAP_WEEKS = 18

function startOfWeek(dateStr) {
  const d = new Date(dateStr + 'T00:00:00')
  d.setDate(d.getDate() - d.getDay())
  return d.toISOString().slice(0, 10)
}

function levelClass(count, max) {
  if (count <= 0) return 'bg-gray-100'
  const ratio = count / max
  if (ratio <= 0.25) return 'bg-emerald-200'
  if (ratio <= 0.5)  return 'bg-emerald-400'
  if (ratio <= 0.75) return 'bg-emerald-500'
  return 'bg-emerald-600'
}

function ActivityHeatmap({ heat }) {
  const todayStr = heat?.today ?? new Date().toISOString().slice(0, 10)

  const { weeks, maxCount, totalCount } = useMemo(() => {
    const lookup = {}
    for (const r of (heat?.heatmap ?? [])) lookup[r.date] = r.count

    const gridStart = startOfWeek(addDays(todayStr, -(HEATMAP_WEEKS * 7 - 1)))
    const wks = []
    let max = 1
    let total = 0
    for (let w = 0; w < HEATMAP_WEEKS; w++) {
      const cells = []
      for (let d = 0; d < 7; d++) {
        const date  = addDays(gridStart, w * 7 + d)
        const future = date > todayStr
        const count  = future ? null : (lookup[date] ?? 0)
        if (count) { max = Math.max(max, count); total += count }
        cells.push({ date, count, future })
      }
      wks.push(cells)
    }
    return { weeks: wks, maxCount: max, totalCount: total }
  }, [heat, todayStr])

  const activeDays = weeks.flat().filter(c => c.count > 0).length

  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-start justify-between mb-3">
        <div>
          <p className="text-sm font-semibold text-gray-700">🟩 Activity Heatmap</p>
          <p className="text-xs text-gray-400 mt-0.5">Words reviewed per day · last {HEATMAP_WEEKS} weeks</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-bold text-emerald-600 tabular-nums">{totalCount}</p>
          <p className="text-xs text-gray-400">{activeDays} active days</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div className="inline-flex gap-[3px]">
          {weeks.map((cells, w) => {
            const sunday    = cells[0].date
            const showMonth = w === 0 || new Date(sunday + 'T00:00:00').getDate() <= 7
            return (
              <div key={sunday} className="flex flex-col gap-[3px]">
                <div className="text-xs text-gray-400 h-4 select-none">
                  {showMonth ? MONTH_LABELS[new Date(sunday + 'T00:00:00').getMonth()] : ''}
                </div>
                {cells.map(({ date, count, future }) => (
                  <div
                    key={date}
                    title={future ? '' : `${fmtMed(date)}: ${count} review${count === 1 ? '' : 's'}`}
                    className={`w-3 h-3 rounded-sm ${future ? 'bg-transparent' : levelClass(count, maxCount)}`}
                  />
                ))}
              </div>
            )
          })}
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3 text-xs text-gray-400 select-none">
        Less
        <span className="w-3 h-3 rounded-sm bg-gray-100" />
        <span className="w-3 h-3 rounded-sm bg-emerald-200" />
        <span className="w-3 h-3 rounded-sm bg-emerald-400" />
        <span className="w-3 h-3 rounded-sm bg-emerald-500" />
        <span className="w-3 h-3 rounded-sm bg-emerald-600" />
        More
      </div>
    </div>
  )
}

// ── Main ───────────────────────────────────────────────────────────────────────

export default function Progress({ onBack }) {
  const { data, loading, error } = useAnalytics()

  return (
    <div className="min-h-screen" style={{ background: 'linear-gradient(135deg,#eff6ff,#f0fdf4)' }}>
      <header className="bg-white shadow-sm sticky top-0 z-50 border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-blue-600 transition-colors cursor-pointer"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
            Dashboard
          </button>
          <span className="text-gray-300 select-none">|</span>
          <span className="text-base font-bold text-gray-700">📈 Progress Analytics</span>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-4">
        {loading && (
          <div className="flex items-center justify-center py-20">
            <div className="flex flex-col items-center gap-3">
              <div className="w-10 h-10 rounded-full border-4 border-blue-100 border-t-blue-500 animate-spin" />
              <p className="text-sm text-gray-400 select-none">Loading analytics…</p>
            </div>
          </div>
        )}

        {error && (
          <div className="bg-red-50 border border-red-200 rounded-2xl p-6 text-center">
            <p className="text-red-600 text-sm">{error}</p>
          </div>
        )}

        {!loading && !error && data && (
          <>
            <HealthStats brk={data.brk} />
            <ActivityChart
              hist={data.hist}
              totalWords={data.brk?.health?.total_words}
              totalIntroduced={data.brk?.health?.total_introduced}
            />
            <ActivityHeatmap heat={data.heat} />
            <div className="grid sm:grid-cols-2 gap-4">
              <WeeklyPattern brk={data.brk} />
              <ForecastChart fore={data.fore} />
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
              <CefrBreakdown brk={data.brk} />
              <HardestWords brk={data.brk} />
            </div>
          </>
        )}
      </main>

      <footer className="text-center text-xs text-gray-400 pb-8 select-none">
        Oxford 3000 Vocabulary Trainer · American Oxford 3000 · CEFR A1–B2
      </footer>
    </div>
  )
}
