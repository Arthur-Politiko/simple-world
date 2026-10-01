import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { advancePhase, createWorld } from '../server/world'

test('взаимопомощь: голодному передают еду, растёт доверие', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  // Марта голодна (и не соберёт зерно — поля пусты)
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND holder_id = 'chr-marta' AND resource IN ('зерно', 'рыба', 'овощи')").run()
  db.prepare("UPDATE plots SET harvest = 0 WHERE kind = 'поле'").run()

  advancePhase(db, id) // день
  advancePhase(db, id) // вечер
  const st = advancePhase(db, id) // ночь

  const help = st.events.find((e) => e.type === 'help')
  assert.ok(help, 'должна быть помощь')
  const martaFood = st.stock
    .filter((x) => x.holder_id === 'chr-marta' && (x.resource === 'зерно' || x.resource === 'рыба' || x.resource === 'овощи'))
    .reduce((a, b) => a + b.quantity, 0)
  assert.ok(martaFood > 0, 'Марта получила еду')

  const trust = db
    .prepare("SELECT trust FROM memory_relationships WHERE world_id = ? AND character_id = 'chr-marta' AND trust > 0")
    .get(id) as { trust: number } | undefined
  assert.ok(trust, 'доверие к помощнику выросло')
})

test('без излишков помощи нет', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  // все голодны (и поля пусты — земледельцы не соберут зерно)
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND resource IN ('зерно', 'рыба', 'овощи')").run()
  db.prepare("UPDATE plots SET harvest = 0 WHERE kind = 'поле'").run()

  advancePhase(db, id) // день
  advancePhase(db, id) // вечер
  const st = advancePhase(db, id) // ночь

  assert.ok(!st.events.some((e) => e.type === 'help'), 'нет излишков — нет помощи')
})
