import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays } from '../server/world'

test('у дворов есть скот, у земледельцев — вол', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  assert.ok(s.livestock.length > 0)
  assert.ok(s.livestock.some((l) => l.household_id === 'hh-marta' && l.kind === 'вол'))
})

test('скот даёт продукт (молоко/яйца)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 3)
  const st = getWorldState(db, id)
  assert.ok(st.events.some((e) => e.type === 'livestock_produce'), 'скот даёт продукт')
  assert.ok(st.stock.some((x) => x.resource === 'молоко' || x.resource === 'яйца'))
})

test('вол увеличивает сбор зерна (тяга)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 1)
  const st = getWorldState(db, id)
  const martaWork = st.events.find(
    (e) =>
      e.type === 'work' &&
      (e.payload as { characterId?: string }).characterId === 'chr-marta' &&
      (e.payload as { resource?: string }).resource === 'зерно',
  )
  assert.ok(martaWork, 'Марта работает в поле')
  assert.equal((martaWork.payload as { amount: number }).amount, 3, 'с волом сбор 2 + 1 тяги')
})

test('скот без сена падает здоровье', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  // заберём сено у Марты и опустошим луга — вол не сможет есть
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND holder_id IN ('chr-marta', 'chr-tomas') AND resource = 'сено'").run()
  db.prepare("UPDATE plots SET size = 0 WHERE kind = 'луг'").run()

  runDays(db, id, 6)
  const st = getWorldState(db, id)
  const ox = st.livestock.find((l) => l.household_id === 'hh-marta' && l.kind === 'вол')
  // вол либо пал, либо серьёзно болеет
  assert.ok(!ox || ox.health < 100, 'без сена вол не остаётся здоровым')
})

test('скот даёт навоз, удобряющий поле', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 2)
  const st = getWorldState(db, id)
  assert.ok(st.events.some((e) => e.type === 'manure'), 'скот даёт навоз')
})
