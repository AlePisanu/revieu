import { describe, it, expect } from 'vitest'
import { buildUserMessage } from '../../src/core/prompt'
import type { DiffFile } from '../../src/types'

const makeFile = (overrides: Partial<DiffFile>): DiffFile => ({
  path: 'src/example.ts',
  language: 'TypeScript',
  additions: [],
  deletions: [],
  context: [],
  rawLines: [],
  fullContent: null,
  fullLineCount: null,
  totalLines: 0,
  ...overrides,
})

describe('buildUserMessage', () => {
  it('includes diff lines from rawLines in diff mode', () => {
    const message = buildUserMessage(
      { title: 'Test PR', description: '' },
      [
        makeFile({
          path: 'real.ts',
          additions: ['const active = true'],
          rawLines: ['+const active = true'],
          totalLines: 1,
        }),
      ],
      'diff'
    )

    expect(message).toContain('### real.ts (TypeScript)')
    expect(message).toContain('+const active = true')
  })

  it('keeps full files in full mode even when the diff arrays are empty', () => {
    const message = buildUserMessage(
      { title: 'Full context PR', description: '' },
      [
        makeFile({
          path: 'context.ts',
          fullContent: 'export const value = 1',
          fullLineCount: 1,
        }),
      ],
      'full'
    )

    expect(message).toContain('### context.ts (TypeScript)')
    expect(message).toContain('**Full file:**')
    expect(message).toContain('export const value = 1')
  })
})
