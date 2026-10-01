import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, promoteDependent, runDays } from '../server/world'

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

test('труд домочадцев расширяет поле', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  // у Марты труд домочадцев = 0.3+1+0.6 = 1.9 → +23 к базе 30
  const martaField = s.plots.find((p) => p.household_id === 'hh-marta' && p.kind === 'поле')
  assert.ok((martaField?.size ?? 0) > 30, 'поле расширено трудом домочадцев')
})

test('домочадцы едят (рты) — потребляют еду из двора', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 7)
  const st = getWorldState(db, id)
  // домочадцы ели; проверим, что в деревне в целом не случилось голода у домочадцев
  assert.ok(!st.events.some((e) => e.type === 'dependent_hunger'), 'домочадцы не голодали за неделю')
})

test('домочадца можно повысить в персонажа (зомби → LLM)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const depsBefore = s.dependents.length
  const charsBefore = s.characters.length

  const st = promoteDependent(db, id, 'dep-gridya')
  assert.equal(st.dependents.length, depsBefore - 1, 'домочадец удалён')
  assert.equal(st.characters.length, charsBefore + 1, 'персонаж создан')
  assert.ok(st.characters.some((c) => c.id === 'chr-gridya'), 'Гридя стал персонажем')
  assert.ok(st.events.some((e) => e.type === 'dependent_promoted'), 'событие повышения записано')
})
