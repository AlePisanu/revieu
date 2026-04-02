import { describe, it, expect } from 'vitest'
import { parseUnifiedDiff } from '../../src/adapters/github'

describe('parseUnifiedDiff', () => {
  it('parses additions and deletions from a GitHub .diff payload', () => {
    const diff = [
      'diff --git a/src/example.ts b/src/example.ts',
      'index 1111111..2222222 100644',
      '--- a/src/example.ts',
      '+++ b/src/example.ts',
      '@@ -1,2 +1,3 @@',
      '-const oldValue = false',
      '+const oldValue = true',
      '+export const active = oldValue',
      ' console.log(oldValue)',
      '',
    ].join('\n')

    const files = parseUnifiedDiff(diff)

    expect(files).toEqual([
      {
        path: 'src/example.ts',
        additions: ['const oldValue = true', 'export const active = oldValue'],
        deletions: ['const oldValue = false'],
      },
    ])
  })

  it('ignores metadata-only sections and files without hunks', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..3333333',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1 @@',
      '+export const created = true',
      'diff --git a/src/empty.ts b/src/empty.ts',
      'index 1111111..2222222 100644',
      '--- a/src/empty.ts',
      '+++ b/src/empty.ts',
      '',
    ].join('\n')

    const files = parseUnifiedDiff(diff)

    expect(files).toEqual([
      {
        path: 'src/new.ts',
        additions: ['export const created = true'],
        deletions: [],
      },
    ])
  })
})
