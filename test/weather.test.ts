import assert from 'node:assert/strict'
import test from 'node:test'
import { openDb } from '../server/db'
import { WEATHER_REGEN, createWorld, getWorldState, runDays, weatherOfDay } from '../server/world'

const WEATHERS = ['солнечно', 'дождливо', 'засуха', 'половодье', 'мороз', 'метель']

test('погода детерминирована от seed', () => {
  const a = createWorld(openDb(':memory:'), 'Тест', 42)
  const b = createWorld(openDb(':memory:'), 'Тест', 42)
  assert.equal(a.weather, b.weather, 'одинаковый seed → одинаковая погода')
})

test('погода — известное значение', () => {
  const s = createWorld(openDb(':memory:'), 'Тест', 1)
  assert.ok(WEATHERS.includes(s.weather), `неизвестная погода: ${s.weather}`)
})

test('зимой погода — мороз или метель', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 1)
  runDays(db, s.world.id, 21) // день 22 — зима
  const st = getWorldState(db, s.world.id)
  assert.ok(['мороз', 'метель'].includes(st.weather), `зимой: ${st.weather}`)
})

test('погода модулирует прирост флоры', () => {
  const db = openDb(':memory:')
  const s = createWorld(db, 'Тест', 7)
  const id = s.world.id

  // ивняк без травоядных — чистый прирост
  db.prepare("UPDATE flora SET density = 0.2 WHERE world_id = ? AND kind = 'ивняк'").run(id)
  runDays(db, id, 28) // до весны дня 29

  const st = getWorldState(db, id)
  const density = st.flora.find((f) => f.kind === 'ивняк')!.density
  const factor = WEATHER_REGEN[weatherOfDay(7, 29)] ?? 1
  const expected = 0.2 + 0.1 * factor
  assert.ok(Math.abs(density - expected) < 0.0001, `ивняк: ${density} ≈ ${expected} (погода ${weatherOfDay(7, 29)})`)
})
