import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('каждый двор имеет огород (надел)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.equal(s.plots.filter((p) => p.kind === 'огород').length, s.households.length)
})

test('огород кормит не-земледельцев — ткачиха не голодает', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 10)
  const st = getWorldState(db, id)

  assert.ok(st.events.some((e) => e.type === 'garden_harvest'), 'огород даёт урожай')
  const kasyaHunger = st.events.some(
    (e) => e.type === 'hunger' && (e.payload as { characterId?: string }).characterId === 'chr-kasya',
  )
  assert.equal(kasyaHunger, false, 'ткачиха не должна голодать')
})
