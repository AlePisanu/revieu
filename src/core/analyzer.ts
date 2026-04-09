import type { Adapter, Provider, DiffFile } from '../types'
import { parseDiff } from './parser'
import { buildSystemPrompt, buildUserMessage } from './prompt'
import { AnthropicProvider } from '../providers/anthropic'
import { GeminiProvider } from '../providers/gemini'

const MAX_DIFF_LINES = 500

export interface AnalyzeOptions {
  adapter: Adapter
  mode: string
  tone: string
  provider: string
  apiKey: string
  anthropicModel?: string
  geminiModel?: string
  onChunk: (text: string) => void
  selectedFiles?: string[]
  initialFiles?: DiffFile[]
}

// Thrown when the diff exceeds MAX_DIFF_LINES.
// Carries the file list so the sidebar can show the selector without re-extracting.
export class TooLargeError extends Error {
  files: DiffFile[]

  constructor(files: DiffFile[]) {
    super('TOO_LARGE')
    this.files = files
  }
}

const createProvider = (provider: string, apiKey: string, anthropicModel?: string, geminiModel?: string): Provider => {
  if (provider === 'anthropic') return new AnthropicProvider(apiKey, anthropicModel)
  if (provider === 'gemini') return new GeminiProvider(apiKey, geminiModel)
  throw new Error(`Unknown provider: ${provider}`)
}

export const analyze = async (options: AnalyzeOptions): Promise<void> => {
  const { adapter, mode, tone, provider, apiKey, onChunk, selectedFiles, initialFiles, anthropicModel, geminiModel } = options

  const context = adapter.extractContext()

  let files = initialFiles

  if (!files) {
    const rawDiffs = await adapter.extractDiff()

    if (rawDiffs.length === 0) {
      throw new Error('No code changes found in this PR.')
    }

    files = parseDiff(rawDiffs)
  }

  const totalLines = files.reduce((sum, f) => sum + f.totalLines, 0)

  if (totalLines > MAX_DIFF_LINES && !selectedFiles) {
    throw new TooLargeError(files)
  }

  if (selectedFiles) {
    files = files.filter((f) => selectedFiles.includes(f.path))
  }

  if (mode === 'full') {
    await Promise.all(
      files.map(async (file) => {
        const result = await adapter.fetchFullFile(file.path)
        if (result.content) {
          file.fullContent = result.content
          file.fullLineCount = result.content.split('\n').length
        }
      })
    )
  }

  const filesWithChanges = files.filter((file) => {
    return file.additions.length > 0 || file.deletions.length > 0 || (mode === 'full' && file.fullContent)
  })

  if (filesWithChanges.length === 0) {
    if (selectedFiles?.length) {
      throw new Error('The selected files were not found in the extracted diff. Reload the PR page and try again.')
    }
    throw new Error('Could not extract changed lines from the GitHub diff. Reload the PR page and make sure the Files changed tab is visible.')
  }

  const systemPrompt = buildSystemPrompt(tone)
  const userMessage = buildUserMessage(context, filesWithChanges, mode)

  const ai = createProvider(provider, apiKey, anthropicModel, geminiModel)
  await ai.stream(systemPrompt, userMessage, onChunk)
}
