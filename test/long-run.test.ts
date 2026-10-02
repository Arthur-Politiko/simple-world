import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('деревня живёт 2 года: жители живы, экосистема не вымерла', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Деревня', 7)
  const id = s.world.id

  runDays(db, id, 56) // 2 года

  const st = getWorldState(db, id)
  // жители живы
  for (const c of st.characters) assert.ok(c.health > 0, `${c.name} жив`)
  // ульи пережили зимы
  assert.ok(st.hives.length > 0, 'ульи живы')
  // фауна не вымерла
  assert.ok(st.fauna.find((f) => f.kind === 'заяц')!.count > 0, 'заяц не вымер')
  // ресурсы не исчерпаны
  assert.ok(st.locationResources.find((r) => r.resource === 'дрова')!.amount > 0, 'дрова не исчерпаны')
  assert.ok(st.locationResources.find((r) => r.resource === 'рыба')!.amount > 0, 'рыба не исчерпана')
})
