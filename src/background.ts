// Storage schema — matches chrome.storage.sync structure
interface StorageData {
  anthropicKey: string
  geminiKey: string
  githubToken: string
  provider: 'anthropic' | 'gemini'
  tone: 'balanced' | 'strict' | 'security'
  mode: 'diff' | 'full'
}

const DEFAULTS: StorageData = {
  anthropicKey: '',
  geminiKey: '',
  githubToken: '',
  provider: 'anthropic',
  tone: 'balanced',
  mode: 'diff',
}

// Message types used across popup, content script, and sidebar
type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<StorageData> }

// Handle messages from popup and content script
chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {
  if (message.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(DEFAULTS, (data) => {
      sendResponse(data as StorageData)
    })
    // Return true to keep the message channel open for async sendResponse
    return true
  }

  if (message.type === 'SAVE_SETTINGS') {
    chrome.storage.sync.set(message.payload, () => {
      sendResponse({ success: true })
    })
    return true
  }
})
