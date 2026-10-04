import assert from 'node:assert/strict'
import test from 'node:test'
import { generateGrid } from '../server/terrain'

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
