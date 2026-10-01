import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays, RuleError } from '../server/world'

function sumResource(state: { stock: { resource: string; quantity: number }[] }, resource: string): number {
  return state.stock.filter((x) => x.resource === resource).reduce((a, b) => a + b.quantity, 0)
}

test('деревня живёт две недели без игрока', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const grainBefore = sumResource(s, 'зерно')

  const end = runDays(db, id, 14)

  assert.equal(end.world.day, 15)
  assert.equal(end.phaseName, 'утро')

  // запасы меняются по понятным причинам (поле/еда)
  const grainAfter = sumResource(end, 'зерно')
  assert.notEqual(grainAfter, grainBefore)

  // журнал объясняет жизнь: есть работа, еда, сон
  const types = new Set(end.events.map((e) => e.type))
  assert.ok(types.has('work'))
  assert.ok(types.has('eat'))
  assert.ok(types.has('sleep'))

  // инвариант: нет отрицательных запасов
  for (const x of end.stock) {
    assert.ok(x.quantity >= 0, `отрицательный запас: ${x.holder_id}/${x.resource}=${x.quantity}`)
  }
})

test('добыча ограничена трудом: за день не больше лимита', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const before = sumResource(getWorldState(db, id), 'зерно')

  runDays(db, id, 1)

  const after = sumResource(getWorldState(db, id), 'зерно')
  // произведено = изменение + съедено за день (7 персонажей × 1)
  const produced = after - before + 7
  // максимум: все пашут (земледелец 2, остальные 1, + вол) × 2 смены ≈ 24
  assert.ok(produced >= 0 && produced <= 24, `произведено за день вне лимита: ${produced}`)
})

test('обязательства урегулируются к сроку', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  for (let i = 0; i < 7; i++) runDays(db, id, 1)

  const st = getWorldState(db, id)
  const settled = st.obligations.filter((o) => o.status !== 'pending')
  assert.ok(settled.length >= 2, 'обязательства на день 7 должны быть урегулированы')
  for (const o of settled) {
    assert.ok(o.status === 'fulfilled' || o.status === 'failed')
  }
  // Томаш (срок — день 10) ещё в ожидании
  const tomas = st.obligations.find((o) => o.character_id === 'chr-tomas')
  assert.equal(tomas?.status, 'pending')
})

test('runDays отклоняет неположительное число дней', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.throws(() => runDays(db, s.world.id, 0), RuleError)
  assert.throws(() => runDays(db, s.world.id, -1), RuleError)
  assert.throws(() => runDays(db, s.world.id, 1.5), RuleError)
})
