import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('посев весной → жатва осенью (сам-три)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // посев уже случился в день 1 (весна)
  assert.ok(s.events.some((e) => e.type === 'sow'), 'посев весной')

  runDays(db, id, 14)
  const st = getWorldState(db, id)
  assert.ok(st.events.some((e) => e.type === 'harvest'), 'жатва осенью')

  const martaHarvest = st.events.find(
    (e) => e.type === 'harvest' && (e.payload as { householdId?: string }).householdId === 'hh-marta',
  )
  assert.ok(martaHarvest, 'жатва у Марты')
  // сам-три: посев 10 → урожай не меньше 30 (плюс навоз)
  assert.ok((martaHarvest.payload as { amount: number }).amount >= 30, 'урожай ≥ посев × 3')
})

test('зима — дефицит: огород и луг не плодоносят', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 22)
  const st = getWorldState(db, id)
  const winterGarden = st.events.some((e) => e.type === 'garden_harvest' && e.day >= 22)
  assert.equal(winterGarden, false, 'зимой огород не плодоносит')
})
