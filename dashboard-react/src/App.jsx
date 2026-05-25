import { useState } from 'react'
import Dashboard from './Dashboard.jsx'
import Session   from './Session.jsx'

/**
 * App.jsx  –  Top-level view router (no URL routing needed — just React state).
 *
 * Views
 * ─────
 *   'dashboard'  – the live stats grid (default)
 *   'session'    – flashcard study session (new-word or review)
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

  return (
    <Dashboard
      onStartSession={config => {
        setSessionConfig(config)
        setView('session')
      }}
    />
  )
}
