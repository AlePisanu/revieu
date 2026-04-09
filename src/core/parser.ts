import type { RawDiff, DiffFile } from '../types'

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

export const detectLanguage = (filePath: string): string => {
  const basename = filePath.split('/').pop() ?? ''

  if (basename.toLowerCase() === 'dockerfile') return 'Dockerfile'

  const dotIndex = basename.lastIndexOf('.')
  if (dotIndex === -1) return 'Unknown'

  const ext = basename.slice(dotIndex).toLowerCase()
  return LANGUAGE_MAP[ext] ?? 'Unknown'
}

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
