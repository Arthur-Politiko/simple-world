import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

const WEATHERS = ['солнечно', 'дождливо', 'засуха', 'половодье', 'мороз', 'метель']

test('погода детерминирована от seed', () => {
  const a = createWorld(openDb(':memory:'), 'Тест', 42)
  const b = createWorld(openDb(':memory:'), 'Тест', 42)
  assert.equal(a.weather, b.weather, 'одинаковый seed → одинаковая погода')
})

test('погода — известное значение', () => {
  const s = createWorld(openDb(':memory:'), 'Тест', 1)
  assert.ok(WEATHERS.includes(s.weather), `неизвестная погода: ${s.weather}`)
})

test('зимой погода — мороз или метель', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  runDays(db, s.world.id, 21) // день 22 — зима
  const st = getWorldState(db, s.world.id)
  assert.ok(['мороз', 'метель'].includes(st.weather), `зимой: ${st.weather}`)
})
