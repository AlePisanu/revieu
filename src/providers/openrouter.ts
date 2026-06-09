import type { Provider } from '../types'

const API_URL = 'https://openrouter.ai/api/v1/chat/completions'
export const DEFAULT_OPENROUTER_MODEL = 'openai/gpt-4o-mini'
const MAX_TOKENS = 4096

export async function listOpenRouterModels(
  apiKey: string
): Promise<{ id: string; name: string }[]> {
  const FALLBACK: { id: string; name: string }[] = [
    { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini' },
    { id: 'openai/gpt-4o', name: 'GPT-4o' },
    { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' },
  ]

  try {
    const res = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    })
    if (!res.ok) return FALLBACK

    const data = await res.json()
    const models: { id: string; name: string }[] = []

    for (const m of data.data ?? []) {
      const id: string = m.id ?? ''
      if (!id) continue
      // Optional: filter to only text models? We'll keep all.
      models.push({ id, name: m.name ?? id })
    }

    return models.length > 0 ? models : FALLBACK
  } catch {
    return FALLBACK
  }
}

export class OpenRouterProvider implements Provider {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    this.model = model || DEFAULT_OPENROUTER_MODEL
  }

  async stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void> {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
        // Optional headers for identification
        'HTTP-Referer': window.location.origin,
        'X-Title': 'Revieu',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        stream: true,
        temperature: 0,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userMessage },
        ],
      }),
    })

    if (!response.ok) {
      const status = response.status
      if (status === 401) throw new Error('Invalid API key. Check your OpenRouter key in settings.')
      if (status === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.')

      let detail = ''
      try {
        const body = await response.json()
        detail = body?.error?.message ?? JSON.stringify(body)
      } catch { /* ignore parse errors */ }

      throw new Error(`OpenRouter API error (${status}): ${detail}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response stream available')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      // Keep the last (potentially incomplete) line in the buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6)
        if (data === '[DONE]') return

        try {
          const event = JSON.parse(data)
          // OpenAI-compatible streaming: choices[0].delta.content
          if (event.choices?.[0]?.delta?.content) {
            onChunk(event.choices[0].delta.content)
          }
        } catch {
          // Malformed lines (ping events, etc.) ignore
        }
      }
    }
  }
}