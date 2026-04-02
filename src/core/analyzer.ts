/**
 * analyzer.ts — Orchestratore principale della review.
 *
 * Questo è il "direttore d'orchestra" che coordina tutti gli altri moduli.
 * Non contiene logica di business specifica — chiama gli altri moduli
 * nell'ordine giusto e gestisce i casi limite (diff troppo grande, nessun file, ecc.)
 *
 * Flusso completo (5 step):
 * 1. Estrai contesto (titolo/descrizione) e diff dalla pagina → adapter
 * 2. Arricchisci i diff (linguaggio, conteggi) → parser
 * 3. Controlla dimensione e filtra file → logica interna
 * 3b. Se mode "full", scarica i file completi → adapter.fetchFullFile
 * 4. Costruisci il prompt → prompt.ts
 * 5. Manda all'AI e streama la risposta → provider
 *
 * Pattern: FACADE
 * La sidebar chiama solo `analyze(options)` — non deve sapere nulla
 * di adapter, parser, prompt, provider. Tutta la complessità è qui dentro.
 */

import type { Adapter, Provider, DiffFile } from '../types'
import { parseDiff } from './parser'
import { buildSystemPrompt, buildUserMessage } from './prompt'
import { AnthropicProvider } from '../providers/anthropic'
import { GeminiProvider } from '../providers/gemini'

/**
 * Limite massimo di righe di diff processabili in una volta.
 * Se il diff supera questo limite, viene lanciato TooLargeError
 * e la sidebar mostra un selettore di file per far scegliere all'utente.
 * Questo evita di mandare prompt enormi all'AI (costoso e lento).
 */
const MAX_DIFF_LINES = 300

/** Opzioni passate dalla sidebar per avviare l'analisi */
export interface AnalyzeOptions {
  adapter: Adapter           // quale piattaforma (GitHub)
  mode: string               // "diff" o "full"
  tone: string               // "balanced", "strict", "security"
  provider: string           // "anthropic" o "gemini"
  apiKey: string             // API key del provider scelto
  onChunk: (text: string) => void  // callback per lo streaming della risposta
  selectedFiles?: string[]   // file scelti dall'utente (se diff troppo grande)
  initialFiles?: DiffFile[]  // file già parsati (riusati dal selettore file)
}

/**
 * Errore speciale lanciato quando il diff è troppo grande.
 * Porta con sé la lista dei file così la sidebar può mostrare
 * il selettore senza dover ri-estrarre il diff.
 */
export class TooLargeError extends Error {
  files: DiffFile[]

  constructor(files: DiffFile[]) {
    super('TOO_LARGE')
    this.files = files
  }
}

/**
 * Factory che crea il provider AI in base al nome.
 * Pattern: FACTORY — nasconde la creazione dell'oggetto concreto.
 * Per aggiungere un provider (es. OpenAI) basta aggiungere un `if` qui.
 */
const createProvider = (provider: string, apiKey: string): Provider => {
  if (provider === 'anthropic') return new AnthropicProvider(apiKey)
  if (provider === 'gemini') return new GeminiProvider(apiKey)
  throw new Error(`Unknown provider: ${provider}`)
}

/**
 * Funzione principale — esegue l'intera pipeline di review.
 * Chiamata dalla sidebar quando l'utente clicca "Analyze PR".
 */
export const analyze = async (options: AnalyzeOptions): Promise<void> => {
  const { adapter, mode, tone, provider, apiKey, onChunk, selectedFiles, initialFiles } = options

  // --- Step 1: Estrai contesto e diff dalla pagina ---
  // extractContext prende titolo/descrizione dal DOM della PR
  const context = adapter.extractContext()

  // Se abbiamo già i file (ripassati dal selettore file), li riusiamo.
  // Altrimenti estraiamo il diff da zero.
  let files = initialFiles

  if (!files) {
    const rawDiffs = await adapter.extractDiff()

    if (rawDiffs.length === 0) {
      throw new Error('No code changes found in this PR.')
    }

    // --- Step 2: Arricchisci i diff con linguaggio e conteggi ---
    files = parseDiff(rawDiffs)
  }

  // --- Step 3: Controlla dimensione ---
  // Se il diff totale supera MAX_DIFF_LINES, lancia TooLargeError.
  // La sidebar lo catcha e mostra il selettore file.
  // Se selectedFiles è presente, l'utente ha già scelto → salta il check.
  const totalLines = files.reduce((sum, f) => sum + f.totalLines, 0)

  if (totalLines > MAX_DIFF_LINES && !selectedFiles) {
    throw new TooLargeError(files)
  }

  // Filtra ai soli file scelti dall'utente (se ha usato il selettore)
  if (selectedFiles) {
    files = files.filter((f) => selectedFiles.includes(f.path))
  }

  // --- Step 3b: Scarica file completi (solo in mode "full") ---
  // Per ogni file nel diff, chiama fetchFullFile in parallelo.
  // Se un file fallisce il fetch (es. repo privata senza token),
  // viene analizzato comunque con il solo diff.
  if (mode === 'full') {
    await Promise.all(
      files.map(async (file) => {
        const result = await adapter.fetchFullFile(file.path)
        if (result.content) {
          file.fullContent = result.content
          file.fullLineCount = result.content.split('\n').length
        }
      })
    )
  }

  // Filtra i file che hanno effettivamente qualcosa da analizzare
  const filesWithChanges = files.filter((file) => {
    return file.additions.length > 0 || file.deletions.length > 0 || (mode === 'full' && file.fullContent)
  })

  if (filesWithChanges.length === 0) {
    if (selectedFiles?.length) {
      throw new Error('The selected files were not found in the extracted diff. Reload the PR page and try again.')
    }
    throw new Error('Could not extract changed lines from the GitHub diff. Reload the PR page and make sure the Files changed tab is visible.')
  }

  // --- Step 4: Costruisci il prompt ---
  const systemPrompt = buildSystemPrompt(tone)
  const userMessage = buildUserMessage(context, filesWithChanges, mode)

  // --- Step 5: Manda all'AI e streama la risposta ---
  // onChunk viene chiamata per ogni pezzo di testo ricevuto,
  // la sidebar lo renderizza in tempo reale come markdown.
  const ai = createProvider(provider, apiKey)
  await ai.stream(systemPrompt, userMessage, onChunk)
}
