/**
 * types.ts — Shared contracts between all extension modules.
 *
 * Pattern: DEPENDENCY INVERSION
 * No module imports a concrete implementation (e.g. GitHubAdapter).
 * All depend on these interfaces. This allows:
 * - Adding new adapters (e.g. GitLab) without touching analyzer/prompt/sidebar
 * - Testing each module in isolation with mocks implementing the interface
 *
 * Data flow follows this pipeline:
 *   Adapter.extractDiff() → RawDiff[] → parser.parseDiff() → DiffFile[] → prompt → AI
 */

// ---------------------------------------------------------------------------
// DATA: structures that travel through the pipeline
// ---------------------------------------------------------------------------

/**
 * RawDiff — raw data extracted by the adapter (e.g. from GitHub's .diff).
 * Does not yet have derived information like the language.
 * This is the "intermediate" format between the source (GitHub) and our parser.
 */
export interface RawDiff {
  /** File path in the repo (e.g. "src/core/parser.ts") */
  path: string

  /** Added lines (those with "+" in the diff) */
  additions: string[]

  /** Removed lines (those with "-" in the diff) */
  deletions: string[]

  /**
   * Context lines — unchanged code surrounding the modifications.
   * GitHub includes ~3 lines before and after each hunk in the unified diff.
   * These help the AI understand what's around the changed code
   * and reduce false positives in the review.
   */
  context: string[]

  /**
   * Full file content (optional).
   * Only populated in "full" mode when fetching the entire file via API.
   */
  fullContent?: string

  rawLines: string[]
}

/**
 * DiffFile — "enriched" version of RawDiff, ready for prompt building.
 * The parser adds derived information like language and line counts.
 */
export interface DiffFile {
  path: string
  /** Language detected from the file extension (e.g. "TypeScript", "Python") */
  language: string
  additions: string[]
  deletions: string[]
  context: string[]
  /** Full file content, null if not available */
  fullContent: string | null
  /** Line count of the full file, null if fullContent is not available */
  fullLineCount: number | null
  /** Sum of additions + deletions — used to estimate diff size */
  totalLines: number
  rawLines: string[]
}

// ---------------------------------------------------------------------------
// PROVIDER: interface for AI services (Claude, Gemini, etc.)
// ---------------------------------------------------------------------------

/**
 * Provider — contract that every AI service must implement.
 *
 * Pattern: STRATEGY
 * The analyzer doesn't know if it's talking to Claude or Gemini.
 * It only calls `stream()` and receives text chunks via callback.
 * To add a new provider (e.g. OpenAI) just create a new class
 * implementing this interface.
 */
export interface Provider {
  /**
   * Sends the prompt to the AI and streams the response chunk by chunk.
   * @param systemPrompt - system instructions (tone, output format)
   * @param userMessage - message with the diff and PR context
   * @param onChunk - callback called for each piece of text received
   */
  stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// ADAPTER: interface for platforms (GitHub, GitLab, etc.)
// ---------------------------------------------------------------------------

/**
 * Adapter — contract that every platform must implement.
 *
 * Pattern: ADAPTER (hence the name)
 * Translates platform-specific details (GitHub DOM, API, etc.)
 * into a standard format the rest of the app understands (RawDiff[]).
 * To support GitLab, just create a GitLabAdapter implementing
 * this interface — all other code stays the same.
 */
export interface Adapter {
  /** Checks if the current URL is a PR on this platform */
  isMatch(url: string): boolean

  /** Extracts the PR title and description from the page */
  extractContext(): { title: string; description: string }

  /** Extracts diffs of all modified files in the PR */
  extractDiff(): Promise<RawDiff[]>

  /**
   * Downloads the full content of a file from the PR.
   * Used in "full" mode to give the AI the entire file context.
   * @returns content: the file text, source: where it was downloaded from
   */
  fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }>
}
