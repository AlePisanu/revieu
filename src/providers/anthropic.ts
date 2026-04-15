import type { Provider } from '../types'

declare const __FIREFOX__: boolean

// Firefox blocks fetch() from content scripts via GitHub's CSP.
// This helper proxies the request through the background port instead.
async function fetchViaPort(
  url: string,
  options: { method: string; headers: Record<string, string>; body: string },
  onChunk: (text: string) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'ai-stream' })
    port.onMessage.addListener((msg: { type: string; text?: string; status?: number; message?: string }) => {
      if (msg.type === 'CHUNK') {
        onChunk(msg.text ?? '')
      } else if (msg.type === 'DONE') {
        port.disconnect()
        resolve()
      } else if (msg.type === 'ERROR') {
        port.disconnect()
        reject(Object.assign(new Error(msg.message ?? `HTTP ${msg.status}`), { httpStatus: msg.status }))
      }
    })
    port.postMessage({ type: 'STREAM_REQUEST', url, ...options })
  })
}

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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      // Required header to allow direct browser calls; key stays in extension storage, not page source
      'anthropic-dangerous-direct-browser-access': 'true',
    }

    const body = JSON.stringify({
      model: this.model,
      max_tokens: MAX_TOKENS,
      stream: true,
      temperature: 0,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    })

    // SSE parsing shared between Chrome and Firefox paths
    let buffer = ''
    const parseRawChunk = (raw: string) => {
      buffer += raw
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
        } catch { /* malformed lines (ping events, etc.) ignore */ }
      }
    }

    if (__FIREFOX__) {
      // Firefox path: proxy through background port to bypass GitHub's CSP
      try {
        await fetchViaPort(API_URL, { method: 'POST', headers, body }, parseRawChunk)
      } catch (e: unknown) {
        const httpStatus = (e as { httpStatus?: number }).httpStatus
        if (httpStatus === 401) throw new Error('Invalid API key. Check your Anthropic key in settings.')
        if (httpStatus === 429) throw new Error('Rate limit exceeded. Please wait a moment and try again.')
        throw new Error(`Anthropic API error (${httpStatus ?? 0}): ${(e as Error).message}`)
      }
      return
    }

    // Chrome path: direct fetch (not subject to GitHub's CSP)
    const response = await fetch(API_URL, { method: 'POST', headers, body })

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

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      parseRawChunk(decoder.decode(value, { stream: true }))
    }
  }
}
