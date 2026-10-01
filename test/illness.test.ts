import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { advancePhase, createWorld, getWorldState } from '../server/world'

test('перегруз: работа при нулевой энергии уходит в минус и бьёт по здоровью', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  db.prepare("UPDATE characters SET energy = 0 WHERE world_id = ? AND id = 'chr-marta'").run(id)

  advancePhase(db, id) // день (еда)
  const st = advancePhase(db, id) // вечер (работа)

  const marta = st.characters.find((c) => c.id === 'chr-marta')!
  assert.equal(marta.energy, -1, 'работа при нулевой энергии уводит в минус')
  assert.ok(marta.health < 100, 'перегруз бьёт по здоровью')
  assert.ok(st.events.some((e) => e.type === 'overwork'))
})

test('голод бьёт по здоровью', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  db.prepare("DELETE FROM stock WHERE holder_type = 'character' AND holder_id = 'chr-marta' AND resource IN ('зерно', 'рыба', 'овощи')").run()

  advancePhase(db, id) // день (еда) → голод
  const st = getWorldState(db, id)
  const marta = st.characters.find((c) => c.id === 'chr-marta')!
  assert.ok(marta.health < 100, 'голод бьёт по здоровью')
  assert.ok(st.events.some((e) => e.type === 'hunger' && (e.payload as { characterId?: string }).characterId === 'chr-marta'))
})

test('сон восстанавливает здоровье', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  db.prepare("UPDATE characters SET health = 50 WHERE world_id = ? AND id = 'chr-marta'").run(id)
  // дать еды, чтобы на день 1 (после посева) не голодала
  db.prepare("INSERT INTO stock (world_id, holder_type, holder_id, resource, quantity) VALUES (?, 'character', 'chr-marta', 'овощи', 5)").run(id)

  advancePhase(db, id) // день
  advancePhase(db, id) // вечер
  const st = advancePhase(db, id) // ночь (сон)

  const marta = st.characters.find((c) => c.id === 'chr-marta')!
  assert.ok(marta.health > 50, 'сон лечит')
})

test('больной (health < 20) не может работать', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  const id = s.world.id
  db.prepare("UPDATE characters SET health = 10 WHERE world_id = ? AND id = 'chr-marta'").run(id)

  advancePhase(db, id) // день
  const st = advancePhase(db, id) // вечер (работа) — но Марта больна

  const marta = st.characters.find((c) => c.id === 'chr-marta')!
  assert.equal(marta.energy, 2, 'больной не работал — энергия не тратилась')
  assert.ok(st.events.some((e) => e.type === 'sick'))
})
