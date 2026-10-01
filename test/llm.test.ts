import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { chat, chatJSON } from '../server/llm'
import { createWorld, getWorldState, moveCharacter, runDays } from '../server/world'
import { seedCharacterCore, reflectOnEvent } from '../server/agent'
import { getLLMUsageSummary } from '../server/metrics'

// Реальные вызовы выполняются только при RUN_LLM_TESTS=1, чтобы не тратить API в обычном прогоне.
const enabled = process.env.RUN_LLM_TESTS === '1'

test('deepseek-flash возвращает текст (реальный API)', { skip: !enabled }, async () => {
  const { content } = await chat(
    'deepseek-flash',
    [{ role: 'user', content: 'Reply with one word: ok' }],
    { maxTokens: 512, temperature: 0 },
  )
  assert.match(content.toLowerCase(), /ok/)
})

test('deepseek-flash возвращает валидный JSON (реальный API)', { skip: !enabled }, async () => {
  const { value } = await chatJSON<{ answer: string; n: number }>(
    'deepseek-flash',
    [{ role: 'user', content: 'Return strict JSON only with shape {"answer":"ok","n":2}' }],
    { maxTokens: 512, temperature: 0 },
  )
  assert.equal(value.answer, 'ok')
  assert.equal(value.n, 2)
})

test('deepseek-v4-pro возвращает валидный JSON при достаточном max_tokens (реальный API)', { skip: !enabled }, async () => {
  const { value } = await chatJSON<{ answer: string; n: number }>(
    'deepseek-v4-pro',
    [{ role: 'user', content: 'Return strict JSON only with shape {"answer":"ok","n":2}' }],
    { maxTokens: 512, temperature: 0 },
  )
  assert.equal(value.answer, 'ok')
  assert.equal(value.n, 2)
})

test('вертикальный срез: два NPC по-разному рефлексируют ложный слух (реальный API)', { skip: !enabled }, async () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // два разных ядра
  seedCharacterCore(db, id, 'chr-marta', 'Осторожная земледелица, боится неурожая и гнева сеньора, склонна верить слухам о поблажках.')
  seedCharacterCore(db, id, 'chr-tomek', 'Скептичный трактирщик, не доверяет сплетням, ценит достоверные сведения.')

  // Марта идёт в трактир, чтобы услышать тот же слух
  moveCharacter(db, id, 'chr-marta', 'loc-inn')
  runDays(db, id, 8) // день 9 — ложный слух

  const st = getWorldState(db, id)
  const newsEvent = st.events.find(
    (e) => e.type === 'news' && typeof e.payload === 'object' && (e.payload as { isTrue?: boolean }).isTrue === false,
  )
  assert.ok(newsEvent, 'событие слуха должно существовать')

  const marta = await reflectOnEvent(db, id, 'chr-marta', newsEvent.id)
  const tomek = await reflectOnEvent(db, id, 'chr-tomek', newsEvent.id)

  // обе рефлексии применились (seed дал ревизию 1, рефлексия — 2) и что-то сохранили
  assert.equal(marta.revision, 2)
  assert.equal(tomek.revision, 2)
  assert.ok(marta.memory.beliefs.length > 0 || marta.memory.entries.length > 0)
  assert.ok(tomek.memory.beliefs.length > 0 || tomek.memory.entries.length > 0)
  // интерпретации различаются
  assert.notEqual(marta.reason, tomek.reason)

  // метрики записаны
  const usage = getLLMUsageSummary(db)
  assert.ok(usage.totals.calls >= 2)
  assert.ok(usage.totals.completionTokens > 0)
})
