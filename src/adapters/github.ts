/**
 * github.ts — Adapter per GitHub. Implementa l'interfaccia Adapter.
 *
 * Responsabilità:
 * 1. Riconoscere se l'URL corrente è una PR GitHub (isMatch)
 * 2. Estrarre titolo/descrizione della PR dal DOM (extractContext)
 * 3. Estrarre il diff dei file modificati (extractDiff)
 * 4. Scaricare il contenuto completo di un file (fetchFullFile)
 *
 * Pattern: ADAPTER
 * Traduce i dettagli specifici di GitHub (DOM, .diff URL, API) in RawDiff[],
 * il formato standard che il resto dell'app capisce.
 *
 * Strategia per il diff (extractDiff):
 * 1. Prima prova: scarica il .diff unificato dalla URL della PR (es. /pull/42.diff)
 *    → Affidabile, contiene context lines, non dipende dal DOM
 * 2. Fallback: scraping del DOM della pagina (extractDiffFromDom)
 *    → Meno affidabile (i selettori CSS cambiano), no context lines,
 *      ma funziona se il .diff non è disponibile
 */

import type { Adapter, RawDiff } from '../types'

// ===========================================================================
// SEZIONE DOM SCRAPING (fallback) — usata solo se il .diff non è disponibile
// ===========================================================================

/**
 * Normalizza una riga di testo estratta dal DOM.
 * - Sostituisce i non-breaking space (\u00a0) con spazi normali
 *   (GitHub li usa nel rendering del diff)
 * - Rimuove i carriage return (\r) per uniformità
 * - Toglie gli spazi finali
 */
const normalizeDiffLine = (value: string | null | undefined): string => {
  if (!value) return ''
  return value.replace(/\u00a0/g, ' ').replace(/\r/g, '').trimEnd()
}

/**
 * Estrae il testo del codice da una cella del diff nel DOM.
 * GitHub ha cambiato la struttura HTML più volte, quindi proviamo
 * diversi selettori in ordine di priorità.
 * Se nessun selettore matcha, fallback su innerText/textContent dell'elemento.
 */
const getCodeText = (element: ParentNode): string => {
  const selectors = [
    '.diff-text',        // UI più vecchia
    '.diff-text-inner',  // variante
    '.blob-code-inner',  // UI classica
    '.react-code-text',  // UI React (nuova)
    'code',              // fallback generico
  ]

  for (const selector of selectors) {
    const candidate = element.querySelector(selector)
    const text = normalizeDiffLine(candidate?.textContent)
    if (text) return text
  }

  if (element instanceof HTMLElement) {
    return normalizeDiffLine(element.innerText || element.textContent)
  }

  return normalizeDiffLine(element.textContent)
}

/**
 * Scansiona il DOM di un file nel diff e raccoglie le righe aggiunte/rimosse.
 * Prova due strategie:
 * 1. Cerca nelle righe <tr> le celle con marcatore +/- (UI tabellare)
 * 2. Se non trova nulla, cerca direttamente le celle con classi blob-code-*
 */
const collectChangedLinesFromDom = (fileWrapper: ParentNode): { additions: string[]; deletions: string[] } => {
  const additions: string[] = []
  const deletions: string[] = []

  // Strategia 1: tabella con righe <tr>, ogni riga ha celle addition/deletion
  fileWrapper.querySelectorAll('tr').forEach((row) => {
    const additionCell = row.querySelector<HTMLElement>('td.blob-code-addition, td[data-code-marker="+"]')
    const deletionCell = row.querySelector<HTMLElement>('td.blob-code-deletion, td[data-code-marker="-"]')

    if (additionCell) {
      const text = getCodeText(additionCell)
      if (text) additions.push(text)
    }

    if (deletionCell) {
      const text = getCodeText(deletionCell)
      if (text) deletions.push(text)
    }
  })

  // Se la strategia 1 ha trovato qualcosa, ritorna subito
  if (additions.length > 0 || deletions.length > 0) {
    return { additions, deletions }
  }

  // Strategia 2: cerca direttamente le celle con classi blob-code-*
  fileWrapper.querySelectorAll<HTMLElement>('.blob-code-addition, .blob-code-deletion').forEach((cell) => {
    const text = getCodeText(cell)
    if (!text) return

    if (cell.classList.contains('blob-code-addition')) additions.push(text)
    if (cell.classList.contains('blob-code-deletion')) deletions.push(text)
  })

  return { additions, deletions }
}

// ===========================================================================
// PARSER DEL DIFF UNIFICATO — approccio principale e più affidabile
// ===========================================================================

/**
 * Parsa una stringa di diff unificato (scaricata da GitHub /pull/N.diff)
 * e la trasforma in un array di RawDiff.
 *
 * Formato del diff unificato:
 * ```
 * diff --git a/file.ts b/file.ts       ← inizio di un nuovo file
 * --- a/file.ts                         ← file originale
 * +++ b/file.ts                         ← file modificato (da qui prendiamo il path)
 * @@ -10,7 +10,9 @@ function foo() {   ← inizio hunk (blocco di modifiche)
 *  riga di contesto (spazio iniziale)   ← codice invariato attorno alle modifiche
 * +riga aggiunta                        ← addition
 * -riga rimossa                         ← deletion
 * ```
 *
 * Il parser è una macchina a stati semplice:
 * - `current`: il RawDiff del file che stiamo processando (null tra un file e l'altro)
 * - `inHunk`: true quando siamo dentro un blocco @@ (righe di codice)
 */
export const parseUnifiedDiff = (diffText: string): RawDiff[] => {
  const files: RawDiff[] = []
  const lines = diffText.replace(/\r/g, '').split('\n')
  let current: RawDiff | null = null
  let inHunk = false

  /** Salva il file corrente nell'array e resetta lo stato */
  const pushCurrent = (): void => {
    if (!current) return
    files.push(current)
    current = null
    inHunk = false
  }

  for (const line of lines) {
    // "diff --git" segna l'inizio di un nuovo file → salva il precedente
    if (line.startsWith('diff --git ')) {
      pushCurrent()
      continue
    }

    // "+++ b/path/to/file" → estrai il percorso del file modificato
    if (line.startsWith('+++ ')) {
      const rawPath = line.slice(4).trim()
      // Il path ha il prefisso "b/" nel diff unificato → lo rimuoviamo
      const path = rawPath.startsWith('b/') ? rawPath.slice(2) : rawPath

      // I file cancellati puntano a /dev/null → li ignoriamo
      if (path === '/dev/null') {
        current = null
        inHunk = false
        continue
      }

      current = current ?? { path, additions: [], deletions: [], context: [] }
      current.path = path
      continue
    }

    if (!current) continue

    // "@@ -10,7 +10,9 @@" → inizio di un hunk (blocco di modifiche)
    if (line.startsWith('@@ ')) {
      inHunk = true
      continue
    }

    // Fuori dagli hunk non ci sono righe di codice
    if (!inHunk) continue
    // Ignora il marker di fine file senza newline
    if (line.startsWith('\\ No newline at end of file')) continue

    // Il primo carattere di ogni riga indica il tipo:
    // '+' = aggiunta, '-' = rimozione, ' ' = contesto (invariato)
    const marker = line[0]
    const content = line.slice(1)

    if (marker === '+') {
      current.additions.push(content)
    } else if (marker === '-') {
      current.deletions.push(content)
    } else if (marker === ' ') {
      current.context.push(content)
    }
  }

  // Non dimenticare l'ultimo file
  pushCurrent()

  // Ritorna solo i file che hanno effettivamente delle modifiche
  return files.filter((file) => file.path && (file.additions.length > 0 || file.deletions.length > 0))
}

// ===========================================================================
// GITHUB ADAPTER — implementazione dell'interfaccia Adapter per GitHub
// ===========================================================================

export class GitHubAdapter implements Adapter {

  /**
   * Controlla se l'URL è una PR GitHub.
   * Formato atteso: https://github.com/{owner}/{repo}/pull/{number}
   * Verifica hostname + struttura del path.
   */
  isMatch(url: string): boolean {
    try {
      const parsed = new URL(url)

      if (parsed.hostname !== 'github.com') {
        return false
      }

      // Split del path: ["owner", "repo", "pull", "123", ...]
      const parts = parsed.pathname.split('/').filter(Boolean)

      return parts.length >= 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3])
    } catch {
      return false
    }
  }

  /**
   * Estrae titolo e descrizione della PR dal DOM della pagina.
   * I selettori usati sono quelli della UI corrente di GitHub:
   * - .markdown-title → titolo della PR
   * - .comment-body → primo commento = descrizione della PR
   */
  extractContext(): { title: string; description: string } {
    const titleEl = document.querySelector('.markdown-title')
    const title = titleEl?.textContent?.trim() ?? ''

    const descriptionEl = document.querySelector('.comment-body')
    const description = descriptionEl?.textContent?.trim() ?? ''

    return { title, description }
  }

  /**
   * Fallback DOM: estrae i diff direttamente dal HTML della pagina.
   * Usato solo se il .diff non è disponibile.
   * Non cattura context lines (solo il diff unificato le ha).
   */
  private extractDiffFromDom(): RawDiff[] {
    const files: RawDiff[] = []
    const seenPaths = new Set<string>() // evita duplicati
    const fileHeaders = document.querySelectorAll<HTMLElement>('[data-file-path], [data-path]')

    for (const header of fileHeaders) {
      const path = header.getAttribute('data-file-path') ?? header.getAttribute('data-path')
      if (!path || seenPaths.has(path)) continue

      // Risali nel DOM per trovare il contenitore del file intero
      const fileWrapper =
        header.closest('[data-file-path]') ??
        header.closest('[data-path]') ??
        header.closest('.file') ??
        header.closest('[id^="diff-"]') ??
        header.parentElement

      if (!fileWrapper) continue

      const { additions, deletions } = collectChangedLinesFromDom(fileWrapper)
      if (additions.length === 0 && deletions.length === 0) continue

      seenPaths.add(path)
      files.push({ path, additions, deletions, context: [] })
    }

    return files
  }

  /**
   * Scarica il diff unificato dalla URL .diff della PR.
   * Es: https://github.com/owner/repo/pull/42.diff
   * Il fetch passa dal background script per evitare restrizioni CORS.
   */
  async fetchUnifiedDiff(): Promise<string | null> {
    try {
      const url = new URL(window.location.href)
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
      if (!match) return null

      const [, owner, repo, pr] = match
      const diffUrl = `https://github.com/${owner}/${repo}/pull/${pr}.diff`

      const response: {
        ok: boolean
        status: number
        text?: string
        error?: string
      } = await chrome.runtime.sendMessage({
        type: 'FETCH_GITHUB_DIFF',
        payload: { url: diffUrl },
      })

      if (!response?.ok || !response.text) return null

      return response.text
    } catch {
      return null
    }
  }

  /**
   * Estrae i diff: prima prova il .diff (affidabile), poi fallback sul DOM.
   * Questa è la funzione chiamata dall'analyzer.
   */
  async extractDiff(): Promise<RawDiff[]> {
    // Tentativo 1: diff unificato (preferito — ha context lines)
    const diffText = await this.fetchUnifiedDiff()

    if (diffText) {
      const parsed = parseUnifiedDiff(diffText)
      if (parsed.length > 0) return parsed
    }

    // Tentativo 2: fallback sul DOM (niente context lines)
    return this.extractDiffFromDom()
  }

  /**
   * Estrae owner, repo e numero PR dalla URL corrente.
   * Es: /facebook/react/pull/42 → { owner: "facebook", repo: "react", pr: "42" }
   */
  private getPrInfo(): { owner: string; repo: string; pr: string } | null {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2], pr: match[3] }
  }

  /**
   * Scarica il contenuto completo di un file dalla PR (mode "Full context").
   *
   * Come funziona:
   * 1. Costruisce la URL dell'API GitHub Contents:
   *    https://api.github.com/repos/{owner}/{repo}/contents/{path}?ref=pull/{pr}/head
   * 2. Il ref "pull/{number}/head" è un ref Git speciale di GitHub che punta
   *    sempre all'ultimo commit della PR — non serve conoscere il nome del branch
   * 3. Il fetch passa dal background script (evita CORS)
   * 4. Se c'è un GitHub token in storage, lo include nell'header Authorization
   *    (necessario per repo private, opzionale per pubbliche)
   *
   * Se il fetch fallisce (repo privata senza token, file non trovato, ecc.)
   * ritorna { content: null } e l'analyzer continuerà con il solo diff.
   */
  async fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }> {
    try {
      const prInfo = this.getPrInfo()
      if (!prInfo) return { content: null, source: null }

      const { owner, repo, pr } = prInfo
      const ref = `pull/${pr}/head`
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${ref}`

      // Legge il token GitHub dallo storage (può essere vuoto)
      const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
      const token = settings?.githubToken || ''

      const response: {
        ok: boolean
        status: number
        text?: string
        error?: string
      } = await chrome.runtime.sendMessage({
        type: 'FETCH_GITHUB_FILE',
        payload: { url: apiUrl, token },
      })

      if (!response?.ok || !response.text) return { content: null, source: null }

      return { content: response.text, source: 'api' }
    } catch {
      return { content: null, source: null }
    }
  }
}
