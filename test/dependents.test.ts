import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('у дворов есть домочадцы (зомби-NPC без LLM)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.dependents.length > 0)
  assert.ok(s.dependents.some((d) => d.name === 'Гридя'))
})

test('домочадцы стареют раз в год', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const before = s.dependents.find((d) => d.id === 'dep-gridya')!.age

  runDays(db, id, 28)
  const st = getWorldState(db, id)
  const after = st.dependents.find((d) => d.id === 'dep-gridya')!.age
  assert.equal(after, before + 1, 'домочадец стал старше на год')
})
