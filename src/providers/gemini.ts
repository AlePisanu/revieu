import type { Provider } from '../types'

export const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash-lite'

export async function listGeminiModels(
  apiKey: string
): Promise<{ id: string; name: string }[]> {
  const FALLBACK: { id: string; name: string }[] = [
    { id: 'gemini-2.5-flash-lite', name: 'Gemini 2.5 Flash Lite' },
    { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash' },
    { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro' },
  ]

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`
    )
    if (!res.ok) return FALLBACK

    const data = await res.json()
    const models: { id: string; name: string }[] = []

    for (const m of data.models ?? []) {
      const methods: string[] = m.supportedGenerationMethods ?? []
      if (!methods.includes('generateContent')) continue
      const id: string = m.name?.replace('models/', '') ?? ''
      if (!id || id.includes('image') || id.includes('live') || id.includes('embedding')) continue
      models.push({ id, name: m.displayName ?? id })
    }

    return models.length > 0 ? models : FALLBACK
  } catch {
    return FALLBACK
  }
}

// Gemini free tier has tight rate limits (15 req/min).
// These constants manage client-side throttling to avoid 429 storms.
const MIN_REQUEST_INTERVAL_MS = 10000
const MAX_RETRIES = 4
const BASE_RETRY_DELAY_MS = 15000
const MAX_RETRY_DELAY_MS = 60000

let lastRequestAt = 0

const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

const getRetryDelayMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after')
  const retrySeconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN

  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return retrySeconds * 1000
  }

  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (attempt + 1))
}

export class GeminiProvider implements Provider {
  private apiKey: string
  private model: string

  constructor(apiKey: string, model?: string) {
    this.apiKey = apiKey
    this.model = model || DEFAULT_GEMINI_MODEL
  }

  async stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void> {
    // Gemini auth is via query param, not header
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:streamGenerateContent?alt=sse&key=${this.apiKey}`

    const payload = JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemPrompt }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userMessage }],
        },
      ],
      generationConfig: {
        temperature: 0,
        topP: 0.1,
        topK: 1,
      },
    })

    let response: Response | null = null

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      await sleep(lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now())

      lastRequestAt = Date.now()
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })

      if (response.ok) break
      if (response.status !== 429) break

      if (attempt === MAX_RETRIES) {
        const delayMs = getRetryDelayMs(response, attempt)
        throw new Error(`Gemini rate limit exceeded after automatic retries. Wait about ${Math.ceil(delayMs / 1000)}s and try again.`)
      }

      await sleep(getRetryDelayMs(response, attempt))
    }

    if (!response) {
      throw new Error('Gemini request failed before a response was received.')
    }

    if (!response.ok) {
      const status = response.status
      if (status === 400) throw new Error('Invalid Gemini API key. Check your key in settings.')

      let detail = ''
      try {
        const body = await response.json()
        detail = body?.error?.message ?? JSON.stringify(body)
      } catch { /* ignore parse errors */ }

      throw new Error(`Gemini API error (${status}): ${detail}`)
    }

    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response stream available')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })

      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6)
        if (data === '[DONE]') return

        try {
          const event = JSON.parse(data)
          const text = event?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) onChunk(text)
        } catch {
          // Malformed lines ignore
        }
      }
    }
  }
}
