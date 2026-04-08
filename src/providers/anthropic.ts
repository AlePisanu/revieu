/**
 * anthropic.ts — Provider for Claude (Anthropic API).
 *
 * Implements the Provider interface to communicate with the Anthropic API.
 * Uses SSE (Server-Sent Events) streaming to receive the response
 * piece by piece and display it in real time in the sidebar.
 *
 * Pattern: STRATEGY
 * The analyzer doesn't know which provider it's using — it only calls stream().
 * This file is interchangeable with gemini.ts or any other provider.
 *
 * Note on the "anthropic-dangerous-direct-browser-access" header:
 * The Anthropic API normally blocks direct browser calls
 * (for security — the API key would be exposed in the client).
 * This header tells the API "I know what I'm doing".
 * In a Chrome extension the risk is mitigated because the API key
 * is in the extension's storage, not in the page source code.
 */

import type { Provider } from '../types'

const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5'
const MAX_TOKENS = 4096

export class AnthropicProvider implements Provider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Sends the prompt to Claude and streams the response.
   *
   * Flow:
   * 1. Sends a POST with stream: true to the Messages API
   * 2. The API responds with an SSE stream (each line starts with "data: ")
   * 3. We parse each JSON event and extract text from content_block_delta
   * 4. We call onChunk for each piece of text received
   */
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
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        stream: true,
        temperature: 0,
        top_p: 0.1,
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    // HTTP error handling with user-friendly messages
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

    // --- SSE stream parsing ---
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response stream available')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Accumulate bytes in the buffer (stream: true in decoder handles partial chunks)
      buffer += decoder.decode(value, { stream: true })

      // Each SSE line is separated by \n — split and process
      // The last line might be incomplete → keep it in the buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        // SSE data lines start with "data: "
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6)
        if (data === '[DONE]') return

        try {
          const event = JSON.parse(data)

          // The "content_block_delta" event contains the generated text
          // event.delta.text is the response piece to display
          if (event.type === 'content_block_delta' && event.delta?.text) {
            onChunk(event.delta.text)
          }
        } catch {
          // Malformed JSON lines — ignore (could be ping events)
        }
      }
    }
  }
}
