import { useEffect, useState } from 'react'

interface Health {
  status: string
  name: string
  time: string
}

export default function App() {
  const [state, setState] = useState<'loading' | 'ok' | 'error'>('loading')
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json() as Promise<Health>
      })
      .then((h) => {
        setHealth(h)
        setState('ok')
      })
      .catch((e) => {
        setError(String(e))
        setState('error')
      })
  }, [])

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '2rem' }}>
      <h1>Живая деревня</h1>
      <p>
        Соединение с сервером:{' '}
        <strong>
          {state === 'loading' && 'проверка…'}
          {state === 'ok' && 'установлено'}
          {state === 'error' && 'нет соединения'}
        </strong>
      </p>
      {health && <pre>{JSON.stringify(health, null, 2)}</pre>}
      {error && <p style={{ color: 'crimson' }}>Ошибка: {error}</p>}
    </main>
  )
}
