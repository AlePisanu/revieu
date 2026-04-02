import { afterEach, describe, expect, it, vi } from 'vitest'
import { analyze, TooLargeError } from '../../src/core/analyzer'
import type { Adapter, DiffFile, RawDiff } from '../../src/types'

const makeRawDiff = (path: string, additions: string[], deletions: string[] = []): RawDiff => ({
  path,
  additions,
  deletions,
})

const makeDiffFile = (path: string, additions: string[], deletions: string[] = []): DiffFile => ({
  path,
  language: 'TypeScript',
  additions,
  deletions,
  fullContent: null,
  fullLineCount: null,
  totalLines: additions.length + deletions.length,
})

const createAdapter = (rawDiffs: RawDiff[]): Adapter => ({
  isMatch: () => true,
  extractContext: () => ({ title: 'Test PR', description: '' }),
  extractDiff: vi.fn().mockResolvedValue(rawDiffs),
  fetchFullFile: vi.fn().mockResolvedValue({ content: null, source: null }),
})

const streamResponse = (): Response => new Response(
  new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode('data: {"type":"content_block_delta","delta":{"text":"review ok"}}\n\ndata: [DONE]\n\n')
      )
      controller.close()
    },
  }),
  { status: 200 }
)

describe('analyze', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('throws TooLargeError before streaming when the diff exceeds the file limit', async () => {
    const adapter = createAdapter([
      makeRawDiff('src/large.ts', Array.from({ length: 301 }, (_, index) => `line ${index + 1}`)),
    ])

    await expect(analyze({
      adapter,
      mode: 'diff',
      tone: 'balanced',
      provider: 'anthropic',
      apiKey: 'test-key',
      onChunk: () => {},
    })).rejects.toBeInstanceOf(TooLargeError)
  })

  it('reuses the initial file list when analyzing selected files', async () => {
    const fetchMock = vi.fn().mockResolvedValue(streamResponse())
    vi.stubGlobal('fetch', fetchMock)

    const adapter = createAdapter([
      makeRawDiff('src/other.ts', ['const other = true']),
    ])

    const initialFiles = [
      makeDiffFile('src/selected.ts', ['const selected = true']),
      makeDiffFile('src/unselected.ts', ['const ignored = true']),
    ]

    const onChunk = vi.fn()

    await analyze({
      adapter,
      mode: 'diff',
      tone: 'balanced',
      provider: 'anthropic',
      apiKey: 'test-key',
      onChunk,
      selectedFiles: ['src/selected.ts'],
      initialFiles,
    })

    expect(adapter.extractDiff).not.toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledTimes(1)

    const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))
    const prompt = String(body.messages?.[0]?.content ?? '')

    expect(prompt).toContain('### src/selected.ts (TypeScript)')
    expect(prompt).not.toContain('src/unselected.ts')
    expect(onChunk).toHaveBeenCalledWith('review ok')
  })
})
