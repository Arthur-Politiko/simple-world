import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import {
  advancePhase,
  consume,
  createWorld,
  gather,
  getWorldState,
  moveCharacter,
  RuleError,
} from '../server/world'

function stockOf(db: ReturnType<typeof openDb>, holderType: string, holderId: string, resource: string): number {
  const row = db
    .prepare('SELECT quantity FROM stock WHERE holder_type = ? AND holder_id = ? AND resource = ?')
    .get(holderType, holderId, resource) as { quantity: number } | undefined
  return row?.quantity ?? 0
}

test('создание мира: сущности и начальное состояние', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 42)
  assert.equal(s.world.day, 1)
  assert.equal(s.phaseName, 'утро')
  assert.equal(s.locations.length, 5)
  assert.equal(s.characters.length, 6)
  assert.equal(s.households.length, 3)
  assert.ok(s.goals.length >= 4)
  assert.ok(s.obligations.length >= 3)
  assert.ok(s.stock.length >= 4)
})

test('время продвигается по фазам и дням', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  assert.equal(advancePhase(db, id).phaseName, 'день')
  assert.equal(advancePhase(db, id).phaseName, 'вечер')
  const night = advancePhase(db, id)
  assert.equal(night.world.day, 1)
  assert.equal(night.phaseName, 'ночь')

  const morning = advancePhase(db, id)
  assert.equal(morning.world.day, 2)
  assert.equal(morning.phaseName, 'утро')
})

test('gather добавляет запас, consume расходует', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const before = stockOf(db, 'character', 'chr-marta', 'зерно')
  gather(db, id, 'chr-marta', 'зерно', 3)
  assert.equal(stockOf(db, 'character', 'chr-marta', 'зерно'), before + 3)
  consume(db, id, 'chr-marta', 'зерно', 2)
  assert.equal(stockOf(db, 'character', 'chr-marta', 'зерно'), before + 1)
})

test('consume не допускает отрицательный запас', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const have = stockOf(db, 'character', 'chr-marta', 'зерно')
  assert.throws(() => consume(db, id, 'chr-marta', 'зерно', have + 100), RuleError)
  assert.equal(stockOf(db, 'character', 'chr-marta', 'зерно'), have)
})

test('gather отклоняет неположительное количество', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.throws(() => gather(db, s.world.id, 'chr-marta', 'зерно', 0), RuleError)
  assert.throws(() => gather(db, s.world.id, 'chr-marta', 'зерно', -1), RuleError)
})

test('move меняет локацию; невозможная локация отклоняется', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const moved = moveCharacter(db, id, 'chr-marta', 'loc-forest')
  assert.equal(moved.characters.find((c) => c.id === 'chr-marta')?.location_id, 'loc-forest')
  assert.throws(() => moveCharacter(db, id, 'chr-marta', 'loc-nope'), RuleError)
})

test('два мира в одной базе не конфликтуют и независимы', () => {
  const db = openDb(':memory:')
  const a = createWorld(db, 'Первый', 1)
  const b = createWorld(db, 'Второй', 2)

  assert.notEqual(a.world.id, b.world.id)
  assert.equal(getWorldState(db, a.world.id).locations.length, 5)
  assert.equal(getWorldState(db, b.world.id).locations.length, 5)

  gather(db, a.world.id, 'chr-marta', 'grain', 3)
  const aMarta = getWorldState(db, a.world.id).stock.find(
    (s) => s.holder_id === 'chr-marta' && s.resource === 'grain',
  )
  const bMarta = getWorldState(db, b.world.id).stock.find(
    (s) => s.holder_id === 'chr-marta' && s.resource === 'grain',
  )
  assert.equal(aMarta?.quantity, 3)
  assert.equal(bMarta, undefined)
})

test('детерминизм: одинаковый seed даёт одинаковую историю', () => {
  const dbA = openDb(':memory:')
  const dbB = openDb(':memory:')
  const a = createWorld(dbA, 'Тест', 123)
  const b = createWorld(dbB, 'Тест', 123)

  const projA = project(dbA, a.world.id)
  const projB = project(dbB, b.world.id)
  assert.deepEqual(projA, projB)
})

function project(db: ReturnType<typeof openDb>, worldId: string) {
  for (let i = 0; i < 6; i++) {
    advancePhase(db, worldId)
  }
  const s = getWorldState(db, worldId)
  return {
    events: s.events.map((e) => ({ day: e.day, phase: e.phase, seq: e.seq, type: e.type, payload: e.payload })),
    stock: s.stock.map((x) => ({ holder_type: x.holder_type, holder_id: x.holder_id, resource: x.resource, quantity: x.quantity })),
  }
}
