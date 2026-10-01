import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, gift, listWorlds, runDays } from '../server/world'

test('listWorlds возвращает созданные миры', () => {
  const db = openDb(':memory:')
  createWorld(db, 'Первый', 1)
  createWorld(db, 'Второй', 2)
  const worlds = listWorlds(db)
  assert.equal(worlds.length, 2)
  assert.equal(worlds[0].name, 'Первый')
})

test('gift: игрок передаёт ресурс, событие фиксируется', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const before = getWorldState(db, id).stock.find((x) => x.holder_id === 'chr-marta' && x.resource === 'зерно')?.quantity ?? 0

  const after = gift(db, id, 'chr-marta', 'зерно', 3)
  const grain = after.stock.find((x) => x.holder_id === 'chr-marta' && x.resource === 'зерно')?.quantity ?? 0
  assert.equal(grain, before + 3)
  assert.ok(after.events.some((e) => e.type === 'gift'))
})

test('осенний сценарий: деревня проходит до срока платежа и после', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  const end = runDays(db, id, 21)
  assert.equal(end.world.day, 22)

  const autumn = end.obligations.filter((o) => o.due_day === 20)
  assert.ok(autumn.length >= 3)
  for (const o of autumn) {
    assert.ok(o.status === 'fulfilled' || o.status === 'failed', `обязательство дня 20 должно быть урегулировано`)
  }
})
