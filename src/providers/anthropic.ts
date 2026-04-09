import type { Provider } from '../types'

const API_URL = 'https://api.anthropic.com/v1/messages'
export const DEFAULT_ANTHROPIC_MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4096

export async function listAnthropicModels(
  apiKey: string
): Promise<{ id: string; name: string }[]> {
  const FALLBACK: { id: string; name: string }[] = [
    { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5' },
    { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5' },
    { id: 'claude-opus-4', name: 'Claude Opus 4' },
  ]

  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=100', {
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
    })
    if (!res.ok) return FALLBACK

    const data = await res.json()
    const models: { id: string; name: string }[] = []

    for (const m of data.data ?? []) {
      const id: string = m.id ?? ''
      if (!id) continue
      models.push({ id, name: m.display_name ?? id })
    }

    return models.length > 0 ? models : FALLBACK
  } catch {
    return FALLBACK
  }
}

export class AnthropicProvider implements Provider {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    this.model = model || DEFAULT_ANTHROPIC_MODEL
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
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        // Required header to allow direct browser calls key stays in extension storage, not page source
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: MAX_TOKENS,
        stream: true,
        temperature: 0,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    if (!response.ok) {
      const status = response.status
      if (status === 401) throw new Error('Invalid API key. Check your Anthropic key in settings.')
      if (status === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.')

      let detail = ''
      try {
        const body = await response.json()
        detail = body?.error?.message ?? JSON.stringify(body)
      } catch { /* ignore parse errors */ }

      throw new Error(`Anthropic API error (${status}): ${detail}`)
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
          if (event.type === 'content_block_delta' && event.delta?.text) {
            onChunk(event.delta.text)
          }
        } catch {
          // Malformed lines (ping events, etc.) ignore
        }
      }
    }
  }
}
