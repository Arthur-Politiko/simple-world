import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceTime, phaseName, PHASES } from '../server/time'

test('фазы дня определены', () => {
  assert.deepEqual(PHASES, ['утро', 'день', 'вечер', 'ночь'])
  assert.equal(phaseName(0), 'утро')
  assert.equal(phaseName(3), 'ночь')
})

test('продвижение времени по фазам и дням', () => {
  assert.deepEqual(advanceTime(1, 0), { day: 1, phase: 1 })
  assert.deepEqual(advanceTime(1, 3), { day: 2, phase: 0 })
  assert.deepEqual(advanceTime(2, 2), { day: 2, phase: 3 })
})
