import type { Adapter, RawDiff } from '../types'

const normalizeDiffLine = (value: string | null | undefined): string => {
  if (!value) return ''
  return value.replace(/\u00a0/g, ' ').replace(/\r/g, '').trimEnd()
}

// GitHub has changed its diff HTML structure multiple times try selectors in priority order
const getCodeText = (element: ParentNode): string => {
  const selectors = [
    '.diff-text',
    '.diff-text-inner',
    '.blob-code-inner',
    '.react-code-text',
    'code',
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

const collectChangedLinesFromDom = (fileWrapper: ParentNode): { additions: string[]; deletions: string[] } => {
  const additions: string[] = []
  const deletions: string[] = []

  // Strategy 1: tabular UI with <tr> rows
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

  if (additions.length > 0 || deletions.length > 0) {
    return { additions, deletions }
  }

  // Strategy 2: direct class selectors (older UI)
  fileWrapper.querySelectorAll<HTMLElement>('.blob-code-addition, .blob-code-deletion').forEach((cell) => {
    const text = getCodeText(cell)
    if (!text) return

    if (cell.classList.contains('blob-code-addition')) additions.push(text)
    if (cell.classList.contains('blob-code-deletion')) deletions.push(text)
  })

  return { additions, deletions }
}

// Parses a unified diff string (e.g. from /pull/42.diff) into RawDiff[].
// Simple state machine: tracks the current file and whether we're inside a hunk.
export const parseUnifiedDiff = (diffText: string): RawDiff[] => {
  const files: RawDiff[] = []
  const lines = diffText.replace(/\r/g, '').split('\n')
  let current: RawDiff | null = null
  let inHunk = false

  const pushCurrent = (): void => {
    if (!current) return
    files.push(current)
    current = null
    inHunk = false
  }

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      pushCurrent()
      continue
    }

    if (line.startsWith('+++ ')) {
      const rawPath = line.slice(4).trim()
      // Unified diff paths have a "b/" prefix strip it
      const path = rawPath.startsWith('b/') ? rawPath.slice(2) : rawPath

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

    if (line.startsWith('@@ ')) {
      inHunk = true
      continue
    }

    if (!inHunk) continue
    if (line.startsWith('\\ No newline at end of file')) continue

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

  pushCurrent()

  return files.filter((file) => file.path && (file.additions.length > 0 || file.deletions.length > 0))
}

export class GitHubAdapter implements Adapter {

  isMatch(url: string): boolean {
    try {
      const parsed = new URL(url)

      if (parsed.hostname !== 'github.com') {
        return false
      }

      // Expected: /owner/repo/pull/123[/...]
      const parts = parsed.pathname.split('/').filter(Boolean)

      return parts.length >= 4 && parts[2] === 'pull' && /^\d+$/.test(parts[3])
    } catch {
      return false
    }
  }

  extractContext(): { title: string; description: string } {
    const titleEl = document.querySelector('.markdown-title')
    const title = titleEl?.textContent?.trim() ?? ''

    const descriptionEl = document.querySelector('.comment-body')
    const description = descriptionEl?.textContent?.trim() ?? ''

    return { title, description }
  }

  private extractDiffFromDom(): RawDiff[] {
    const files: RawDiff[] = []
    const seenPaths = new Set<string>()
    const fileHeaders = document.querySelectorAll<HTMLElement>('[data-file-path], [data-path]')

    for (const header of fileHeaders) {
      const path = header.getAttribute('data-file-path') ?? header.getAttribute('data-path')
      if (!path || seenPaths.has(path)) continue

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

  async fetchUnifiedDiff(): Promise<string | null> {
    try {
      const url = new URL(window.location.href)
      const match = url.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
      if (!match) return null

      const [, owner, repo, pr] = match
      // GitHub redirects /pull/N.diff to patch-diff.githubusercontent.com — hit it directly.
      const diffUrl = `https://patch-diff.githubusercontent.com/raw/${owner}/${repo}/pull/${pr}.diff`

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

  async extractDiff(): Promise<RawDiff[]> {
    const diffText = await this.fetchUnifiedDiff()

    if (diffText) {
      const parsed = parseUnifiedDiff(diffText)
      if (parsed.length > 0) return parsed
    }

    return this.extractDiffFromDom()
  }

  private getPrInfo(): { owner: string; repo: string; pr: string } | null {
    const match = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/pull\/(\d+)/)
    if (!match) return null
    return { owner: match[1], repo: match[2], pr: match[3] }
  }

  async fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }> {
    const prInfo = this.getPrInfo()
    if (!prInfo) return { content: null, source: null }

    const { owner, repo, pr } = prInfo

    const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' })
    const token = settings?.githubToken || ''

    // Attempt 1: raw.githubusercontent.com much higher rate limit than the API
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
    } catch { /* fall through */ }

    // Attempt 2: GitHub Contents API 60 req/hour without token, 5000/hour with
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
