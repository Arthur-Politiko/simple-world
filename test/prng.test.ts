import assert from 'node:assert/strict'
import test from 'node:test'
import { mulberry32, intRange } from '../server/prng'

test('одинаковый seed даёт одинаковую последовательность', () => {
  const a = mulberry32(42)
  const b = mulberry32(42)
  for (let i = 0; i < 100; i++) {
    assert.equal(a(), b())
  }
})

test('intRange остаётся в заданных границах', () => {
  const rng = mulberry32(7)
  for (let i = 0; i < 500; i++) {
    const v = intRange(rng, 1, 5)
    assert.ok(v >= 1 && v <= 5)
  }
})
