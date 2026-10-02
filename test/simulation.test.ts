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

  const end = runDays(db, id, 14)

  assert.equal(end.world.day, 15)
  assert.equal(end.phaseName, 'утро')

  // экономика живёт: посев и жатва случились
  assert.ok(end.events.some((e) => e.type === 'sow'), 'посев случился')
  assert.ok(end.events.some((e) => e.type === 'harvest'), 'жатва случилась')

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

test('урожай ограничен ёмкостью поля (нет бесконечной добычи)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 28)

  const st = getWorldState(db, id)
  const harvest = st.events.filter((e) => e.type === 'harvest').reduce((sum, e) => sum + (e.payload as { amount: number }).amount, 0)
  const fieldCapacity = st.plots.filter((p) => p.kind === 'поле').reduce((sum, p) => sum + p.size, 0)
  // урожай = посев × 3 + навоз; посев ≤ ёмкость/3, навоз конечен → урожай ≤ ~2 × ёмкость
  assert.ok(harvest > 0, 'урожай был')
  assert.ok(harvest <= fieldCapacity * 2, `урожай ограничен полем: ${harvest} ≤ ${fieldCapacity * 2}`)
})

test('обязательства урегулируются к сроку', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  for (let i = 0; i < 7; i++) runDays(db, id, 1)

  const st = getWorldState(db, id)
  const settled = st.obligations.filter((o) => o.status !== 'pending')
  assert.ok(settled.length >= 1, 'обязательства на день 7 (дрова) должны быть урегулированы')
  for (const o of settled) {
    assert.ok(o.status === 'fulfilled' || o.status === 'failed')
  }
  // Томаш (зерновой оброк — день 20) ещё в ожидании
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
