import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld } from '../server/world'
import { getAuto, startAuto, stopAuto } from '../server/scheduler'

test('планировщик авто-продвижения: старт/стоп', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  assert.equal(getAuto(id).running, false)
  startAuto(db, id, 60000)
  assert.equal(getAuto(id).running, true)
  stopAuto(id)
  assert.equal(getAuto(id).running, false)
})
