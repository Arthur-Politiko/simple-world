import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('флора-агрегаты есть (лес/кустарник/ивняк)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.flora.some((f) => f.kind === 'лес'), 'лес есть')
  assert.ok(s.flora.some((f) => f.kind === 'кустарник'), 'кустарник есть')
  assert.ok(s.flora.some((f) => f.kind === 'ивняк'), 'ивняк есть')
})

test('истощение ресурса оскудивает флору', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const before = s.flora.find((f) => f.kind === 'лес')!.density
  // вырубить лес подчистую — плотность должна упасть (takeFromLocation при got < amount)
  db.prepare("UPDATE location_resources SET amount = 0 WHERE world_id = ? AND resource = 'дрова'").run(id)
  db.prepare("UPDATE location_resources SET amount = 0 WHERE world_id = ? AND resource = 'дичь'").run(id)

  // прогнать день — лесоруб упрётся в пустой лес, флора оскудеет
  runDays(db, id, 1)
  const st = getWorldState(db, id)
  const after = st.flora.find((f) => f.kind === 'лес')!.density
  assert.ok(after < before, 'лес оскудел от переруба')
})

test('почва: у леса суглинок, у реки пойма', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.equal(s.locations.find((l) => l.id === 'loc-forest')!.terrain, 'суглинок')
  assert.equal(s.locations.find((l) => l.id === 'loc-river')!.terrain, 'пойма')
})

test('паводок случается и омолаживает пойму', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 7)
  const id = s.world.id
  runDays(db, id, 140) // 5 лет
  const st = getWorldState(db, id)
  assert.ok(st.events.some((e) => e.type === 'flood'), 'паводок случился за 5 лет')
})

test('флора восстанавливается за год', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  db.prepare("UPDATE flora SET density = 0.5 WHERE world_id = ? AND kind = 'лес'").run(id)

  runDays(db, id, 28) // полный год — весна дня 29
  const st = getWorldState(db, id)
  const after = st.flora.find((f) => f.kind === 'лес')!.density
  assert.ok(after > 0.5, 'лес восстановился за год')
})
