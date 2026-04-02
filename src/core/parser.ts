/**
 * parser.ts — Arricchisce i dati grezzi dell'adapter prima di passarli al prompt.
 *
 * Responsabilità:
 * 1. Rilevare il linguaggio di programmazione dall'estensione del file
 * 2. Trasformare RawDiff[] (dati grezzi) → DiffFile[] (dati arricchiti)
 *
 * Questo file è il secondo step della pipeline:
 *   Adapter → [RawDiff[]] → **parser** → [DiffFile[]] → prompt → AI
 *
 * Perché esiste (e non è nell'adapter):
 * L'adapter si occupa solo di estrarre dati dalla piattaforma (GitHub).
 * Il parser aggiunge informazioni generiche (linguaggio, conteggi) che
 * non dipendono dalla piattaforma — funzionano uguale per GitHub, GitLab, ecc.
 */

import type { RawDiff, DiffFile } from '../types'

/**
 * Mappa estensione file → nome linguaggio leggibile.
 * Usata nel prompt per dire all'AI in che linguaggio è scritto il file,
 * così può applicare regole specifiche (es. pattern React per .tsx).
 */
const LANGUAGE_MAP: Record<string, string> = {
  '.ts': 'TypeScript',
  '.tsx': 'TypeScript (React)',
  '.js': 'JavaScript',
  '.jsx': 'JavaScript (React)',
  '.py': 'Python',
  '.rb': 'Ruby',
  '.go': 'Go',
  '.rs': 'Rust',
  '.java': 'Java',
  '.kt': 'Kotlin',
  '.swift': 'Swift',
  '.cs': 'C#',
  '.cpp': 'C++',
  '.c': 'C',
  '.h': 'C/C++ Header',
  '.php': 'PHP',
  '.html': 'HTML',
  '.css': 'CSS',
  '.scss': 'SCSS',
  '.json': 'JSON',
  '.yaml': 'YAML',
  '.yml': 'YAML',
  '.md': 'Markdown',
  '.sql': 'SQL',
  '.sh': 'Shell',
  '.bash': 'Shell',
  '.dockerfile': 'Dockerfile',
}

/**
 * Rileva il linguaggio di un file dal suo percorso.
 * Gestisce casi speciali come "Dockerfile" (senza estensione).
 * Per file con estensione, prende l'ultima (es. "foo.test.ts" → ".ts").
 */
export const detectLanguage = (filePath: string): string => {
  const basename = filePath.split('/').pop() ?? ''

  // File speciali senza estensione
  if (basename.toLowerCase() === 'dockerfile') return 'Dockerfile'

  // Prendi l'ultima estensione (dopo l'ultimo punto)
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1) return 'Unknown'

  const ext = basename.slice(dotIndex).toLowerCase()
  return LANGUAGE_MAP[ext] ?? 'Unknown'
}

/**
 * Trasforma i dati grezzi dell'adapter in DiffFile arricchiti.
 * Per ogni file aggiunge:
 * - language: linguaggio rilevato dall'estensione
 * - context: righe di contesto (passate direttamente dal RawDiff)
 * - fullContent/fullLineCount: contenuto completo se disponibile
 * - totalLines: somma additions + deletions (per stimare la dimensione)
 */
export const parseDiff = (rawDiffs: RawDiff[]): DiffFile[] => {
  return rawDiffs.map((raw) => ({
    path: raw.path,
    language: detectLanguage(raw.path),
    additions: raw.additions,
    deletions: raw.deletions,
    context: raw.context,
    fullContent: raw.fullContent ?? null,
    fullLineCount: raw.fullContent?.split('\n').length ?? null,
    totalLines: raw.additions.length + raw.deletions.length,
  }))
}
