import { useState } from 'react'
import Dashboard from './Dashboard.jsx'
import Session   from './Session.jsx'
import Game      from './Game.jsx'
import Progress  from './Progress.jsx'

/**
 * App.jsx  –  Top-level view router (no URL routing needed — just React state).
 *
 * Views
 * ─────
 *   'dashboard'  – the live stats grid (default)
 *   'session'    – flashcard study session (new-word or review)
 *   'progress'   – analytics page
 */
export default function App() {
  const [view,          setView]          = useState('dashboard')
  const [sessionConfig, setSessionConfig] = useState({ type: 'new', level: 'All' })

  if (view === 'session') {
    return (
      <Session
        type={sessionConfig.type}
        level={sessionConfig.level}
        onBack={() => setView('dashboard')}
      />
    )
  }

  if (view === 'game') {
    return <Game onBack={() => setView('dashboard')} />
  }

  if (view === 'progress') {
    return <Progress onBack={() => setView('dashboard')} />
  }

  return (
    <Dashboard
      onStartSession={config => {
        setSessionConfig(config)
        setView('session')
      }}
      onStartGame={() => setView('game')}
      onViewProgress={() => setView('progress')}
    />
  )
}
