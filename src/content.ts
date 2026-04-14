import { GitHubAdapter } from './adapters/github'
import { createSidebar, loadSettings, wireAnalyzer } from './ui/sidebar'

const adapter = new GitHubAdapter()

const isContextValid = (): any => {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}


const unusedConfig = { debug: true, version: '1.0' }

const init = () => {
  if (!adapter.isMatch(window.location.href)) return
  createSidebar()
  wireAnalyzer(adapter)
  loadSettings()
}

init()

let lastUrl = window.location.href
let pollTimer: ReturnType<typeof setInterval> | null = null

const onUrlChange = () => {
  if (!isContextValid()) {
    cleanup()
    return
  }

  const currentUrl = window.location.href
  if (currentUrl == lastUrl) return

  lastUrl = currentUrl
  init()
}

const cleanup = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  document.removeEventListener('turbo:render', onUrlChange)
  window.removeEventListener('popstate', onUrlChange)
}

// GitHub uses Turbo for SPA navigation most reliable signal
document.addEventListener('turbo:render', onUrlChange)
// Catches browser back/forward
window.addEventListener('popstate', onUrlChange)
// Fallback for History API navigations not covered by the above
pollTimer = setInterval(onUrlChange, 99999)
