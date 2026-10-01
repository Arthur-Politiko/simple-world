import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { createWorld, getWorldState, runDays, trade, gather, RuleError } from '../server/world'

function qty(state: { stock: { holder_type: string; holder_id: string; resource: string; quantity: number }[] }, holderId: string, resource: string): number {
  return state.stock.find((x) => x.holder_id === holderId && x.resource === resource)?.quantity ?? 0
}

test('факт и знание разделены: сведение получает только источник (трактир)', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 4) // день 5 — торговец приехал

  const st = getWorldState(db, id)
  // объективный факт есть
  assert.ok(st.facts.some((f) => f.type === 'trader_arrived'))

  // Томек (трактирщик, в трактире) узнал
  const tomek = st.knowledge.filter((k) => k.character_id === 'chr-tomek')
  assert.ok(tomek.length >= 1)
  assert.ok(tomek.every((k) => k.is_true === true))

  // Марта (в деревне) — не знает
  const marta = st.knowledge.filter((k) => k.character_id === 'chr-marta')
  assert.equal(marta.length, 0)
})

test('ложный слух не меняет объективные факты', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 8) // день 9 — слух

  const st = getWorldState(db, id)
  const rumor = st.knowledge.find((k) => k.character_id === 'chr-tomek' && k.summary.includes('отменит оброк'))
  assert.ok(rumor, 'слух должен быть в знании трактирщика')
  assert.equal(rumor.is_true, false)

  // факт об отмене оброка отсутствует; обязательство остаётся
  assert.ok(!st.facts.some((f) => f.type.includes('оброк') && f.type.includes('отмен')))
  const martaAutumn = st.obligations.find((o) => o.character_id === 'chr-marta' && o.due_day === 20)
  assert.equal(martaAutumn?.status, 'pending')
})

test('внешнее событие (размытая дорога) отменяет визит торговца', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 9) // до дня 10

  const st = getWorldState(db, id)
  assert.ok(st.facts.some((f) => f.type === 'road_washout'))
  assert.ok(st.events.some((e) => e.type === 'trader_cancelled'))
  // торговец приехал только один раз (день 5), второй визит отменён
  assert.equal(st.facts.filter((f) => f.type === 'trader_arrived').length, 1)
})

test('торговец: продажа и лимит денег', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 4) // день 5 — торговец приехал

  // Гжегож продаёт 4 дров по 1 монете
  const t1 = trade(db, id, 'chr-grzegorz', 'sell', 'дрова', 4)
  assert.equal(qty(t1, 'chr-grzegorz', 'монеты'), 6 + 4)
  assert.equal(t1.trader.money, 40 - 4)

  // продать рыбу на сумму больше денег торговца -> отклонено
  gather(db, id, 'chr-jan', 'рыба', 30)
  assert.throws(() => trade(db, id, 'chr-jan', 'sell', 'рыба', 30), RuleError)
})

test('покупка ограничена товаром торговца', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  runDays(db, id, 4) // торговец приехал, зерно у него 20

  // купить больше зерна, чем есть у торговца -> отклонено
  gather(db, id, 'chr-marta', 'монеты', 100)
  assert.throws(() => trade(db, id, 'chr-marta', 'buy', 'зерно', 21), RuleError)
})

test('урожай на поле конечен и исчерпывается', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  assert.equal(qty(s, 'loc-field', 'урожай'), 80)

  runDays(db, id, 20)

  const st = getWorldState(db, id)
  assert.equal(qty(st, 'loc-field', 'урожай'), 0)
  assert.ok(st.events.some((e) => e.type === 'field_empty'), 'после исчерпания урожая работа на поле невозможна')
})

test('конфликт: зерно идёт на еду или на платёж, но не на всё сразу', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id

  // имитируем неурожай: поле пусто
  db.prepare("UPDATE stock SET quantity = 0 WHERE holder_type = 'location' AND holder_id = 'loc-field' AND resource = 'урожай'").run()

  runDays(db, id, 20)

  const st = getWorldState(db, id)
  // огород даёт овощи (голода нет), но зерна нет — осенний оброк провален
  assert.ok(st.events.some((e) => e.type === 'garden_harvest'))
  const martaAutumn = st.obligations.find((o) => o.character_id === 'chr-marta' && o.due_day === 20)
  assert.equal(martaAutumn?.status, 'failed')
})
