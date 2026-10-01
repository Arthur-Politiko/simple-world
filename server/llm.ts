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
  // Только для разработки: обойти MITM-прокси/антивирус с самоподписанным сертификатом.
  // НЕ включать в продакшене.
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
  return {
    apiKey,
    baseUrl: process.env.DEEPSEEK_BASE_URL ?? DEFAULT_BASE_URL,
  }
}

export interface ChatOptions {
  maxTokens?: number
  temperature?: number
}

/**
 * Один вызов DeepSeek (OpenAI-совместимый API).
 * Возвращает только `content` (для резонер-моделей `reasoning_content` не включается).
 */
export async function chat(model: string, messages: ChatMessage[], options: ChatOptions = {}): Promise<string> {
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
      // Обе модели (flash и pro) — резонер-модели: токены уходят и на рассуждение, поэтому нужен запас.
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
  }
  const content = data.choices?.[0]?.message?.content ?? ''
  if (!content.trim()) {
    throw new Error('LLM вернул пустой ответ (возможно, слишком мал max_tokens для резонер-модели)')
  }
  return content
}

/** Просит модель вернуть JSON и возвращает распарсенный объект. */
export async function chatJSON<T>(model: string, messages: ChatMessage[], options: ChatOptions = {}): Promise<T> {
  const content = await chat(model, messages, options)
  const start = content.indexOf('{')
  const end = content.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error(`LLM вернул не-JSON: ${content.slice(0, 200)}`)
  }
  return JSON.parse(content.slice(start, end + 1)) as T
}
