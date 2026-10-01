import type { DatabaseSync } from 'node:sqlite'
import { estimateCost, loadPricing, type LLMUsage } from './llm'

export interface UsageSummary {
  pricing: ReturnType<typeof loadPricing>
  totals: {
    calls: number
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    cacheHitTokens: number
    cacheMissTokens: number
    cost: number | null
  }
  byModel: Array<{
    model: string
    calls: number
    promptTokens: number
    completionTokens: number
    reasoningTokens: number
    cost: number | null
  }>
}

export function recordLLMCall(db: DatabaseSync, operation: string, usage: LLMUsage): void {
  const pricing = loadPricing()
  const cost = estimateCost(usage, pricing)
  db.prepare(
    `INSERT INTO llm_calls (model, operation, prompt_tokens, completion_tokens, reasoning_tokens, cache_hit_tokens, cache_miss_tokens, cost, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    usage.model,
    operation,
    usage.promptTokens,
    usage.completionTokens,
    usage.reasoningTokens,
    usage.cacheHitTokens,
    usage.cacheMissTokens,
    cost,
    new Date().toISOString(),
  )
}

export function getLLMUsageSummary(db: DatabaseSync): UsageSummary {
  const pricing = loadPricing()

  const total = db
    .prepare(
      `SELECT COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens),0) AS completion_tokens,
              COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
              COALESCE(SUM(cache_hit_tokens),0) AS cache_hit_tokens,
              COALESCE(SUM(cache_miss_tokens),0) AS cache_miss_tokens,
              SUM(cost) AS cost
       FROM llm_calls`,
    )
    .get() as {
    calls: number
    prompt_tokens: number
    completion_tokens: number
    reasoning_tokens: number
    cache_hit_tokens: number
    cache_miss_tokens: number
    cost: number | null
  }

  const byModel = db
    .prepare(
      `SELECT model,
              COUNT(*) AS calls,
              COALESCE(SUM(prompt_tokens),0) AS prompt_tokens,
              COALESCE(SUM(completion_tokens),0) AS completion_tokens,
              COALESCE(SUM(reasoning_tokens),0) AS reasoning_tokens,
              SUM(cost) AS cost
       FROM llm_calls GROUP BY model ORDER BY model`,
    )
    .all() as unknown as Array<{
    model: string
    calls: number
    prompt_tokens: number
    completion_tokens: number
    reasoning_tokens: number
    cost: number | null
  }>

  return {
    pricing,
    totals: {
      calls: total.calls,
      promptTokens: total.prompt_tokens,
      completionTokens: total.completion_tokens,
      reasoningTokens: total.reasoning_tokens,
      cacheHitTokens: total.cache_hit_tokens,
      cacheMissTokens: total.cache_miss_tokens,
      cost: total.cost,
    },
    byModel: byModel.map((m) => ({
      model: m.model,
      calls: m.calls,
      promptTokens: m.prompt_tokens,
      completionTokens: m.completion_tokens,
      reasoningTokens: m.reasoning_tokens,
      cost: m.cost,
    })),
  }
}
