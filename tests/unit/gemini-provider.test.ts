import { afterEach, describe, expect, it, vi } from 'vitest'
import { GeminiProvider } from '../../src/providers/gemini'

const streamResponse = (text: string): Response => new Response(
  new ReadableStream({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: {"candidates":[{"content":{"parts":[{"text":"${text}"}]}}]}\n\ndata: [DONE]\n\n`)
      )
      controller.close()
    },
  }),
  { status: 200 }
)

describe('GeminiProvider', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('retries 429 responses and eventually streams the result', async () => {
    vi.useFakeTimers()

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(new Response('', { status: 429, headers: { 'retry-after': '1' } }))
      .mockResolvedValueOnce(streamResponse('ok'))

    vi.stubGlobal('fetch', fetchMock)

    const provider = new GeminiProvider('test-key')
    const onChunk = vi.fn()

    const streamPromise = provider.stream('system', 'user', onChunk)

    await vi.runAllTimersAsync()
    await streamPromise

    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(onChunk).toHaveBeenCalledWith('ok')
  })
})
