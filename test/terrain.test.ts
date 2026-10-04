import assert from 'node:assert/strict'
import test from 'node:test'
import { generateGrid, getGrid, tickGrid } from '../server/terrain'

test('сетка генерируется детерминированно', () => {
  const a = generateGrid(7, 50, 40)
  const b = generateGrid(7, 50, 40)
  assert.deepEqual(a, b, 'тот же seed → та же карта')
})

test('сетка содержит почву/гидро/флору', () => {
  const g = generateGrid(7, 50, 40)
  assert.equal(g.cells.length, 50 * 40, 'размер сетки')
  const terrains = new Set(g.cells.map((c) => c.terrain))
  assert.ok(terrains.has('вода'), 'есть вода (река/озеро)')
  assert.ok(terrains.has('суглинок'), 'есть суглинок (смешанный лес)')
  assert.ok(terrains.has('пойма'), 'есть пойма (заливной луг)')
  assert.ok(terrains.has('песок'), 'есть песок (бор)')
})

test('тик сетки: вырубка зарастает лесом (сукцессия, 5 лет)', () => {
  const g = getGrid(100, 50, 40)
  const before = g.cells.filter((c) => c.flora === 'вырубка').length
  assert.ok(before > 0, 'есть вырубка на старте')
  for (let day = 1; day <= 140; day++) tickGrid(100, day) // 5 лет
  const after = g.cells.filter((c) => c.flora === 'вырубка').length
  assert.equal(after, 0, 'вырубка заросла за 5 лет')
})
