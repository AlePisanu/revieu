import { describe, it, expect } from 'vitest'
import { buildUserMessage } from '../../src/core/prompt'
import type { DiffFile } from '../../src/types'

const makeFile = (overrides: Partial<DiffFile>): DiffFile => ({
  path: 'src/example.ts',
  language: 'TypeScript',
  additions: [],
  deletions: [],
  fullContent: null,
  fullLineCount: null,
  totalLines: 0,
  ...overrides,
})

describe('buildUserMessage', () => {
  it('excludes files without extracted changes in diff mode', () => {
    const message = buildUserMessage(
      { title: 'Test PR', description: '' },
      [
        makeFile({ path: 'empty.ts' }),
        makeFile({ path: 'real.ts', additions: ['const active = true'], totalLines: 1 }),
      ],
      'diff'
    )

    expect(message).toContain('### real.ts (TypeScript)')
    expect(message).toContain('+ const active = true')
    expect(message).not.toContain('### empty.ts (TypeScript)')
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
