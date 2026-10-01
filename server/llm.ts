import { RuleError } from './world'

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export const DEFAULT_MODEL = 'deepseek-flash'
export const REFLECTION_MODEL = 'deepseek-v4-pro'
const DEFAULT_BASE_URL = 'https://api.deepseek.com'

function loadEnvOnce(): void {
  try {
    // Node 21.7+: загружает .env в process.env; при отсутствии файла — ошибка, которую игнорируем.
    process.loadEnvFile?.('.env')
  } catch {
    /* переменные задаются окружением */
  }
  // Только для разработки: обойти MITM-прокси/антивирус с самоподписанным сертификатом. НЕ для продакшена.
  if (process.env.DEEPSEEK_TLS_INSECURE === '1') {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0'
  }
}
loadEnvOnce()

export interface LLMConfig {
  apiKey: string
  baseUrl: string
}

export function loadLLMConfig(): LLMConfig | null {
  const apiKey = process.env.DEEPSEEK_API_KEY
  if (!apiKey) return null
  return { apiKey, baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL }
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
}

export interface LLMUsage {
  model: string
  promptTokens: number
  completionTokens: number
  reasoningTokens: number
  cacheHitTokens: number
  cacheMissTokens: number
}

export interface LLMResult {
  content: string
  usage: LLMUsage
}

function parseUsage(model: string, usage: unknown): LLMUsage {
  const u = (usage ?? {}) as {
    prompt_tokens?: number
    completion_tokens?: number
    prompt_cache_hit_tokens?: number
    prompt_cache_miss_tokens?: number
    completion_tokens_details?: { reasoning_tokens?: number }
  }
  return {
    model,
    promptTokens: u.prompt_tokens ?? 0,
    completionTokens: u.completion_tokens ?? 0,
    reasoningTokens: u.completion_tokens_details?.reasoning_tokens ?? 0,
    cacheHitTokens: u.prompt_cache_hit_tokens ?? 0,
    cacheMissTokens: u.prompt_cache_miss_tokens ?? 0,
  }
}

export async function chat(model: string, messages: ChatMessage[], options: ChatOptions = {}): Promise<LLMResult> {
  const config = loadLLMConfig()
  if (!config) throw new RuleError('LLM не настроен: задайте DEEPSEEK_API_KEY')

  const response = await fetch(`${config.baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages,
      // Обе модели — резонер-модели: токены уходят и на рассуждение, поэтому нужен запас.
      max_tokens: options.maxTokens ?? 1024,
      temperature: options.temperature ?? 0.7,
    }),
  })

  if (!response.ok) {
    const body = await response.text().catch(() => '')
    throw new Error(`LLM HTTP ${response.status}: ${body.slice(0, 400)}`)
  }

  const data = (await response.json()) as {
    choices?: Array<{ message?: { content?: string; reasoning_content?: string } }>
    usage?: unknown
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) {
    throw new Error('LLM вернул пустой ответ (возможно, слишком мал max_tokens для резонер-модели)')
  }
  return { content, usage: parseUsage(model, data.usage) }
}

export async function chatJSON<T>(
  model: string,
  messages: ChatMessage[],
  options: ChatOptions = {},
): Promise<{ value: T; usage: LLMUsage }> {
  const { content, usage } = await chat(model, messages, options)
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LLM вернул не-JSON: ${content.slice(0, 200)}`)
  }
  return { value: JSON.parse(content.slice(start, end + 1)) as T, usage }
}

export interface LLMPricing {
  inputPer1m: number
  cacheHitPer1m: number
  outputPer1m: number
  currency: string
}

function readPrice(name: string): number | undefined {
  const raw = process.env[name]
  if (raw === undefined || raw.trim() === '') return undefined
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? n : undefined
}

/** Тарифы читаются явно; неизвестная цена не считается нулём (возвращается null). */
export function loadPricing(): LLMPricing | null {
  const input = readPrice('DEEPSEEK_PRICE_INPUT_PER_1M')
  const output = readPrice('DEEPSEEK_PRICE_OUTPUT_PER_1M')
  if (input === undefined || output === undefined) return null
  const cacheHit = readPrice('DEEPSEEK_PRICE_CACHE_HIT_PER_1M') ?? input
  return {
    inputPer1m: input,
    cacheHitPer1m: cacheHit,
    outputPer1m: output,
    currency: process.env.DEEPSEEK_PRICE_CURRENCY?.trim() || 'USD',
  }
}

export function estimateCost(usage: LLMUsage, pricing: LLMPricing | null): number | null {
  if (!pricing) return null
  return (
    (usage.cacheMissTokens * pricing.inputPer1m +
      usage.cacheHitTokens * pricing.cacheHitPer1m +
      usage.completionTokens * pricing.outputPer1m) /
    1_000_000
  )
}
