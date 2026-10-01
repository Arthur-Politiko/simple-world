import { useCallback, useEffect, useState } from 'react'

interface Character {
  id: string
  name: string
  role: string
  location_id: string
  energy: number
  household_id: string
}

interface StockItem {
  holder_type: string
  holder_id: string
  resource: string
  quantity: number
}

interface Obligation {
  id: number
  character_id: string
  recipient: string
  resource: string
  amount: number
  due_day: number
  status: string
}

interface Goal {
  id: number
  character_id: string
  description: string
}

interface EventRow {
  day: number
  phase: number
  type: string
  payload: Record<string, unknown>
}

interface WorldState {
  world: { id: string; name: string; seed: number; day: number; phase: number }
  phaseName: string
  characters: Character[]
  locations: { id: string; name: string }[]
  households: { id: string; name: string }[]
  stock: StockItem[]
  goals: Goal[]
  obligations: Obligation[]
  events: EventRow[]
}

const ROLE_TITLES: Record<string, string> = {
  zemledelec: 'земледелец',
  lesorub: 'лесоруб',
  rybak: 'рыбак',
  tkachiha: 'ткачиха',
}

const PHASES = ['утро', 'день', 'вечер', 'ночь']

const STATUS_TITLES: Record<string, string> = {
  pending: 'в ожидании',
  fulfilled: 'исполнено',
  failed: 'провалено',
}

export default function App() {
  const [world, setWorld] = useState<WorldState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const api = useCallback(async (path: string, options?: RequestInit) => {
    const r = await fetch(path, options)
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `HTTP ${r.status}`)
    }
    return r.json() as Promise<WorldState>
  }, [])

  const createWorld = useCallback(async () => {
    setBusy(true)
    setError(null)
    try {
      const w = await api('/api/worlds', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Деревня', seed: Math.floor(Math.random() * 1000) }),
      })
      setWorld(w)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [api])

  const advance = useCallback(
    async (kind: 'phase' | 'day') => {
      if (!world) return
      setBusy(true)
      setError(null)
      try {
        const path = kind === 'phase' ? `/api/worlds/${world.world.id}/advance` : `/api/worlds/${world.world.id}/run`
        const body = kind === 'phase' ? '{}' : JSON.stringify({ days: 1 })
        setWorld(await api(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }))
      } catch (e) {
        setError(String(e))
      } finally {
        setBusy(false)
      }
    },
    [api, world],
  )

  const nameOf = (id: string) => world?.characters.find((c) => c.id === id)?.name ?? id
  const locationOf = (id: string) => world?.locations.find((l) => l.id === id)?.name ?? id

  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: '1.5rem', maxWidth: 860, margin: '0 auto' }}>
      <h1>Живая деревня</h1>

      {!world && (
        <div>
          <p>Мир ещё не создан.</p>
          <button onClick={createWorld} disabled={busy}>
            {busy ? 'Создание…' : 'Создать мир'}
          </button>
        </div>
      )}

      {world && (
        <>
          <header style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <strong>День {world.world.day}</strong> · {world.phaseName} · seed {world.world.seed}
            </div>
            <button onClick={() => advance('phase')} disabled={busy}>
              Следующая фаза
            </button>
            <button onClick={() => advance('day')} disabled={busy}>
              Продвинуть день
            </button>
          </header>

          <h2>Жители</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Имя</th>
                <th style={th}>Роль</th>
                <th style={th}>Локация</th>
                <th style={th}>Сил</th>
              </tr>
            </thead>
            <tbody>
              {world.characters.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.name}</td>
                  <td style={td}>{ROLE_TITLES[c.role] ?? c.role}</td>
                  <td style={td}>{locationOf(c.location_id)}</td>
                  <td style={td}>{c.energy}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Запасы</h2>
          <ul>
            {world.stock.map((s, i) => (
              <li key={i}>
                <strong>{s.resource}</strong> × {s.quantity} — {s.holder_type === 'character' ? nameOf(s.holder_id) : locationOf(s.holder_id)}
              </li>
            ))}
          </ul>

          <h2>Обязательства</h2>
          <ul>
            {world.obligations.map((o) => (
              <li key={o.id}>
                {nameOf(o.character_id)} → {o.recipient}: {o.amount} «{o.resource}» до дня {o.due_day} —{' '}
                <strong>{STATUS_TITLES[o.status] ?? o.status}</strong>
              </li>
            ))}
          </ul>

          <h2>Цели</h2>
          <ul>
            {world.goals.map((g) => (
              <li key={g.id}>
                {nameOf(g.character_id)}: {g.description}
              </li>
            ))}
          </ul>

          <h2>Журнал (последние события)</h2>
          <ul style={{ maxHeight: 320, overflow: 'auto', border: '1px solid #ddd', padding: '0.5rem 0.5rem 0.5rem 1.5rem' }}>
            {world.events
              .slice(-40)
              .reverse()
              .map((e, i) => (
                <li key={world.events.length - i} style={{ whiteSpace: 'nowrap' }}>
                  <span style={{ color: '#888' }}>
                    д{e.day} {PHASES[e.phase]} ·{' '}
                  </span>
                  {e.type}
                  {typeof e.payload?.characterName === 'string' ? ` — ${e.payload.characterName}` : ''}
                  {typeof e.payload?.amount === 'number' && typeof e.payload?.resource === 'string'
                    ? `: ${e.payload.amount} «${e.payload.resource}»`
                    : ''}
                </li>
              ))}
          </ul>
        </>
      )}

      {error && <p style={{ color: 'crimson' }}>Ошибка: {error}</p>}
    </main>
  )
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ccc', padding: '0.25rem 0.5rem' }
const td: React.CSSProperties = { padding: '0.2rem 0.5rem' }
