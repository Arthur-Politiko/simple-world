import assert from 'node:assert/strict'
import test from 'node:test'
import { TICK_REGISTRY } from '../server/world'

test('реестр тиков: сущности в ожидаемом порядке', () => {
  const names = TICK_REGISTRY.map((e) => e.name)
  assert.deepEqual(names, ['season', 'church', 'characters', 'dependents', 'obligations', 'illness', 'mutualAid'])
})

test('реестр тиков: можно добавить существо записью', () => {
  // демонстрация паттерна: новая сущность = запись со своим tick
  const calls: string[] = []
  const custom = { name: 'goose', tick: () => { calls.push('goose') } }
  TICK_REGISTRY.push(custom)
  try {
    // реестр допускает расширение (в реальном коде сущности добавляются в world.ts)
    assert.ok(TICK_REGISTRY.some((e) => e.name === 'goose'))
  } finally {
    const i = TICK_REGISTRY.indexOf(custom)
    if (i >= 0) TICK_REGISTRY.splice(i, 1)
  }
})
