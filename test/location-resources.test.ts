import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, gather, getWorldState, moveCharacter, runDays } from '../server/world'

test('живая местность: лес и река имеют истощаемые запасы', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.locationResources.some((r) => r.location_id === 'loc-forest' && r.resource === 'дрова'), 'лес даёт дрова')
  assert.ok(s.locationResources.some((r) => r.location_id === 'loc-forest' && r.resource === 'ягоды'), 'лес даёт ягоды')
  assert.ok(s.locationResources.some((r) => r.location_id === 'loc-river' && r.resource === 'рыба'), 'река даёт рыбу')
})

test('сбор истощает запас локации', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  moveCharacter(db, id, 'chr-marta', 'loc-forest')
  const before = s.locationResources.find((r) => r.location_id === 'loc-forest' && r.resource === 'дрова')!.amount

  const st = gather(db, id, 'chr-marta', 'дрова', 5)
  const after = st.locationResources.find((r) => r.location_id === 'loc-forest' && r.resource === 'дрова')!.amount
  assert.equal(after, before - 5, 'дрова убавились на собранное')
})

test('запас локации восстанавливается со временем (не пустеет за год)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  moveCharacter(db, id, 'chr-marta', 'loc-forest')
  const st0 = gather(db, id, 'chr-marta', 'дрова', 30)
  const depleted = st0.locationResources.find((r) => r.location_id === 'loc-forest' && r.resource === 'дрова')!.amount

  runDays(db, id, 7)
  const st1 = getWorldState(db, id)
  const after = st1.locationResources.find((r) => r.location_id === 'loc-forest' && r.resource === 'дрова')!.amount
  assert.ok(after > depleted, 'дрова восстановились')
})
