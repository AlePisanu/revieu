interface StorageData {
  anthropicKey: string
  geminiKey: string
  githubToken: string
  provider: 'anthropic' | 'gemini'
  tone: 'balanced' | 'strict' | 'security'
  mode: 'diff' | 'full'
  popupOnboarded: string
  sidebarOnboarded: string
  [key: string]: string
}

const DEFAULTS: StorageData = {
  anthropicKey: '',
  geminiKey: '',
  githubToken: '',
  provider: 'gemini',
  anthropicModel: '',
  geminiModel: '',
  tone: 'balanced',
  mode: 'diff',
  popupOnboarded: '',
  sidebarOnboarded: '',
}

type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<StorageData> }
  | { type: 'FETCH_GITHUB_DIFF'; payload: { url: string } }
  | { type: 'FETCH_GITHUB_FILE'; payload: { url: string; token?: string } }

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {

  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(DEFAULTS, (data) => {
      sendResponse(data as StorageData)
    })
    return true
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(message.payload, () => {
      sendResponse({ success: true })
    })
    return true
  }

  // Fetch the PR unified diff, goes through background to avoid CORS.
  // credentials: 'include' so it works for private repos the user is logged into.
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

  if (message.type === 'FETCH_GITHUB_FILE') {
    // Accept: application/vnd.github.v3.raw returns raw text instead of base64 JSON
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
