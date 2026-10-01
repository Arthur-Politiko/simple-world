import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('у дворов есть ульи (бортничество)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.hives.length > 0)
  assert.ok(s.hives.some((h) => h.household_id === 'hh-marta'))
})

test('улей даёт мёд в тёплый сезон', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 7)
  const st = getWorldState(db, id)
  assert.ok(st.events.some((e) => e.type === 'hive_honey'), 'улей даёт мёд')
  assert.ok(st.stock.some((x) => x.resource === 'мёд'), 'мёд в запасах')
})
