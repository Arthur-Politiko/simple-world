import { useCallback, useEffect, useState } from 'react'

interface Character {
  id: string
  name: string
  role: string
  location_id: string
  energy: number
  health: number
  household_id: string
}

interface StockItem {
  holder_type: string
  holder_id: string
  resource: string
  quantity: number
}

interface Plot {
  household_id: string
  kind: string
  size: number
  harvest: number | null
  sown: number | null
  manure: number | null
}

interface Livestock {
  id: string
  household_id: string
  kind: string
  name: string | null
  health: number
  age: number
}

interface Hive {
  id: string
  household_id: string
  strength: number
}

interface Dependent {
  id: string
  household_id: string
  name: string
  gender: string
  age: number
  relation: string
  labor: number
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

interface CharacterMemory {
  worldId: string
  characterId: string
  core: string
  currentState: string
  revision: number
  entries: { id: number; kind: 'recent' | 'significant'; eventId: number; content: string; importance: number }[]
  relationships: { targetId: string; note: string; trust: number | null }[]
  beliefs: { statement: string; status: string; confidence: number }[]
}

interface WorldState {
  world: { id: string; name: string; seed: number; day: number; phase: number }
  phaseName: string
  season?: string
  weather?: string
  characters: Character[]
  locations: { id: string; name: string }[]
  households: { id: string; name: string }[]
  plots?: Plot[]
  livestock?: Livestock[]
  hives?: Hive[]
  dependents?: Dependent[]
  locationResources?: { location_id: string; resource: string; amount: number; capacity: number }[]
  flora?: { location_id: string; kind: string; density: number }[]
  fauna?: { location_id: string; kind: string; count: number }[]
  stock: StockItem[]
  goals: Goal[]
  obligations: Obligation[]
  events: EventRow[]
  facts: { id: number; day: number; type: string; payload: Record<string, unknown> }[]
  knowledge: { id: number; source: string; summary: string; is_true: boolean; day: number }[]
}

interface IntentionResult {
  decisionId: number
  outcome: 'executed' | 'rejected'
  error?: string
  intention: { action: string; targetId?: string; resource?: string; amount?: number; reason: string }
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
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null)
  const [memory, setMemory] = useState<CharacterMemory | null>(null)
  const [memoryError, setMemoryError] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [talkReply, setTalkReply] = useState<string | null>(null)
  const [intention, setIntention] = useState<IntentionResult | null>(null)
  const [interactionBusy, setInteractionBusy] = useState(false)
  const [interactionError, setInteractionError] = useState<string | null>(null)
  const [mode, setMode] = useState<'game' | 'debug'>('game')
  const [llmMetrics, setLlmMetrics] = useState<{ totals: { calls: number; completionTokens: number; cost: number | null } } | null>(null)

  const api = useCallback(async (path: string, options?: RequestInit) => {
    const r = await fetch(path, options)
    if (!r.ok) {
      const body = (await r.json().catch(() => ({}))) as { error?: string }
      throw new Error(body.error ?? `HTTP ${r.status}`)
    }
    return r.json() as Promise<WorldState>
  }, [])

  useEffect(() => {
    fetch('/api/worlds')
      .then((r) => r.json())
      .then(async (list: Array<{ id: string }>) => {
        if (list.length > 0) {
          const w = await api(`/api/worlds/${list[list.length - 1].id}`)
          setWorld(w)
          // синхронизировать флаг «Авто» с сервером (после F5 мир мог уже тикать)
          try {
            const auto = (await (await fetch(`/api/worlds/${w.world.id}/auto`)).json()) as { running?: boolean }
            setAutoOn(auto.running === true)
          } catch {
            /* ignore */
          }
        }
      })
      .catch(() => {})
    fetch('/api/metrics/llm')
      .then((r) => r.json())
      .then((m) => setLlmMetrics(m as { totals: { calls: number; completionTokens: number; cost: number | null } }))
      .catch(() => {})
  }, [api])

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
  const householdNameOf = (id: string) => world?.households.find((h) => h.id === id)?.name ?? id

  const loadMemory = useCallback(async (characterId: string) => {
    if (!world) return
    setSelectedCharacterId(characterId)
    setMemory(null)
    setMemoryError(null)
    setTalkReply(null)
    setIntention(null)
    setMessage('')
    try {
      const response = await fetch(`/api/worlds/${world.world.id}/characters/${characterId}/memory`)
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setMemory((await response.json()) as CharacterMemory)
    } catch (e) {
      setMemoryError(String(e))
    }
  }, [world])

  const askIntention = useCallback(async () => {
    if (!world || !selectedCharacterId) return
    setInteractionBusy(true)
    setInteractionError(null)
    setIntention(null)
    try {
      const response = await fetch(`/api/worlds/${world.world.id}/intention`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: selectedCharacterId }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setIntention((await response.json()) as IntentionResult)
    } catch (e) {
      setInteractionError(String(e))
    } finally {
      setInteractionBusy(false)
    }
  }, [world, selectedCharacterId])

  const sendTalk = useCallback(async () => {
    if (!world || !selectedCharacterId || !message.trim()) return
    setInteractionBusy(true)
    setInteractionError(null)
    const msg = message
    setMessage('')
    try {
      const response = await fetch(`/api/worlds/${world.world.id}/characters/${selectedCharacterId}/talk`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setTalkReply(((await response.json()) as { reply: string }).reply)
    } catch (e) {
      setInteractionError(String(e))
    } finally {
      setInteractionBusy(false)
    }
  }, [world, selectedCharacterId, message])

  const runDays = useCallback(
    async (days: number) => {
      if (!world) return
      setBusy(true)
      setError(null)
      try {
        setWorld(await api(`/api/worlds/${world.world.id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) }))
      } catch (e) {
        setError(String(e))
      } finally {
        setBusy(false)
      }
    },
    [api, world],
  )

  const giftGrain = useCallback(async () => {
    if (!world || !selectedCharacterId) return
    setInteractionBusy(true)
    setInteractionError(null)
    try {
      const response = await fetch(`/api/worlds/${world.world.id}/gift`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: selectedCharacterId, resource: 'зерно', amount: 1 }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setWorld((await response.json()) as WorldState)
    } catch (e) {
      setInteractionError(String(e))
    } finally {
      setInteractionBusy(false)
    }
  }, [world, selectedCharacterId])

  const promoteDependent = useCallback(async (dependentId: string) => {
    if (!world) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/worlds/${world.world.id}/dependents/${dependentId}/promote`, { method: 'POST' })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setWorld((await response.json()) as WorldState)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [world])

  const runAutonomous = useCallback(async () => {
    if (!world) return
    setBusy(true)
    setError(null)
    try {
      const response = await fetch(`/api/worlds/${world.world.id}/run-autonomous`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ days: 1 }),
      })
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string }
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      setWorld(((await response.json()) as { state: WorldState }).state)
    } catch (e) {
      setError(String(e))
    } finally {
      setBusy(false)
    }
  }, [world])

  const [autoOn, setAutoOn] = useState(false)

  const toggleAuto = useCallback(async () => {
    if (!world) return
    setError(null)
    try {
      if (autoOn) {
        await fetch(`/api/worlds/${world.world.id}/auto-stop`, { method: 'POST' })
        setAutoOn(false)
      } else {
        const r = await fetch(`/api/worlds/${world.world.id}/auto`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ intervalMs: 1000 }),
        })
        if (!r.ok) {
          const body = (await r.json().catch(() => ({}))) as { error?: string }
          throw new Error(body.error ?? `HTTP ${r.status}`)
        }
        setAutoOn(true)
      }
    } catch (e) {
      setError(String(e))
    }
  }, [world, autoOn])

  const worldId = world?.world.id
  // пока сервер двигает мир — опрашиваем его состояние
  useEffect(() => {
    if (!autoOn || !worldId) return
    const t = setInterval(() => {
      fetch(`/api/worlds/${worldId}`)
        .then((r) => r.json())
        .then((w) => setWorld(w as WorldState))
        .catch(() => {})
    }, 1000)
    return () => clearInterval(t)
  }, [autoOn, worldId])

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
              <strong>День {world.world.day}</strong> · {world.season ?? '—'} · {world.weather ?? '—'} · {world.phaseName} · seed {world.world.seed}
            </div>
            <button onClick={() => advance('phase')} disabled={busy}>Следующая фаза</button>
            <button onClick={() => advance('day')} disabled={busy}>Продвинуть день</button>
            <button onClick={() => runDays(7)} disabled={busy}>Продвинуть 7 дней</button>
            <button onClick={() => runDays(28)} disabled={busy}>Год (28 дн.)</button>
            <button onClick={toggleAuto} disabled={busy}>{autoOn ? '⏸ Стоп' : '▶ Авто'}</button>
            <button onClick={runAutonomous} disabled={busy}>Автономный день (LLM)</button>
            <button onClick={() => setMode(mode === 'game' ? 'debug' : 'game')}>Режим: {mode === 'game' ? 'игра' : 'отладка'}</button>
            <button onClick={createWorld} disabled={busy}>Новый мир</button>
          </header>

          <h2>Жители</h2>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead>
              <tr>
                <th style={th}>Имя</th>
                <th style={th}>Роль</th>
                <th style={th}>Локация</th>
                <th style={th}>Сил</th>
                <th style={th}>Здор.</th>
                {mode === 'debug' && <th style={th}>Память</th>}
              </tr>
            </thead>
            <tbody>
              {world.characters.map((c) => (
                <tr key={c.id}>
                  <td style={td}>{c.name}</td>
                  <td style={td}>{ROLE_TITLES[c.role] ?? c.role}</td>
                  <td style={td}>{locationOf(c.location_id)}</td>
                  <td style={td}>{c.energy}</td>
                  <td style={td}>{c.health}</td>
                  {mode === 'debug' && (
                    <td style={td}>
                      <button onClick={() => loadMemory(c.id)} disabled={busy}>
                        {selectedCharacterId === c.id && memory ? 'Открыто' : 'Wiki'}
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>

          <h2>Скот (особи)</h2>
          {(world.livestock ?? []).length === 0 ? (
            <p>Скота нет.</p>
          ) : (
            <table style={{ borderCollapse: 'collapse', width: '100%' }}>
              <thead>
                <tr>
                  <th style={th}>Особь</th>
                  <th style={th}>Вид</th>
                  <th style={th}>Двор</th>
                  <th style={th}>Здоровье</th>
                  <th style={th}>Возраст</th>
                </tr>
              </thead>
              <tbody>
                {(world.livestock ?? []).map((l) => (
                  <tr key={l.id}>
                    <td style={td}>{l.name ?? l.id}</td>
                    <td style={td}>{l.kind}</td>
                    <td style={td}>{householdNameOf(l.household_id)}</td>
                    <td style={td}>{l.health}</td>
                    <td style={td}>{l.age}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h2>Ульи</h2>
          <ul>
            {(world.hives ?? []).length === 0 ? (
              <li>Ульев нет.</li>
            ) : (
              (world.hives ?? []).map((h) => (
                <li key={h.id}>
                  {h.id} — {householdNameOf(h.household_id)}, сила {h.strength}
                </li>
              ))
            )}
          </ul>

          <h2>Местность (ресурсы)</h2>
          <ul>
            {(world.locationResources ?? []).map((r) => {
              const loc = world.locations.find((l) => l.id === r.location_id)
              return (
                <li key={`${r.location_id}-${r.resource}`}>
                  {loc?.name ?? r.location_id}: {r.resource} {r.amount}/{r.capacity}
                </li>
              )
            })}
          </ul>
          <p>
            Флора (плотность):{' '}
            {(world.flora ?? []).map((f) => `${f.kind} ${Math.round(f.density * 100)}%`).join(' · ') || '—'}
          </p>
          <p>
            Фауна:{' '}
            {(world.fauna ?? []).map((f) => `${f.kind} ${Math.round(f.count)}`).join(' · ') || '—'}
          </p>

          <h2>Семья (домочадцы)</h2>
          <ul>
            {world.households.map((hh) => {
              const deps = (world.dependents ?? []).filter((d) => d.household_id === hh.id)
              return (
                <li key={hh.id}>
                  <strong>{hh.name}</strong>
                  {deps.length === 0 ? ' —' : (
                    <ul>
                      {deps.map((d) => (
                        <li key={d.id}>
                          {d.name} ({d.relation}, {d.age})
                          <button onClick={() => void promoteDependent(d.id)} disabled={busy} style={{ marginLeft: '0.5rem' }}>
                            ↗ в персонажа
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              )
            })}
          </ul>

          <h2>Наделы</h2>
          <ul>
            {world.households.map((hh) => {
              const plots = (world.plots ?? []).filter((p) => p.household_id === hh.id)
              return (
                <li key={hh.id}>
                  <strong>{hh.name}</strong>:{' '}
                  {plots
                    .map((p) => {
                      const parts = [`${p.kind} ${p.size}`]
                      if (p.harvest !== null) parts.push(`урожай ${p.harvest}`)
                      if (p.sown !== null) parts.push(`посев ${p.sown}`)
                      if (p.manure !== null) parts.push(`навоз ${p.manure}`)
                      return parts.join(' / ')
                    })
                    .join('; ') || 'наделов нет'}
                </li>
              )
            })}
          </ul>

          {selectedCharacterId && (
            <section style={{ marginTop: '1.5rem', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
              <header style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center' }}>
                <h2 style={{ margin: 0 }}>Wiki: {nameOf(selectedCharacterId)}</h2>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button onClick={() => void loadMemory(selectedCharacterId)} disabled={busy}>Обновить</button>
                  <a href={`/api/worlds/${world.world.id}/characters/${selectedCharacterId}/memory.md`} target="_blank" rel="noreferrer">Скачать Markdown</a>
                  <button onClick={() => { setSelectedCharacterId(null); setMemory(null); setMemoryError(null) }}>Закрыть</button>
                </div>
              </header>
              {memoryError && <p style={{ color: 'crimson' }}>{memoryError}</p>}
              {!memory && !memoryError && <p>Загружаю память…</p>}
              {memory && (
                <>
                  <p>Ревизия {memory.revision}</p>
                  <h3>Ядро</h3>
                  <p>{memory.core || 'Пока не сформировано.'}</p>
                  <h3>Текущее состояние</h3>
                  <p>{memory.currentState || 'Не задано.'}</p>
                  <h3>Недавний опыт</h3>
                  {memory.entries.filter((entry) => entry.kind === 'recent').length === 0 ? <p>Записей пока нет.</p> : (
                    <ul>{memory.entries.filter((entry) => entry.kind === 'recent').map((entry) => <li key={entry.id}>[событие {entry.eventId}] {entry.content}</li>)}</ul>
                  )}
                  <h3>Значимые воспоминания</h3>
                  {memory.entries.filter((entry) => entry.kind === 'significant').length === 0 ? <p>Записей пока нет.</p> : (
                    <ul>{memory.entries.filter((entry) => entry.kind === 'significant').map((entry) => <li key={entry.id}>[событие {entry.eventId}; важность {entry.importance}] {entry.content}</li>)}</ul>
                  )}
                  <h3>Отношения</h3>
                  {memory.relationships.length === 0 ? <p>Отношений пока нет.</p> : (
                    <ul>{memory.relationships.map((relationship) => <li key={relationship.targetId}>{relationship.targetId}{relationship.trust === null ? '' : ` (доверие ${relationship.trust})`}: {relationship.note}</li>)}</ul>
                  )}
                  <h3>Убеждения</h3>
                  {memory.beliefs.length === 0 ? <p>Убеждений пока нет.</p> : (
                    <ul>{memory.beliefs.map((belief, index) => <li key={`${belief.statement}-${index}`}>{belief.status}, уверенность {belief.confidence}%: {belief.statement}</li>)}</ul>
                  )}
                </>
              )}
            </section>
          )}

          {selectedCharacterId && (
            <section style={{ marginTop: '1.5rem', border: '1px solid #ddd', borderRadius: 8, padding: '1rem' }}>
              <h2 style={{ marginTop: 0 }}>Взаимодействие: {nameOf(selectedCharacterId)}</h2>
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
                <button onClick={() => void askIntention()} disabled={interactionBusy}>Спросить намерение</button>
                <button onClick={() => void giftGrain()} disabled={interactionBusy}>Подарить зерно (+1)</button>
                {intention && (
                  <span>
                    {intention.outcome === 'executed' ? '✅' : '⛔'} {intention.intention.action}
                    {intention.intention.targetId ? ` → ${intention.intention.targetId}` : ''}
                    {intention.intention.resource ? ` «${intention.intention.resource}»` : ''}
                    {intention.intention.amount ? ` ×${intention.intention.amount}` : ''} — {intention.intention.reason}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <input
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void sendTalk() }}
                  placeholder="Скажите что-нибудь…"
                  style={{ flex: 1, padding: '0.4rem' }}
                />
                <button onClick={() => void sendTalk()} disabled={interactionBusy || !message.trim()}>Отправить</button>
              </div>
              {talkReply && (
                <p style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  <strong>{nameOf(selectedCharacterId)}:</strong> {talkReply}
                </p>
              )}
              {interactionError && <p style={{ color: 'crimson', marginBottom: 0 }}>{interactionError}</p>}
            </section>
          )}

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

          {mode === 'debug' && (
            <>
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
              <h2>Знания и факты</h2>
              <h3>Факты</h3>
              <ul>{world.facts.map((f) => <li key={f.id}>д{f.day} {f.type}</li>)}</ul>
              <h3>Знания NPC</h3>
              <ul>{world.knowledge.map((k) => <li key={k.id}>[{k.source}] {k.summary} ({k.is_true ? 'факт' : 'слух'})</li>)}</ul>
              <p>
                LLM: {llmMetrics ? `${llmMetrics.totals.calls} вызовов · ${llmMetrics.totals.completionTokens} токенов · стоимость ${llmMetrics.totals.cost ?? 'не задана'}` : '…'}
              </p>
            </>
          )}
        </>
      )}

      {error && <p style={{ color: 'crimson' }}>Ошибка: {error}</p>}
    </main>
  )
}

const th: React.CSSProperties = { textAlign: 'left', borderBottom: '1px solid #ccc', padding: '0.25rem 0.5rem' }
const td: React.CSSProperties = { padding: '0.2rem 0.5rem' }
