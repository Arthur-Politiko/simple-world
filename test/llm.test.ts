import assert from 'node:assert/strict'
import test from 'node:test'
import { chat, chatJSON } from '../server/llm'

// Реальные вызовы выполняются только при явном RUN_LLM_TESTS=1, чтобы не тратить API в обычном прогоне.
const enabled = process.env.RUN_LLM_TESTS === '1'

test('deepseek-flash возвращает текст (реальный API)', { skip: !enabled }, async () => {
  const content = await chat(
    'deepseek-flash',
    [{ role: 'user', content: 'Reply with one word: ok' }],
    { maxTokens: 512, temperature: 0 },
  )
  assert.match(content.toLowerCase(), /ok/)
})

test('deepseek-flash возвращает валидный JSON (реальный API)', { skip: !enabled }, async () => {
  const obj = await chatJSON<{ answer: string; n: number }>(
    'deepseek-flash',
    [{ role: 'user', content: 'Return strict JSON only with shape {"answer":"ok","n":2}' }],
    { maxTokens: 512, temperature: 0 },
  )
  assert.equal(obj.answer, 'ok')
  assert.equal(obj.n, 2)
})

test('deepseek-v4-pro возвращает валидный JSON при достаточном max_tokens (реальный API)', { skip: !enabled }, async () => {
  const obj = await chatJSON<{ answer: string; n: number }>(
    'deepseek-v4-pro',
    [{ role: 'user', content: 'Return strict JSON only with shape {"answer":"ok","n":2}' }],
    { maxTokens: 512, temperature: 0 },
  )
  assert.equal(obj.answer, 'ok')
  assert.equal(obj.n, 2)
})
