/**
 * parser.ts — Enriches raw adapter data before passing it to the prompt.
 *
 * Responsibilities:
 * 1. Detect the programming language from the file extension
 * 2. Transform RawDiff[] (raw data) → DiffFile[] (enriched data)
 *
 * This file is the second step in the pipeline:
 *   Adapter → [RawDiff[]] → **parser** → [DiffFile[]] → prompt → AI
 *
 * Why it exists (and isn't in the adapter):
 * The adapter only handles extracting data from the platform (GitHub).
 * The parser adds generic information (language, counts) that
 * doesn't depend on the platform — works the same for GitHub, GitLab, etc.
 */

import type { RawDiff, DiffFile } from '../types'

/**
 * Map of file extension → readable language name.
 * Used in the prompt to tell the AI what language the file is written in,
 * so it can apply language-specific rules (e.g. React patterns for .tsx).
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
 * Detects the language of a file from its path.
 * Handles special cases like "Dockerfile" (no extension).
 * For files with an extension, takes the last one (e.g. "foo.test.ts" → ".ts").
 */
export const detectLanguage = (filePath: string): string => {
  const basename = filePath.split('/').pop() ?? ''

  // Special files without an extension
  if (basename.toLowerCase() === 'dockerfile') return 'Dockerfile'

  // Take the last extension (after the last dot)
  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1) return 'Unknown'

  const ext = basename.slice(dotIndex).toLowerCase()
  return LANGUAGE_MAP[ext] ?? 'Unknown'
}

/**
 * Transforms raw adapter data into enriched DiffFiles.
 * For each file adds:
 * - language: detected from the file extension
 * - context: context lines (passed directly from RawDiff)
 * - fullContent/fullLineCount: full content if available
 * - totalLines: sum of additions + deletions (to estimate diff size)
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
    rawLines: raw.rawLines,
  }))
}
