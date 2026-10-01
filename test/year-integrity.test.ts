import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('деревня проживает полный год целостно', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 28)
  const st = getWorldState(db, id)

  // сезоны случились: посев и жатва
  assert.ok(st.events.some((e) => e.type === 'sow'), 'посев был')
  assert.ok(st.events.some((e) => e.type === 'harvest'), 'жатва была')

  // нет отрицательных запасов
  for (const x of st.stock) {
    assert.ok(x.quantity >= 0, `отрицательный запас: ${x.holder_id}/${x.resource}=${x.quantity}`)
  }

  // все жители живы
  assert.equal(st.characters.length, 7, 'все жители живы')

  // скот не вымер полностью
  assert.ok(st.livestock.length > 0, 'скот не вымер')

  // обязательства (день 7/10/20) урегулированы
  for (const o of st.obligations) {
    if (o.due_day <= 28) {
      assert.ok(o.status === 'fulfilled' || o.status === 'failed', `обязательство ${o.character_id} д${o.due_day} не урегулировано`)
    }
  }
})

test('год повторяется: два урожая за два года', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 56)
  const st = getWorldState(db, id)

  // по 4 двора × 2 года = 8 жать
  const harvests = st.events.filter((e) => e.type === 'harvest')
  assert.ok(harvests.length >= 8, `два урожая (по 4 двора) — получили ${harvests.length}`)
})
