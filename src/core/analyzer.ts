/**
 * analyzer.ts — Main review orchestrator.
 *
 * This is the "conductor" that coordinates all other modules.
 * It contains no specific business logic — it calls other modules
 * in the right order and handles edge cases (diff too large, no files, etc.)
 *
 * Full flow (5 steps):
 * 1. Extract context (title/description) and diff from the page → adapter
 * 2. Enrich the diffs (language, counts) → parser
 * 3. Check size and filter files → internal logic
 * 3b. If "full" mode, download complete files → adapter.fetchFullFile
 * 4. Build the prompt → prompt.ts
 * 5. Send to AI and stream the response → provider
 *
 * Pattern: FACADE
 * The sidebar only calls `analyze(options)` — it doesn't need to know
 * about adapter, parser, prompt, provider. All complexity is encapsulated here.
 */

import type { Adapter, Provider, DiffFile } from '../types'
import { parseDiff } from './parser'
import { buildSystemPrompt, buildUserMessage } from './prompt'
import { AnthropicProvider } from '../providers/anthropic'
import { GeminiProvider } from '../providers/gemini'

/**
 * Maximum number of diff lines processable at once.
 * If the diff exceeds this limit, TooLargeError is thrown
 * and the sidebar shows a file selector for the user to choose from.
 * This prevents sending huge prompts to the AI (expensive and slow).
 */
const MAX_DIFF_LINES = 300

/** Options passed from the sidebar to start the analysis */
export interface AnalyzeOptions {
  adapter: Adapter           // which platform (GitHub)
  mode: string               // "diff" or "full"
  tone: string               // "balanced", "strict", "security"
  provider: string           // "anthropic" or "gemini"
  apiKey: string             // API key for the selected provider
  anthropicModel?: string    // Claude model variant (e.g. "claude-haiku-4-5")
  geminiModel?: string       // Gemini model variant (e.g. "gemini-2.5-flash-lite")
  onChunk: (text: string) => void  // callback for response streaming
  selectedFiles?: string[]   // files chosen by the user (if diff too large)
  initialFiles?: DiffFile[]  // already-parsed files (reused from file selector)
}

/**
 * Special error thrown when the diff is too large.
 * Carries the file list so the sidebar can show the selector
 * without having to re-extract the diff.
 */
export class TooLargeError extends Error {
  files: DiffFile[]

  constructor(files: DiffFile[]) {
    super('TOO_LARGE')
    this.files = files
  }
}

/**
 * Factory that creates the AI provider by name.
 * Pattern: FACTORY — hides the concrete object creation.
 * To add a provider (e.g. OpenAI) just add an `if` here.
 */
const createProvider = (provider: string, apiKey: string, anthropicModel?: string, geminiModel?: string): Provider => {
  if (provider === 'anthropic') return new AnthropicProvider(apiKey, anthropicModel)
  if (provider === 'gemini') return new GeminiProvider(apiKey, geminiModel)
  throw new Error(`Unknown provider: ${provider}`)
}

/**
 * Main function — executes the entire review pipeline.
 * Called by the sidebar when the user clicks "Analyze PR".
 */
export const analyze = async (options: AnalyzeOptions): Promise<void> => {
  const { adapter, mode, tone, provider, apiKey, onChunk, selectedFiles, initialFiles, anthropicModel, geminiModel } = options

  // --- Step 1: Extract context and diff from the page ---
  // extractContext gets title/description from the PR DOM
  const context = adapter.extractContext()

  // If we already have files (passed from the file selector), reuse them.
  // Otherwise extract the diff from scratch.
  let files = initialFiles

  if (!files) {
    const rawDiffs = await adapter.extractDiff()

    if (rawDiffs.length === 0) {
      throw new Error('No code changes found in this PR.')
    }

    // --- Step 2: Enrich diffs with language and counts ---
    files = parseDiff(rawDiffs)
  }

  // --- Step 3: Check size ---
  // If total diff exceeds MAX_DIFF_LINES, throw TooLargeError.
  // The sidebar catches it and shows the file selector.
  // If selectedFiles is present, the user already chose → skip check.
  const totalLines = files.reduce((sum, f) => sum + f.totalLines, 0)

  if (totalLines > MAX_DIFF_LINES && !selectedFiles) {
    throw new TooLargeError(files)
  }

  // Filter to only files chosen by the user (if they used the selector)
  if (selectedFiles) {
    files = files.filter((f) => selectedFiles.includes(f.path))
  }

  // --- Step 3b: Download complete files (only in "full" mode) ---
  // For each file in the diff, call fetchFullFile in parallel.
  // If a file fails to fetch (e.g. private repo without token),
  // it's still analyzed with just the diff.
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

  // Filter files that actually have something to analyze
  const filesWithChanges = files.filter((file) => {
    return file.additions.length > 0 || file.deletions.length > 0 || (mode === 'full' && file.fullContent)
  })

  if (filesWithChanges.length === 0) {
    if (selectedFiles?.length) {
      throw new Error('The selected files were not found in the extracted diff. Reload the PR page and try again.')
    }
    throw new Error('Could not extract changed lines from the GitHub diff. Reload the PR page and make sure the Files changed tab is visible.')
  }

  // --- Step 4: Build the prompt ---
  const systemPrompt = buildSystemPrompt(tone)
  const userMessage = buildUserMessage(context, filesWithChanges, mode)

  // --- Step 5: Send to AI and stream the response ---
  // onChunk is called for each piece of text received,
  // the sidebar renders it in real time as markdown.
  const ai = createProvider(provider, apiKey, anthropicModel, geminiModel)
  await ai.stream(systemPrompt, userMessage, onChunk)
}
