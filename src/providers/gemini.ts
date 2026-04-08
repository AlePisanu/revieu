/**
 * gemini.ts — Provider for Gemini (Google API).
 *
 * Implements the Provider interface to communicate with the Gemini API.
 * Uses the streamGenerateContent endpoint with SSE (alt=sse) for streaming.
 *
 * Differences from the Anthropic provider:
 * - Has client-side rate limiting (MIN_REQUEST_INTERVAL_MS)
 *   because Gemini's free tier has very low limits
 * - Automatic retry on 429 errors (rate limit) with linear backoff
 * - The system prompt goes in the `systemInstruction` field (not in the user message)
 * - The SSE event format is different (candidates[0].content.parts[0].text)
 *
 * Pattern: STRATEGY (same as anthropic.ts)
 */

import type { Provider } from '../types'

const MODEL = 'gemini-2.5-flash-lite'
// const MODEL = 'gemini-2.5-flash'

// --- Client-side rate limiting ---
// Gemini's free tier has tight limits (e.g. 15 requests/minute).
// These constants manage client-side throttling and retries
// to avoid bombarding the API and receiving continuous 429s.

/** Minimum interval between two consecutive requests (10 seconds) */
const MIN_REQUEST_INTERVAL_MS = 10000
/** Maximum number of automatic retries on 429 error */
const MAX_RETRIES = 4
/** Base delay between retries (grows linearly: 15s, 30s, 45s, 60s) */
const BASE_RETRY_DELAY_MS = 15000
/** Maximum delay between retries (capped at 60 seconds) */
const MAX_RETRY_DELAY_MS = 60000

/** Timestamp of the last request — used for throttling */
let lastRequestAt = 0

/** Async sleep — does nothing if ms <= 0 */
const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calculates how long to wait before the next retry.
 * First checks the `retry-after` header from the server response.
 * If absent, uses linear backoff (base * (attempt + 1)).
 */
const getRetryDelayMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after')
  const retrySeconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN

  // If the server tells us how long to wait, use that
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return retrySeconds * 1000
  }

  // Otherwise linear backoff capped at MAX_RETRY_DELAY_MS
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (attempt + 1))
}

export class GeminiProvider implements Provider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Sends the prompt to Gemini and streams the response.
   *
   * Flow:
   * 1. Builds the URL with the model and API key (auth is via query param)
   * 2. Waits until MIN_REQUEST_INTERVAL_MS has passed since the last request
   * 3. Sends the POST — if it gets 429, retries up to MAX_RETRIES times
   * 4. Parses the SSE stream and extracts text from candidates
   *
   * The `streamGenerateContent?alt=sse` endpoint returns SSE events like:
   * data: {"candidates":[{"content":{"parts":[{"text":"text chunk"}]}}]}
   */
  async stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void> {
    // The API key goes in the query string (not in the header, unlike Anthropic)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${this.apiKey}`

    // systemInstruction is Gemini's dedicated field for the system prompt —
    // separate from the user message, gives better results than concatenating them.
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
    })

    let response: Response | null = null

    // --- Retry loop with throttling ---
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Wait until enough time has passed since the last request.
      // If the calculation is negative, sleep does nothing.
      await sleep(lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now())

      lastRequestAt = Date.now()
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })

      // Response ok → exit the loop
      if (response.ok) break
      // Error other than rate limit → no point retrying
      if (response.status !== 429) break

      // Last attempt failed → error with wait suggestion
      if (attempt === MAX_RETRIES) {
        const delayMs = getRetryDelayMs(response, attempt)
        throw new Error(`Gemini rate limit exceeded after automatic retries. Wait about ${Math.ceil(delayMs / 1000)}s and try again.`)
      }

      // Wait before the next attempt
      await sleep(getRetryDelayMs(response, attempt))
    }

    if (!response) {
      throw new Error('Gemini request failed before a response was received.')
    }

    // HTTP error handling
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

    // --- SSE stream parsing (same pattern as anthropic.ts) ---
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
          // Gemini response structure:
          // { candidates: [{ content: { parts: [{ text: "..." }] } }] }
          const text = event?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) onChunk(text)
        } catch {
          // Malformed lines — ignore
        }
      }
    }
  }
}
