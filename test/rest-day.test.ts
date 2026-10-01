import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('в выходной (каждый 7-й день) не работают', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 7)
  const st = getWorldState(db, id)

  assert.ok(st.events.some((e) => e.type === 'rest_day'), 'выходной зафиксирован')
  const workOnRest = st.events.some((e) => e.type === 'work' && e.day === 7)
  assert.equal(workOnRest, false, 'в выходной не работают')
  assert.ok(st.events.some((e) => e.type === 'work' && e.day === 6), 'в будни работают')
})

test('выходной восстанавливает здоровье', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  db.prepare("UPDATE characters SET health = 30 WHERE world_id = ? AND id = 'chr-marta'").run(id)

  runDays(db, id, 7)
  const st = getWorldState(db, id)
  const marta = st.characters.find((c) => c.id === 'chr-marta')!
  assert.ok(marta.health > 30, 'здоровье восстановилось за неделю (сон + выходной)')
})
