/**
 * github.ts — GitHub adapter. Implements the Adapter interface.
 *
 * Responsibilities:
 * 1. Recognize if the current URL is a GitHub PR (isMatch)
 * 2. Extract PR title/description from the DOM (extractContext)
 * 3. Extract the diff of modified files (extractDiff)
 * 4. Download the full content of a file (fetchFullFile)
 *
 * Pattern: ADAPTER
 * Translates GitHub-specific details (DOM, .diff URL, API) into RawDiff[],
 * the standard format the rest of the app understands.
 *
 * Diff extraction strategy (extractDiff):
 * 1. First try: download the unified .diff from the PR URL (e.g. /pull/42.diff)
 *    → Reliable, contains context lines, doesn't depend on the DOM
 * 2. Fallback: DOM scraping of the page (extractDiffFromDom)
 *    → Less reliable (CSS selectors change), no context lines,
 *      but works if the .diff is unavailable
 */

import type { Adapter, RawDiff } from '../types'

// ===========================================================================
// DOM SCRAPING SECTION (fallback) — used only if .diff is unavailable
// ===========================================================================

/**
 * Normalizes a text line extracted from the DOM.
 * - Replaces non-breaking spaces (\u00a0) with regular spaces
 *   (GitHub uses them in diff rendering)
 * - Removes carriage returns (\r) for consistency
 * - Trims trailing whitespace
 */
const normalizeDiffLine = (value: string | null | undefined): string => {
  if (!value) return ''
  return value.replace(/\u00a0/g, ' ').replace(/\r/g, '').trimEnd()
}

/**
 * Extracts code text from a diff cell in the DOM.
 * GitHub has changed the HTML structure multiple times, so we try
 * different selectors in priority order.
 * If no selector matches, falls back to innerText/textContent of the element.
 */
const getCodeText = (element: ParentNode): string => {
  const selectors = [
    '.diff-text',        // Older UI
    '.diff-text-inner',  // Variant
    '.blob-code-inner',  // Classic UI
    '.react-code-text',  // React UI (new)
    'code',              // Generic fallback
  ]

  for (const selector of selectors) {
    const candidate = element.querySelector(selector)
    const text = normalizeDiffLine(candidate?.textContent)
    if (text) return text
  }

  if (element instanceof HTMLElement) {
    return normalizeDiffLine(element.innerText || element.textContent)
  }

  return normalizeDiffLine(element.textContent)
}

/**
 * Scans a file's DOM in the diff and collects added/removed lines.
 * Tries two strategies:
 * 1. Looks in <tr> rows for cells with +/- markers (tabular UI)
 * 2. If nothing found, directly looks for cells with blob-code-* classes
 */
const collectChangedLinesFromDom = (fileWrapper: ParentNode): { additions: string[]; deletions: string[] } => {
  const additions: string[] = []
  const deletions: string[] = []

  // Strategy 1: table with <tr> rows, each row has addition/deletion cells
  fileWrapper.querySelectorAll('tr').forEach((row) => {
    const additionCell = row.querySelector<HTMLElement>('td.blob-code-addition, td[data-code-marker="+"]')
    const deletionCell = row.querySelector<HTMLElement>('td.blob-code-deletion, td[data-code-marker="-"]')

    if (additionCell) {
      const text = getCodeText(additionCell)
      if (text) additions.push(text)
    }

    if (deletionCell) {
      const text = getCodeText(deletionCell)
      if (text) deletions.push(text)
    }
  })

  // If strategy 1 found something, return immediately
  if (additions.length > 0 || deletions.length > 0) {
    return { additions, deletions }
  }

  // Strategy 2: directly look for cells with blob-code-* classes
  fileWrapper.querySelectorAll<HTMLElement>('.blob-code-addition, .blob-code-deletion').forEach((cell) => {
    const text = getCodeText(cell)
    if (!text) return

    if (cell.classList.contains('blob-code-addition')) additions.push(text)
    if (cell.classList.contains('blob-code-deletion')) deletions.push(text)
  })

  return { additions, deletions }
}

// ===========================================================================
// UNIFIED DIFF PARSER — primary and most reliable approach
// ===========================================================================

/**
 * Parses a unified diff string (downloaded from GitHub /pull/N.diff)
 * and transforms it into a RawDiff array.
 *
 * Unified diff format:
 * ```
 * diff --git a/file.ts b/file.ts       ← start of a new file
 * --- a/file.ts                         ← original file
 * +++ b/file.ts                         ← modified file (we get the path from here)
 * @@ -10,7 +10,9 @@ function foo() {   ← hunk start (block of changes)
 *  context line (leading space)          ← unchanged code around changes
 * +added line                            ← addition
 * -removed line                          ← deletion
 * ```
 *
 * The parser is a simple state machine:
 * - `current`: the RawDiff of the file being processed (null between files)
 * - `inHunk`: true when inside an @@ block (code lines)
 */
export const parseUnifiedDiff = (diffText: string): RawDiff[] => {
  const files: RawDiff[] = []
  const lines = diffText.replace(/\r/g, '').split('\n')
  let current: RawDiff | null = null
  let inHunk = false

  /** Saves the current file to the array and resets state */
  const pushCurrent = (): void => {
    if (!current) return
    files.push(current)
    current = null
    inHunk = false
  }

  for (const line of lines) {
    // "diff --git" marks the start of a new file → save the previous one
    if (line.startsWith('diff --git ')) {
      pushCurrent()
      continue
    }

    // "+++ b/path/to/file" → extract the modified file path
    if (line.startsWith('+++ ')) {
      const rawPath = line.slice(4).trim()
      // The path has a "b/" prefix in unified diff → remove it
      const path = rawPath.startsWith('b/') ? rawPath.slice(2) : rawPath

      // Deleted files point to /dev/null → skip them
      if (path === '/dev/null') {
        current = null
        inHunk = false
        continue
      }

      current = current ?? { path, additions: [], deletions: [], context: [], rawLines: [] }
      current.path = path
      continue
    }

    if (!current) continue

    // "@@ -10,7 +10,9 @@" → start of a hunk (block of changes)
    if (line.startsWith('@@ ')) {
      inHunk = true
      continue
    }

    // Outside hunks there are no code lines
    if (!inHunk) continue
    // Ignore the end-of-file-without-newline marker
    if (line.startsWith('\\ No newline at end of file')) continue

    // The first character of each line indicates the type:
    // '+' = addition, '-' = removal, ' ' = context (unchanged)
    const marker = line[0]
    const content = line.slice(1)

    if (marker === '+') {
      current.additions.push(content)
      current.rawLines.push(`+${content}`)
    } else if (marker === '-') {
      current.deletions.push(content)
      current.rawLines.push(`-${content}`)
    } else if (marker === ' ') {
      current.context.push(content)
      current.rawLines.push(` ${content}`)
    }
  }

  // Don't forget the last file
  pushCurrent()

  // Return only files that actually have changes
  return files.filter((file) => file.path && (file.additions.length > 0 || file.deletions.length > 0))
}

// ===========================================================================
// GITHUB ADAPTER — Adapter interface implementation for GitHub
// ===========================================================================

export class GitHubAdapter implements Adapter {

  /**
   * Checks if the URL is a GitHub PR.
   * Expected format: https://github.com/{owner}/{repo}/pull/{number}
   * Verifies hostname + path structure.
   */
  isMatch(url: string): boolean {
    try {
      const parsed = new URL(url)

      if (parsed.hostname !== 'github.com') {
        return false
      }

      // Split the path: ["owner", "repo", "pull", "123", ...]
      const parts = parsed.pathname.split('/').filter(Boolean)

      return parts.length >= 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3])
    } catch {
      return false
    }
  }

  /**
   * Extracts PR title and description from the page DOM.
   * Selectors used are from GitHub's current UI:
   * - .markdown-title → PR title
   * - .comment-body → first comment = PR description
   */
  extractContext(): { title: string; description: string } {
    const titleEl = document.querySelector('.markdown-title')
    const title = titleEl?.textContent?.trim() ?? ''

    const descriptionEl = document.querySelector('.comment-body')
    const description = descriptionEl?.textContent?.trim() ?? ''

    return { title, description }
  }

  /**
   * DOM fallback: extracts diffs directly from the page HTML.
   * Used only if the .diff is unavailable.
   * Does not capture context lines (only the unified diff has those).
   */
  private extractDiffFromDom(): RawDiff[] {
    const files: RawDiff[] = []
    const seenPaths = new Set<string>() // avoid duplicates
    const fileHeaders = document.querySelectorAll<HTMLElement>('[data-file-path], [data-path]')

    for (const header of fileHeaders) {
      const path = header.getAttribute('data-file-path') ?? header.getAttribute('data-path')
      if (!path || seenPaths.has(path)) continue

      // Walk up the DOM to find the entire file container
      const fileWrapper =
        header.closest('[data-file-path]') ??
        header.closest('[data-path]') ??
        header.closest('.file') ??
        header.closest('[id^="diff-"]') ??
        header.parentElement

      if (!fileWrapper) continue

      const { additions, deletions } = collectChangedLinesFromDom(fileWrapper)
      if (additions.length === 0 && deletions.length === 0) continue

      seenPaths.add(path)
      files.push({ path, additions, deletions, context: [] })
    }

    return files
  }

  /**
   * Downloads the unified diff from the PR .diff URL.
   * E.g.: https://github.com/owner/repo/pull/42.diff
   * The fetch goes through the background script to avoid CORS restrictions.
   */
  async fetchUnifiedDiff(): Promise<string | null> {
    try {
      const url = new URL(window.location.href)
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
      if (!match) return null

      const [, owner, repo, pr] = match
      const diffUrl = `https://github.com/${owner}/${repo}/pull/${pr}.diff`

      const response: {
        ok: boolean
        status: number
        text?: string
        error?: string
      } = await chrome.runtime.sendMessage({
        type: 'FETCH_GITHUB_DIFF',
        payload: { url: diffUrl },
      })

      if (!response?.ok || !response.text) return null

      return response.text
    } catch {
      return null
    }
  }

  /**
   * Extracts diffs: first tries .diff (reliable), then falls back to DOM.
   * This is the function called by the analyzer.
   */
  async extractDiff(): Promise<RawDiff[]> {
    // Attempt 1: unified diff (preferred — has context lines)
    const diffText = await this.fetchUnifiedDiff()

    if (diffText) {
      const parsed = parseUnifiedDiff(diffText)
      if (parsed.length > 0) return parsed
    }

    // Attempt 2: fall back to DOM (no context lines)
    return this.extractDiffFromDom()
  }

  /**
   * Extracts owner, repo and PR number from the current URL.
   * E.g.: /facebook/react/pull/42 → { owner: "facebook", repo: "react", pr: "42" }
   */
  private getPrInfo(): { owner: string; repo: string; pr: string } | null {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2], pr: match[3] }
  }

  /**
   * Downloads the full content of a file from the PR ("Full context" mode).
   *
   * Two-attempt strategy:
   * 1. raw.githubusercontent.com — faster, much higher rate limit than the API
   * 2. Fallback: GitHub Contents API — slower, 60 req/hour without token
   *
   * The ref "refs/pull/{number}/head" is a special GitHub Git ref that always
   * points to the latest PR commit — no need to know the branch name.
   *
   * If both fail, returns { content: null } and the analyzer will show
   * a warning to the user.
   */
  async fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }> {
    const prInfo = this.getPrInfo()
    if (!prInfo) return { content: null, source: null }

    const { owner, repo, pr } = prInfo

    // Read GitHub token from storage (may be empty)
    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
    const token = settings?.githubToken || ''

    // --- Attempt 1: raw.githubusercontent.com ---
    // Rate limit ~1000s/hour, no API JSON overhead, direct raw file response.
    try {
      const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/refs/pull/${pr}/head/${path}`
      const rawResponse: { ok: boolean; status: number; text?: string } =
        await chrome.runtime.sendMessage({
          type: 'FETCH_GITHUB_FILE',
          payload: { url: rawUrl, token },
        })

      if (rawResponse?.ok && rawResponse.text) {
        return { content: rawResponse.text, source: 'raw' }
      }
    } catch { /* fall through to attempt 2 */ }

    // --- Attempt 2: GitHub Contents API ---
    // Slower with lower rate limit (60/hour without token, 5000/hour with token).
    try {
      const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=pull/${pr}/head`
      const apiResponse: { ok: boolean; status: number; text?: string } =
        await chrome.runtime.sendMessage({
          type: 'FETCH_GITHUB_FILE',
          payload: { url: apiUrl, token },
        })

      if (apiResponse?.ok && apiResponse.text) {
        return { content: apiResponse.text, source: 'api' }
      }
    } catch { /* no fallback left */ }

    return { content: null, source: null }
  }
}
