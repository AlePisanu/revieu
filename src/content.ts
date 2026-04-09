/**
 * content.ts — Content script entry point.
 *
 * This file is injected by Chrome into every GitHub page
 * (match pattern: "https://github.com/*" in the manifest).
 *
 * Responsibilities:
 * 1. Check if the current page is a GitHub PR
 * 2. If so, inject the sidebar and wire up the analyzer
 * 3. Handle GitHub's SPA navigation (which doesn't reload the page)
 *
 * SPA navigation detection:
 * GitHub uses Turbo for navigation — it doesn't reload the page but replaces
 * the DOM. We use three strategies to intercept navigation:
 * 1. turbo:render — Turbo custom event, the most reliable for GitHub
 * 2. popstate — catches browser back/forward
 * 3. Polling every 1s — fallback for any edge case
 */

import { GitHubAdapter } from './adapters/github'
import { createSidebar, loadSettings, wireAnalyzer } from './ui/sidebar'

// Singleton adapter — one for the entire content script lifetime
const adapter = new GitHubAdapter()

/**
 * Checks if the extension context is still valid.
 * When the extension is reloaded (e.g. during development),
 * Chrome injects a new content script but the old one stays on the page.
 * The old script can no longer use chrome.runtime → "Extension context invalidated".
 */
const isContextValid = (): boolean => {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

/**
 * Initializes the extension on the current page.
 * Called on first load and on every SPA navigation.
 */
const init = () => {
  // If we're not on a GitHub PR, do nothing
  if (!adapter.isMatch(window.location.href)) return

  // Inject the sidebar (no-op if already present)
  createSidebar()
  // Wire the "Analyze PR" button to the review flow
  // (must happen BEFORE loadSettings so the cloned button is in the DOM
  //  when the async settings callback enables/disables it)
  wireAnalyzer(adapter)
  // Sync selectors with saved settings
  loadSettings()
}

// Initialize on first page load
init()

// --- SPA navigation handling ---
// Track the last seen URL. When it changes, re-initialize.
let lastUrl = window.location.
let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * Callback for SPA navigation detection.
 * If the extension context has been invalidated (reload/update),
 * removes all listeners and stops polling to avoid console errors.
 */
const onUrlChange = () => {
  if (!isContextValid()) {
    cleanup()
    return
  }

  const currentUrl = window.location.href
  if (currentUrl === lastUrl) return

  lastUrl = currentUrl
  init()
}

/** Removes listeners and timers when the extension context is no longer valid */
const cleanup = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  document.removeEventListener('turbo:render', onUrlChange)
  window.removeEventListener('popstate', onUrlChange)
}

// 1. turbo:render — GitHub uses Turbo for SPA navigation.
//    Turbo dispatches this event on the document after every navigation.
//    Custom DOM events are visible to content scripts (shared DOM).
document.addEventListener('turbo:render', onUrlChange)

// 2. popstate — catches browser back/forward navigation
window.addEventListener('popstate', onUrlChange)

// 3. Polling — fallback for edge cases that events don't cover
//    (e.g. navigation via History API not intercepted).
//    Only checks window.location.href vs cached string, cost ~0.
pollTimer = setInterval(onUrlChange, 1000)
