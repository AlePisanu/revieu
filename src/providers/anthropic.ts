/**
 * anthropic.ts — Provider per Claude (API Anthropic).
 *
 * Implementa l'interfaccia Provider per comunicare con l'API di Anthropic.
 * Usa lo streaming SSE (Server-Sent Events) per ricevere la risposta
 * pezzo per pezzo e mostrarla in tempo reale nella sidebar.
 *
 * Pattern: STRATEGY
 * L'analyzer non sa quale provider sta usando — chiama solo stream().
 * Questo file è intercambiabile con gemini.ts o qualsiasi altro provider.
 *
 * Nota sull'header "anthropic-dangerous-direct-browser-access":
 * L'API Anthropic normalmente blocca le chiamate dirette dal browser
 * (per sicurezza — la API key sarebbe esposta nel client).
 * Questo header dice all'API "so cosa sto facendo".
 * In un'estensione Chrome il rischio è mitigato perché la API key
 * è nello storage dell'estensione, non nel codice sorgente della pagina.
 */

import type { Provider } from '../types'

const API_URL = 'https://api.anthropic.com/v1/messages'
const MODEL = 'claude-haiku-4-5-20241022'
const MAX_TOKENS = 4096

export class AnthropicProvider implements Provider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Invia il prompt a Claude e streama la risposta.
   *
   * Flusso:
   * 1. Manda una POST con stream: true all'API Messages
   * 2. L'API risponde con un flusso SSE (ogni riga inizia con "data: ")
   * 3. Parsiamo ogni evento JSON e estraiamo il testo dai content_block_delta
   * 4. Chiamiamo onChunk per ogni pezzo di testo ricevuto
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
        system: systemPrompt,
        messages: [{ role: 'user', content: userMessage }],
      }),
    })

    // Gestione errori HTTP con messaggi utili per l'utente
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

    // --- Parsing dello stream SSE ---
    const reader = response.body?.getReader()
    if (!reader) throw new Error('No response stream available')

    const decoder = new TextDecoder()
    let buffer = ''

    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // Accumula i byte nel buffer (stream: true nel decoder gestisce i chunk parziali)
      buffer += decoder.decode(value, { stream: true })

      // Ogni riga SSE è separata da \n — splittiamo e processiamo
      // L'ultima riga potrebbe essere incompleta → la teniamo nel buffer
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''

      for (const line of lines) {
        // Le righe SSE con dati iniziano con "data: "
        if (!line.startsWith('data: ')) continue

        const data = line.slice(6)
        if (data === '[DONE]') return

        try {
          const event = JSON.parse(data)

          // L'evento "content_block_delta" contiene il testo generato
          // event.delta.text è il pezzo di risposta da mostrare
          if (event.type === 'content_block_delta' && event.delta?.text) {
            onChunk(event.delta.text)
          }
        } catch {
          // Righe JSON malformate — le ignoriamo (possono essere eventi di ping)
        }
      }
    }
  }
}
