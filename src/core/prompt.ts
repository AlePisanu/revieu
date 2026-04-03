/**
 * prompt.ts — Costruisce i messaggi da mandare all'AI.
 *
 * Responsabilità:
 * 1. buildSystemPrompt: crea le istruzioni di sistema (chi sei, come rispondere, formato)
 * 2. buildUserMessage: assembla il messaggio utente con diff, contesto, e file completi
 *
 * Questo file è il penultimo step della pipeline:
 *   Adapter → parser → analyzer → **prompt** → [system + user message] → AI provider
 *
 * Pattern: TEMPLATE / BUILDER
 * Il prompt è costruito assemblando blocchi (titolo PR, context lines, diff, file completi)
 * in un formato testuale strutturato che l'AI sa interpretare.
 * Ogni blocco è opzionale — il prompt si adatta a ciò che è disponibile.
 */

import type { DiffFile } from '../types'

// ---------------------------------------------------------------------------
// SYSTEM PROMPT: istruzioni per l'AI su come comportarsi
// ---------------------------------------------------------------------------

/**
 * Prompt base che definisce il ruolo dell'AI e il formato di output.
 * Le sezioni 🔴/🟡/🟢 forzano una risposta strutturata e facile da leggere.
 * "&#58;" è l'HTML entity per ":" — evita che l'AI interpreti i due punti
 * come parte della formattazione markdown.
 */
const BASE_SYSTEM_PROMPT = `
You are a senior software engineer reviewing a pull request.

Your goal is to find real issues, not to be polite.

Focus on:
- correctness
- bugs and edge cases
- unintended side effects
- architecture/design issues

Pay attention to the fact that the diff has - for deletion and + for addition, check everytime that duplicates are correct and not false positives.

Rules:
- Be concise and direct
- No greetings or filler text
- Do NOT explain your reasoning
- Only report meaningful issues (avoid trivial style comments)

Output format (strict):

## 🔴 Critical
- [file]&#58; issue + short explanation

## 🟡 Improvements
- [file]&#58; suggestion

## 🟢 Minor
- optional small notes

If no issues, say: "No significant issues found."

Keep reasoning minimal. Do not over-analyze.
`

/**
 * Modificatori di tono — appenditi al system prompt in base alla scelta dell'utente.
 * - balanced: nessuna modifica (tono neutro)
 * - strict: l'AI diventa più aggressiva nel cercare problemi
 * - security: l'AI si concentra su vulnerabilità di sicurezza
 */
const TONE_MODIFIERS: Record<string, string> = {
  balanced: '',
  strict: 'Be extremely critical. Assume bugs exist.',
  security: 'Focus on security vulnerabilities, unsafe data handling, and access control.',
}

/** Combina il prompt base con il modificatore di tono scelto dall'utente */
export const buildSystemPrompt = (tone: string): string => {
  const modifier = TONE_MODIFIERS[tone] ?? ''
  return modifier ? `${BASE_SYSTEM_PROMPT}\n${modifier}` : BASE_SYSTEM_PROMPT
}

// ---------------------------------------------------------------------------
// USER MESSAGE: il contenuto della PR formattato per l'AI
// ---------------------------------------------------------------------------

/**
 * Assembla il messaggio utente con tutti i dati della PR.
 *
 * Il messaggio ha questa struttura:
 * 1. Istruzioni — spiega all'AI la notazione (+/-/spazio)
 * 2. Titolo e descrizione della PR — contesto ad alto livello
 * 3. Dependency map (opzionale) — chi importa da chi (per feature futura)
 * 4. Per ogni file:
 *    a. File completo (solo in mode "full" se disponibile)
 *    b. Context lines — codice invariato attorno alle modifiche
 *    c. Modified lines — additions (+) e deletions (-)
 *
 * @param context - titolo e descrizione della PR (da adapter.extractContext)
 * @param files - i file arricchiti dal parser
 * @param mode - "diff" (solo modifiche) o "full" (file completo + modifiche)
 * @param depMap - mappa delle dipendenze tra file (opzionale, per uso futuro)
 */
export const buildUserMessage = (
  context: { title: string; description: string },
  files: DiffFile[],
  mode: string,
  depMap?: Record<string, string[]>
): string => {
  const parts: string[] = []

  // Istruzioni per l'AI sulla notazione usata nel diff
  parts.push(`
    Instructions:
    - Lines starting with "+" are additions
    - Lines starting with "-" are removals
    - Lines starting with " " (space) are unchanged context surrounding the changes
    - Use context lines to understand the surrounding code before flagging issues
    - Focus on added code unless removals introduce issues
  `)

  // Titolo e descrizione della PR — danno all'AI il "perché" delle modifiche
  parts.push(`## PR: ${context.title}`)
  if (context.description) {
    parts.push(`**Description:** ${context.description}`)
  }

  // Mappa delle dipendenze (es. "file A importa da file B")
  // Non ancora popolata — predisposta per una feature futura
  if (depMap && Object.keys(depMap).length > 0) {
    parts.push('\n## Dependency map')
    for (const [file, deps] of Object.entries(depMap)) {
      for (const dep of deps) {
        parts.push(`- ${file} imports from ${dep}`)
      }
    }
  }

  // Sezione principale: i file modificati
  parts.push('\n## Changes')

  for (const file of files) {
    parts.push(`\n### ${file.path} (${file.language})`)

    // In mode "full", se il file completo è disponibile, lo includiamo.
    // Questo dà all'AI il contesto dell'intero file (non solo gli hunk).
    if (mode === 'full' && file.fullContent) {
      parts.push('**Full file:**')
      parts.push('```')
      parts.push(file.fullContent)
      parts.push('```')
    }

    // Context lines: codice invariato attorno alle modifiche (~3 righe per hunk).
    // Presente anche in mode "diff" — viene dal diff unificato gratis.
    parts.push('**Diff:**')
    for (const line of file.rawLines) {
      parts.push(line)
    }
  }

  return parts.join('\n')
}
