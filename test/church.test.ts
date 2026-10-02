import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('церковь есть, десятина назначена', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.locations.some((l) => l.id === 'loc-church'), 'церковь есть')
  assert.ok(s.obligations.some((o) => o.recipient === 'церковь'), 'десятина назначена')
})

test('в выходной сход в церкви укрепляет связи общины', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 7) // до дня 7 (выходной)
  const st = getWorldState(db, id)
  assert.ok(st.events.some((e) => e.type === 'church'), 'сход был')

  const rel = db
    .prepare("SELECT trust FROM memory_relationships WHERE world_id = ? AND note = 'община' AND trust > 0")
    .get(id) as { trust: number } | undefined
  assert.ok(rel, 'доверие общины выросло')
})
