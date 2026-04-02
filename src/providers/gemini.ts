/**
 * gemini.ts — Provider per Gemini (API Google).
 *
 * Implementa l'interfaccia Provider per comunicare con l'API Gemini.
 * Usa l'endpoint streamGenerateContent con SSE (alt=sse) per lo streaming.
 *
 * Differenze rispetto al provider Anthropic:
 * - Ha un sistema di rate limiting client-side (MIN_REQUEST_INTERVAL_MS)
 *   perché il tier gratuito di Gemini ha limiti molto bassi
 * - Retry automatico su errori 429 (rate limit) con backoff lineare
 * - Il system prompt va nel campo `systemInstruction` (non nel messaggio utente)
 * - Il formato degli eventi SSE è diverso (candidates[0].content.parts[0].text)
 *
 * Pattern: STRATEGY (stesso di anthropic.ts)
 */

import type { Provider } from '../types'

const MODEL = 'gemini-2.5-flash'

// --- Rate limiting client-side ---
// Il tier gratuito di Gemini ha limiti stretti (es. 15 richieste/minuto).
// Queste costanti gestiscono il throttling e i retry lato client
// per evitare di bombardare l'API e ricevere 429 continui.

/** Intervallo minimo tra due richieste consecutive (10 secondi) */
const MIN_REQUEST_INTERVAL_MS = 10000
/** Numero massimo di retry automatici su errore 429 */
const MAX_RETRIES = 4
/** Delay base tra un retry e l'altro (cresce linearmente: 15s, 30s, 45s, 60s) */
const BASE_RETRY_DELAY_MS = 15000
/** Delay massimo tra retry (cap a 60 secondi) */
const MAX_RETRY_DELAY_MS = 60000

/** Timestamp dell'ultima richiesta — usato per il throttling */
let lastRequestAt = 0

/** Sleep asincrono — non fa nulla se ms <= 0 */
const sleep = async (ms: number): Promise<void> => {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * Calcola quanto aspettare prima del prossimo retry.
 * Prima controlla l'header `retry-after` dalla risposta del server.
 * Se non c'è, usa un backoff lineare (base * (attempt + 1)).
 */
const getRetryDelayMs = (response: Response, attempt: number): number => {
  const retryAfter = response.headers.get('retry-after')
  const retrySeconds = retryAfter ? Number.parseFloat(retryAfter) : Number.NaN

  // Se il server ci dice quanto aspettare, usiamo quello
  if (Number.isFinite(retrySeconds) && retrySeconds > 0) {
    return retrySeconds * 1000
  }

  // Altrimenti backoff lineare con cap a MAX_RETRY_DELAY_MS
  return Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * (attempt + 1))
}

export class GeminiProvider implements Provider {
  private apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  /**
   * Invia il prompt a Gemini e streama la risposta.
   *
   * Flusso:
   * 1. Costruisce la URL con il modello e la API key (l'autenticazione è via query param)
   * 2. Aspetta che sia passato MIN_REQUEST_INTERVAL_MS dall'ultima richiesta
   * 3. Manda la POST — se riceve 429, riprova fino a MAX_RETRIES volte
   * 4. Parsa lo stream SSE ed estrae il testo dai candidates
   *
   * L'endpoint `streamGenerateContent?alt=sse` ritorna eventi SSE come:
   * data: {"candidates":[{"content":{"parts":[{"text":"chunk di testo"}]}}]}
   */
  async stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void> {
    // L'API key va nella query string (non nell'header, a differenza di Anthropic)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:streamGenerateContent?alt=sse&key=${this.apiKey}`

    // systemInstruction è il campo dedicato di Gemini per il system prompt —
    // separato dal messaggio utente, dà risultati migliori rispetto a concatenarli.
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

    // --- Loop di retry con throttling ---
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      // Aspetta che sia passato abbastanza tempo dall'ultima richiesta.
      // Se il calcolo è negativo, sleep non fa nulla.
      await sleep(lastRequestAt + MIN_REQUEST_INTERVAL_MS - Date.now())

      lastRequestAt = Date.now()
      response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload,
      })

      // Risposta ok → esci dal loop
      if (response.ok) break
      // Errore diverso da rate limit → non ha senso riprovare
      if (response.status !== 429) break

      // Ultimo tentativo fallito → errore con suggerimento di attesa
      if (attempt === MAX_RETRIES) {
        const delayMs = getRetryDelayMs(response, attempt)
        throw new Error(`Gemini rate limit exceeded after automatic retries. Wait about ${Math.ceil(delayMs / 1000)}s and try again.`)
      }

      // Aspetta prima del prossimo tentativo
      await sleep(getRetryDelayMs(response, attempt))
    }

    if (!response) {
      throw new Error('Gemini request failed before a response was received.')
    }

    // Gestione errori HTTP
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

    // --- Parsing dello stream SSE (stesso pattern di anthropic.ts) ---
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
          // La struttura della risposta Gemini è:
          // { candidates: [{ content: { parts: [{ text: "..." }] } }] }
          const text = event?.candidates?.[0]?.content?.parts?.[0]?.text
          if (text) onChunk(text)
        } catch {
          // Righe malformate — ignoriamo
        }
      }
    }
  }
}
