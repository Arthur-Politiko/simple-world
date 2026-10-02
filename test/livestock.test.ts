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

  runDays(db, id, 15)
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

test('скот — особи: у каждой своё состояние (имя, возраст)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)

  // 7 особей (включая гуся), а не «стада»
  assert.equal(s.livestock.length, 7)

  const burёnka = s.livestock.find((l) => l.id === 'корова-бурёнка')
  assert.ok(burёnka, 'корова-особь есть')
  assert.equal(burёnka.name, 'Бурёнка')

  // возрасты расходятся — это «жизнь», а не счётчик
  const ages = new Set(s.livestock.map((l) => l.age))
  assert.ok(ages.size > 1, 'возрасты особей различаются')
})

test('особь стареет со временем', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  const before = s.livestock.find((l) => l.id === 'корова-бурёнка')!.age

  runDays(db, id, 3)
  const st = getWorldState(db, id)
  const after = st.livestock.find((l) => l.id === 'корова-бурёнка')!.age
  assert.ok(after > before, 'корова стареет')
})

test('декларативное существо (гусь) работает без нового кода тика', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // гусь добавлен записью (в CREATURE_DEFS + INITIAL_LIVESTOCK), без нового tick-кода
  assert.ok(s.livestock.some((l) => l.kind === 'гусь'), 'гусь есть')

  runDays(db, id, 7)
  const st = getWorldState(db, id)
  assert.ok(
    st.events.some((e) => e.type === 'livestock_produce' && (e.payload as { kind?: string }).kind === 'гусь'),
    'гусь даёт продукт из декларативной записи',
  )
})
