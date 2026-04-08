/**
 * background.ts — Extension service worker (Manifest V3).
 *
 * Runs in an isolated context from the page DOM. Cannot access
 * document, window, etc. — it can only:
 * - Receive messages from popup and content script via chrome.runtime.onMessage
 * - Make HTTP fetches without CORS restrictions (background has special permissions)
 * - Read/write chrome.storage
 *
 * Pattern: MESSAGE BUS
 * The background acts as a "hub" between extension parts.
 * Popup and content script send typed messages (Message),
 * the background handles them and responds asynchronously.
 *
 * Why fetches go through here:
 * The content script runs in the GitHub page and has the same
 * browser CORS restrictions. The background can fetch any URL
 * (github.com/...diff, api.github.com, etc.) without being blocked.
 */

// ---------------------------------------------------------------------------
// STORAGE: schema of data saved in chrome.storage.sync
// ---------------------------------------------------------------------------

/**
 * Extension settings structure.
 * chrome.storage.sync syncs them across user's devices.
 * The index signature [key: string] is required by chrome.storage.sync.get()
 * which expects a type compatible with Record<string, unknown>.
 */
interface StorageData {
  anthropicKey: string
  geminiKey: string
  /** GitHub token for accessing private repos in "Full context" mode */
  githubToken: string
  provider: 'anthropic' | 'gemini'
  tone: 'balanced' | 'strict' | 'security'
  mode: 'diff' | 'full'
  popupOnboarded: string
  sidebarOnboarded: string
  [key: string]: string
}

/** Default values used when the user hasn't configured anything yet */
const DEFAULTS: StorageData = {
  anthropicKey: '',
  geminiKey: '',
  githubToken: '',
  provider: 'gemini',
  tone: 'balanced',
  mode: 'diff',
  popupOnboarded: '',
  sidebarOnboarded: '',
}

// ---------------------------------------------------------------------------
// MESSAGES: message types the background can receive
// ---------------------------------------------------------------------------

/**
 * Union type of all supported messages.
 * Each type has a discriminant `type` field and an optional payload.
 * This pattern (discriminated union) lets TypeScript narrow the type
 * automatically inside each `if`.
 */
type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<StorageData> }
  | { type: 'FETCH_GITHUB_DIFF'; payload: { url: string } }
  | { type: 'FETCH_GITHUB_FILE'; payload: { url: string; token?: string } }

// ---------------------------------------------------------------------------
// HANDLER: processes incoming messages from popup and content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {

  // --- Read settings from storage and return them to the caller ---
  if (message.type === 'GET_SETTINGS') {
    // The second argument to .get() are defaults: if a field doesn't exist
    // in storage, it's filled with the value from DEFAULTS.
    chrome.storage.sync.get(DEFAULTS, (data) => {
      sendResponse(data as StorageData)
    })
    // `return true` tells Chrome to keep the message channel open
    // until we call sendResponse (which happens asynchronously).
    // Without this, Chrome closes the channel before storage responds.
    return true
  }

  // --- Save settings to storage ---
  if (message.type === 'SAVE_SETTINGS') {
    // Partial<StorageData> allows saving just one field
    // without having to pass all settings every time.
    chrome.storage.sync.set(message.payload, () => {
      sendResponse({ success: true })
    })
    return true
  }

  // --- Download the unified diff of a PR (e.g. github.com/.../pull/42.diff) ---
  // Used by the adapter to get the diff in text format.
  // credentials: 'include' sends user cookies, so it works
  // even if the user is logged into GitHub with an active session.
  if (message.type === 'FETCH_GITHUB_DIFF') {
    fetch(message.payload.url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'text/plain' },
    })
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, status: response.status })
          return
        }
        sendResponse({
          ok: true,
          status: response.status,
          text: await response.text(),
        })
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, status: 0, error: detail })
      })
    return true
  }

  // --- Download the full content of a file from GitHub ---
  // Used in "Full context" mode to give the AI the entire file, not just the diff.
  // The Accept: application/vnd.github.v3.raw header tells the GitHub API
  // to return the raw file (text) instead of JSON with base64.
  // The Authorization token is optional: only needed for private repos.
  if (message.type === 'FETCH_GITHUB_FILE') {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3.raw' }

    if (message.payload.token) {
      headers['Authorization'] = `Bearer ${message.payload.token}`
    }

    fetch(message.payload.url, { method: 'GET', headers })
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, status: response.status })
          return
        }
        sendResponse({
          ok: true,
          status: response.status,
          text: await response.text(),
        })
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, status: 0, error: detail })
      })
    return true
  }
})
