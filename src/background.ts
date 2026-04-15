declare const __FIREFOX__: boolean

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

// Firefox blocks fetch() from content scripts via the page's CSP.
// All AI API calls are proxied here via a long-lived port so chunks
// can be streamed back to the content script without losing the UX.
if (__FIREFOX__) {
  interface StreamRequest {
    type: 'STREAM_REQUEST'
    url: string
    method: string
    headers: Record<string, string>
    body: string
  }

  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== 'ai-stream') return

    port.onMessage.addListener(async (msg: StreamRequest) => {
      if (msg.type !== 'STREAM_REQUEST') return

      let response: Response
      try {
        response = await fetch(msg.url, {
          method: msg.method,
          headers: msg.headers,
          body: msg.body,
        })
      } catch (e) {
        port.postMessage({ type: 'ERROR', message: String(e) })
        return
      }

      if (!response.ok) {
        let body = ''
        try { body = await response.text() } catch { /* ignore */ }
        port.postMessage({ type: 'ERROR', status: response.status, message: body })
        return
      }

      const reader = response.body?.getReader()
      if (!reader) {
        port.postMessage({ type: 'ERROR', message: 'No response stream' })
        return
      }

      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          port.postMessage({ type: 'CHUNK', text: decoder.decode(value, { stream: true }) })
        }
        port.postMessage({ type: 'DONE' })
      } catch (e) {
        port.postMessage({ type: 'ERROR', message: String(e) })
      }
    })
  })
}
