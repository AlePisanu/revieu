import { describe, it, expect } from 'vitest'
import { detectLanguage, parseDiff } from '../../src/core/parser'
import type { RawDiff } from '../../src/types'

describe('detectLanguage', () => {
  it('detects TypeScript', () => {
    expect(detectLanguage('src/utils/auth.ts')).toBe('TypeScript')
  })

  it('detects TypeScript React', () => {
    expect(detectLanguage('src/components/Button.tsx')).toBe('TypeScript (React)')
  })

  it('detects JavaScript', () => {
    expect(detectLanguage('build.js')).toBe('JavaScript')
  })

  it('detects Python', () => {
    expect(detectLanguage('scripts/deploy.py')).toBe('Python')
  })

  it('detects Dockerfile by name', () => {
    expect(detectLanguage('Dockerfile')).toBe('Dockerfile')
    expect(detectLanguage('docker/Dockerfile')).toBe('Dockerfile')
  })

  it('returns Unknown for unrecognized extensions', () => {
    expect(detectLanguage('data.xyz')).toBe('Unknown')
  })

  it('returns Unknown for files without extension', () => {
    expect(detectLanguage('Makefile')).toBe('Unknown')
  })

  it('uses last extension for dotted filenames', () => {
    expect(detectLanguage('src/auth.test.ts')).toBe('TypeScript')
  })
})

describe('parseDiff', () => {
  it('transforms RawDiff into DiffFile with language and counts', () => {
    const raw: RawDiff[] = [
      {
        path: 'src/api/auth.ts',
        additions: ['const token = getToken()', 'return token'],
        deletions: ['const token = null'],
      },
    ]

    const result = parseDiff(raw)

    expect(result).toHaveLength(1)
    expect(result[0].path).toBe('src/api/auth.ts')
    expect(result[0].language).toBe('TypeScript')
    expect(result[0].additions).toEqual(['const token = getToken()', 'return token'])
    expect(result[0].deletions).toEqual(['const token = null'])
    expect(result[0].totalLines).toBe(3)
    expect(result[0].fullContent).toBeNull()
    expect(result[0].fullLineCount).toBeNull()
  })

  it('handles multiple files', () => {
    const raw: RawDiff[] = [
      { path: 'src/index.ts', additions: ['line1'], deletions: [] },
      { path: 'src/App.tsx', additions: [], deletions: ['old line'] },
    ]

    const result = parseDiff(raw)

    expect(result).toHaveLength(2)
    expect(result[0].language).toBe('TypeScript')
    expect(result[0].totalLines).toBe(1)
    expect(result[1].language).toBe('TypeScript (React)')
    expect(result[1].totalLines).toBe(1)
  })

  it('includes fullContent when present in RawDiff', () => {
    const raw: RawDiff[] = [
      {
        path: 'src/config.json',
        additions: ['"key": "value"'],
        deletions: [],
        fullContent: '{\n  "key": "value"\n}',
      },
    ]

    const result = parseDiff(raw)

    expect(result[0].fullContent).toBe('{\n  "key": "value"\n}')
    expect(result[0].fullLineCount).toBe(3)
  })

  it('returns empty array for empty input', () => {
    expect(parseDiff([])).toEqual([])
  })
})
