/**
 * sidebar.ts — Sidebar UI injected into GitHub pages.
 *
 * Responsibilities:
 * 1. Create and inject the sidebar panel into GitHub's DOM
 * 2. Handle sidebar open/close
 * 3. Connect controls (mode, tone, provider) to the analyzer
 * 4. Render the AI review as HTML (markdown → HTML via `marked`)
 * 5. Handle the "diff too large" case by showing a file selector
 *
 * Pattern: CONTROLLER
 * This file is the glue between the UI (DOM) and the logic (analyzer).
 * It contains no business logic — it reads input from the UI, calls the
 * analyzer, and displays the result. All heavy lifting is delegated.
 *
 * How injection works:
 * The content script (content.ts) calls createSidebar() which:
 * - Creates a div with id "revieu-sidebar" and appends it to the body
 * - Creates a side tab to open/close the sidebar
 * - CSS styles come from sidebar.css injected by the manifest
 *
 * Note on cloneNode in wireAnalyzer:
 * When the extension is reloaded during development, Chrome injects
 * a new content script WITHOUT removing the old one. Each script adds
 * a listener to the button → multiple clicks. The clone removes all listeners.
 */

import type { Adapter } from '../types'
import { analyze, TooLargeError } from '../core/analyzer'
import { marked } from 'marked'
import lottie from 'lottie-web'

// DOM element IDs for the sidebar — used by querySelector
const SIDEBAR_ID = 'revieu-sidebar'
const TAB_ID = 'revieu-tab'
/** Sidebar width — also used to shift the body left */
const SIDEBAR_WIDTH = '380px'

const PR_ICON = '<svg class="revieu-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M7 8.83a3.001 3.001 0 1 0-2 0v6.34a3.001 3.001 0 1 0 2 0zM6 5a1 1 0 1 0 0 2a1 1 0 0 0 0-2m0 12a1 1 0 1 0 0 2a1 1 0 0 0 0-2m11-1.83a3.001 3.001 0 1 0 2 0V10.4A5.4 5.4 0 0 0 13.6 5h-.186l.293-.293a1 1 0 0 0-1.414-1.414l-2 2a1 1 0 0 0 0 1.414l2 2a1 1 0 1 0 1.414-1.414L13.414 7h.186a3.4 3.4 0 0 1 3.4 3.4zM17 18a1 1 0 1 1 2 0a1 1 0 0 1-2 0" clip-rule="evenodd"/></svg>';
const TRASH_ICON = '<svg class="revieu-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>';

// ===========================================================================
// SIDEBAR CREATION
// ===========================================================================

/**
 * Creates and injects the sidebar into the page DOM.
 * If already present (SPA navigation), returns the existing one.
 *
 * The sidebar contains:
 * - Header with title and close button
 * - Controls: mode (diff/full), tone, provider
 * - "Analyze PR" button (disabled until an API key is configured)
 * - Output area where the review is rendered
 * - Footer with "Copy" button and token estimate (hidden until review completes)
 */
export const createSidebar = (): HTMLElement => {
  // Prevent double injection (GitHub is a SPA, content script may re-run)
  const existing = document.getElementById(SIDEBAR_ID)
  if (existing) return existing

  const sidebar = document.createElement('div')
  sidebar.id = SIDEBAR_ID

  sidebar.innerHTML = `
  <div class="revieu-header">
    <div class="revieu-header-left">
      <img src="${chrome.runtime.getURL('icons/logo-128.png')}" alt="Revieu" class="revieu-logo" />
      <button class="revieu-settings-trigger" aria-label="Open settings" aria-expanded="false">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <path d="M6 9l6 6 6-6"/>
        </svg>
      </button>
    </div>
    <button class="revieu-close" aria-label="Close sidebar">&times;</button>

    <div class="revieu-settings-popover" aria-hidden="true">
      <div class="revieu-settings-arrow"></div>
      <div class="revieu-controls">
        <label class="revieu-label">
          Provider
          <select class="revieu-select" data-setting="provider">
            <option value="anthropic">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
        <label class="revieu-label">
          Mode
          <select class="revieu-select" data-setting="mode">
            <option value="diff">Diff only</option>
            <option value="full">Full context</option>
          </select>
        </label>
        <label class="revieu-label">
          Tone
          <select class="revieu-select" data-setting="tone">
            <option value="balanced">Balanced</option>
            <option value="strict">Strict</option>
            <option value="security">Security-focused</option>
          </select>
        </label>
      </div>
    </div>
  </div>
  <div class="revieu-body">
    <div class="revieu-output">
      <div class="revieu-empty-state">
        <div class="revieu-lottie-container"></div>
        <h3 class="revieu-empty-title">Ready for a Code Review?</h3>
        <div class="revieu-onboarding-tips">
          <div class="revieu-tip-item">
            <span class="revieu-settings-trigger revieu-tip-trigger" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M6 9l6 6 6-6"/>
              </svg>
            </span>
            <span>Tap this arrow next to Revieu to open settings</span>
          </div>
          <div class="revieu-tip-item">
            <svg class="revieu-tip-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a5 5 0 0 1 5 5v3a5 5 0 0 1-10 0V7a5 5 0 0 1 5-5z"/><path d="M15 14l4.5 4.5"/><path d="M9 14l-4.5 4.5"/><path d="M12 18v4"/></svg>
            <span>Choose your AI provider</span>
          </div>
          <div class="revieu-tip-item">
            <svg class="revieu-tip-icon" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            <span>Select mode and tone</span>
          </div>
          <div class="revieu-tip-item">
            <svg class="revieu-tip-icon" width="22" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
            <span>Click Analyze PR to start</span>
          </div>
        </div>
      </div>
    </div>
    <div class="revieu-bottom-bar">
      <div class="revieu-btn-row">
        <button class="revieu-analyze-btn" disabled>${PR_ICON} Analyze PR</button>
        <button class="revieu-clear-btn" title="Clear output">${TRASH_ICON}</button>
      </div>
      <div class="revieu-footer revieu-hidden-el">
        <button class="revieu-copy-btn">Copy review</button>
        <span class="revieu-token-hint"></span>
      </div>
    </div>
  </div>
`

  // Side tab — always visible on the right edge, opens sidebar on click
  const tab = document.createElement('div')
  tab.id = TAB_ID

  const img = document.createElement('img')
  img.src = chrome.runtime.getURL('icons/logo-white.png')
  img.alt = 'Revieu'
  img.style.width = '20px'
  img.style.height = 'auto'

  tab.appendChild(img)
  tab.setAttribute('role', 'button')
  tab.setAttribute('aria-label', 'Open Revieu sidebar')

  document.body.appendChild(sidebar)
  document.body.appendChild(tab)

  tab.addEventListener('click', () => toggleSidebar(true))

  const closeBtn = sidebar.querySelector('.revieu-close') as HTMLElement
  closeBtn.addEventListener('click', () => toggleSidebar(false))

  const settingsTrigger = sidebar.querySelector('.revieu-settings-trigger') as HTMLElement
  const settingsPopover = sidebar.querySelector('.revieu-settings-popover') as HTMLElement

  const closePopover = () => {
    settingsPopover.classList.remove('revieu-popover-open')
    settingsTrigger.setAttribute('aria-expanded', 'false')
    settingsTrigger.classList.remove('revieu-trigger-open')
  }

  settingsTrigger.addEventListener('click', (e) => {
    e.stopPropagation()
    const isOpen = settingsPopover.classList.contains('revieu-popover-open')
    if (isOpen) {
      closePopover()
    } else {
      settingsPopover.classList.add('revieu-popover-open')
      settingsTrigger.setAttribute('aria-expanded', 'true')
      settingsTrigger.classList.add('revieu-trigger-open')
    }
  })

  // Close when clicking outside
  document.addEventListener('click', (e) => {
    if (!settingsPopover.contains(e.target as Node) && e.target !== settingsTrigger) {
      closePopover()
    }
  })

  // Prevent clicks inside the popover from closing it
  settingsPopover.addEventListener('click', (e) => e.stopPropagation())

  // Save sidebar settings to storage when the user changes them.
  // Without this, loadSettings() resets them to defaults on every SPA navigation
  // (e.g. clicking "Files changed" changes the URL → init() → loadSettings()).
  sidebar.querySelectorAll<HTMLSelectElement>('.revieu-select').forEach((select) => {
    select.addEventListener('change', () => {
      const key = select.dataset.setting
      if (key) {
        chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload: { [key]: select.value } })
      }
    })
  })

  // Wire clear button — persistent, no need for cloneNode
  const clearBtn = getClearButton()
  clearBtn?.addEventListener('click', () => {
    const output = getOutputElement()
    if (output) output.innerHTML = ''
    hideFooter()
    hideClearButton()
  })

  // Initialize Lottie animation in the empty state
  const lottieContainer = sidebar.querySelector('.revieu-lottie-container') as HTMLElement
  if (lottieContainer) {
    lottie.loadAnimation({
      container: lottieContainer,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: chrome.runtime.getURL('assets/ai.json'),
    })
  }

  // Hide onboarding if already dismissed
  chrome.storage.sync.get('sidebarOnboarded', (res) => {
    console.log('Onboarding done:', res.sidebarOnboarded)
    if (res.sidebarOnboarded) {
      sidebar.querySelector('.revieu-onboarding-tips')?.classList.add('revieu-hidden-el')
    }
  })

  // Starts closed by default
  sidebar.classList.add('revieu-hidden')

  return sidebar
}

// ===========================================================================
// OPEN / CLOSE
// ===========================================================================

/**
 * Opens or closes the sidebar.
 * When open, shifts the body left (marginRight) to make room.
 * @param open - true to open, false to close, undefined to toggle
 */
export const toggleSidebar = (open?: boolean): void => {
  const sidebar = document.getElementById(SIDEBAR_ID)
  const tab = document.getElementById(TAB_ID)
  if (!sidebar || !tab) return

  const shouldOpen = open ?? sidebar.classList.contains('revieu-hidden')

  if (shouldOpen) {
    sidebar.classList.remove('revieu-hidden')
    tab.classList.add('revieu-tab-hidden')
    // Shift the body so the sidebar doesn't cover the content
    document.body.style.marginRight = SIDEBAR_WIDTH
  } else {
    sidebar.classList.add('revieu-hidden')
    tab.classList.remove('revieu-tab-hidden')
    document.body.style.marginRight = ''
  }
}

// ===========================================================================
// SETTINGS
// ===========================================================================

/**
 * Loads saved settings from the background and applies them to the sidebar selectors.
 * Enables the "Analyze PR" button only if at least one API key is configured.
 */
export const loadSettings = (): void => {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
    if (!settings) return

    // Apply saved values to each select (mode, tone, provider)
    // The data-setting attribute on the HTML matches the key in storage
    const selects = document.querySelectorAll<HTMLSelectElement>(`#${SIDEBAR_ID} .revieu-select`)
    for (const select of selects) {
      const key = select.dataset.setting as string
      if (key in settings) {
        select.value = settings[key]
      }
    }

    // Button is disabled until at least one API key exists
    const btn = getAnalyzeButton()
    if (btn) {
      const hasKey = settings.anthropicKey || settings.geminiKey
      btn.disabled = !hasKey
    }
  })
}

/** Reads the current values from the sidebar selectors */
export const getSelectedSettings = (): { mode: string; tone: string; provider: string } => {
  const get = (name: string) => {
    const el = document.querySelector<HTMLSelectElement>(`#${SIDEBAR_ID} [data-setting="${name}"]`)
    return el?.value ?? ''
  }

  return { mode: get('mode'), tone: get('tone'), provider: get('provider') }
}

// ===========================================================================
// DOM HELPERS
// ===========================================================================

/** Returns the container where the review is rendered */
export const getOutputElement = (): HTMLElement | null => {
  return document.querySelector(`#${SIDEBAR_ID} .revieu-output`)
}

/** Returns the "Analyze PR" button */
export const getAnalyzeButton = (): HTMLButtonElement | null => {
  return document.querySelector(`#${SIDEBAR_ID} .revieu-analyze-btn`)
}

/** Returns the "Clear" button */
const getClearButton = (): HTMLButtonElement | null => {
  return document.querySelector(`#${SIDEBAR_ID} .revieu-clear-btn`)
}

/** Shows the clear button with animation */
const showClearButton = (): void => {
  getClearButton()?.classList.add('revieu-clear-visible')
}

/** Hides the clear button with animation */
const hideClearButton = (): void => {
  getClearButton()?.classList.remove('revieu-clear-visible')
}

/** Shows a Lottie loader animation in the output area. Returns a destroy function. */
const showLoader = (output: HTMLElement): (() => void) => {
  output.innerHTML = '<div class="revieu-loader-container"></div>'
  const container = output.querySelector('.revieu-loader-container') as HTMLElement
  const anim = lottie.loadAnimation({
    container,
    renderer: 'svg',
    loop: true,
    autoplay: true,
    path: chrome.runtime.getURL('assets/loader.json'),
  })
  return () => {
    anim.destroy()
    output.innerHTML = ''
  }
}

// ===========================================================================
// ANALYZE BUTTON → ANALYZER WIRING
// ===========================================================================

/**
 * Connects the "Analyze PR" button click to the entire review flow.
 *
 * Flow on click:
 * 1. Reads settings from the background (API key, mode, tone, provider)
 * 2. Resets the output and shows "Analyzing..."
 * 3. Calls analyze() with an onChunk callback that:
 *    - Accumulates the raw markdown received via streaming
 *    - Converts it to HTML with `marked` and injects it into the output
 * 4. If the diff is too large → shows the file selector
 * 5. If there's an error → shows the error message
 * 6. When the review finishes → shows the footer with "Copy review" and token estimate
 */
export const wireAnalyzer = (adapter: Adapter): void => {
  const oldBtn = getAnalyzeButton()
  if (!oldBtn) return

  // Clone the button to remove any duplicate listeners
  // (see note in the file comment above)
  const btn = oldBtn.cloneNode(true) as HTMLButtonElement
  oldBtn.replaceWith(btn)

  btn.addEventListener('click', () => {
    // Hide onboarding tips permanently on first analyze
    const onboarding = document.querySelector(`#${SIDEBAR_ID} .revieu-onboarding-tips`)
    console.log('Hiding onboarding tips')
    if (onboarding && !onboarding.classList.contains('revieu-hidden-el')) {
      onboarding.classList.add('revieu-hidden-el')
      chrome.storage.sync.set({ sidebarOnboarded: true })
    }

    const output = getOutputElement()
    if (!output) return

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, async (settings) => {
      if (!settings) return

      const { mode, tone, provider } = getSelectedSettings()
      // Pick the right API key based on the selected provider
      const apiKey = provider === 'anthropic' ? settings.anthropicKey : settings.geminiKey

      if (!apiKey) {
        output.innerHTML = '<p class="revieu-error">No API key configured. Click the Revieu icon in the toolbar to add one.</p>'
        return
      }

      hideFooter()
      hideClearButton()
      btn.disabled = true
      btn.innerHTML = `${PR_ICON} Analyzing<span class="revieu-dots"></span>`

      const destroyLoader = showLoader(output)

      // Accumulates raw markdown — needed for copy and token estimate
      let rawMarkdown = ''
      let showingFileSelector = false
      let loaderVisible = true

      // Show a hint if the AI takes too long to respond
      const slowTimer = setTimeout(() => {
        const loaderContainer = output.querySelector('.revieu-loader-container')
        if (loaderContainer && loaderVisible) {
          loaderContainer.insertAdjacentHTML('beforeend', '<p class="revieu-slow-hint">It\'s taking longer than usual...</p>')
        }
      }, 5000)

      try {
        await analyze({
          adapter,
          mode,
          tone,
          provider,
          apiKey,
          onChunk: (text) => {
            // Remove loader on first chunk
            if (loaderVisible) {
              clearTimeout(slowTimer)
              destroyLoader()
              loaderVisible = false
            }
            rawMarkdown += text
            // Re-renders all markdown on every chunk.
            // Not the most efficient, but `marked` is fast and ensures
            // the rendering is always consistent (no partial artifacts).
            output.innerHTML = marked.parse(rawMarkdown) as string
            colorizeHeaders(output)
          },
        })
        showFooter(rawMarkdown)
        showClearButton()
      } catch (err) {
        clearTimeout(slowTimer)
        if (loaderVisible) {
          destroyLoader()
          loaderVisible = false
        }
        // TooLargeError: diff exceeds the limit → show file selector
        if (err instanceof TooLargeError) {
          showingFileSelector = true
          renderFileSelector(output, err.files, adapter, settings)
          showClearButton()
          return
        }

        const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
        output.innerHTML = `<p class="revieu-error">${message}</p>`
        showClearButton()
      } finally {
        if (!showingFileSelector) {
          btn.disabled = false
          btn.innerHTML = `${PR_ICON} Analyze PR`
        }
      }
    })
  })
}

// ===========================================================================
// FOOTER (copy + token estimate)
// ===========================================================================

/**
 * Rough token estimate — ~4 characters per token.
 * Not precise (each model tokenizes differently),
 * but gives an idea of the review cost.
 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** Shows the footer with the copy button and token estimate */
const showFooter = (reviewText: string): void => {
  const footer = document.querySelector(`#${SIDEBAR_ID} .revieu-footer`)
  const hint = document.querySelector(`#${SIDEBAR_ID} .revieu-token-hint`)
  if (!footer || !hint) return

  hint.textContent = `~${estimateTokens(reviewText)} tokens`
  footer.classList.remove('revieu-hidden-el')

  // Wire the copy button — uses the browser's Clipboard API
  const copyBtn = footer.querySelector('.revieu-copy-btn') as HTMLButtonElement
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(reviewText)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => { copyBtn.textContent = 'Copy review' }, 2000)
  }
}

/** Hides the footer (before a new analysis) */
const hideFooter = (): void => {
  const footer = document.querySelector(`#${SIDEBAR_ID} .revieu-footer`)
  if (footer) footer.classList.add('revieu-hidden-el')
}

// ===========================================================================
// FILE SELECTOR (when the diff is too large)
// ===========================================================================

/**
 * Shows a list of checkboxes with the PR files.
 * The user picks which files to analyze.
 *
 * When they click "Analyze selected":
 * - Takes the selected files
 * - Re-calls analyze() with selectedFiles and initialFiles
 *   (initialFiles avoids re-extracting the diff from scratch)
 */
const renderFileSelector = (
  output: HTMLElement,
  files: import('../types').DiffFile[],
  adapter: Adapter,
  settings: Record<string, string>
): void => {
  const analyzeBtn = getAnalyzeButton()
  if (analyzeBtn) {
    analyzeBtn.disabled = true
    analyzeBtn.innerHTML = `${PR_ICON} Analyzing<span class="revieu-dots"></span>`
  }
  const list = files
    .map((f) => `
      <label class="revieu-file-option">
        <input type="checkbox" value="${f.path}">
        <span class="revieu-file-info">
          <span class="revieu-file-name">${f.path}</span>
          <span class="revieu-line-count">${f.totalLines} lines</span>
        </span>
      </label>`)
    .join('')

  output.innerHTML = `
    <p class="revieu-warning">Diff too large (${files.reduce((s, f) => s + f.totalLines, 0)} lines). Select files to analyze:</p>
    <button class="revieu-toggle-all-btn">Select all</button>
    <div class="revieu-file-list">${list}</div>
    <div class="revieu-btn-row">
      <button class="revieu-analyze-selected-btn">Analyze selected</button>
      <button class="revieu-clear-btn" title="Clear output">${TRASH_ICON}</button>
    </div>
  `

  const clearBtn = getClearButton()
  clearBtn?.addEventListener('click', () => {
    const output = getOutputElement()
    if (output) output.innerHTML = ''
    hideFooter()
    hideClearButton()
    if (analyzeBtn) {
      analyzeBtn.disabled = false
      analyzeBtn.innerHTML = `${PR_ICON} Analyze PR`
    }
  })

  const toggleAllBtn = output.querySelector('.revieu-toggle-all-btn') as HTMLButtonElement
  toggleAllBtn.addEventListener('click', () => {
    const checkboxes = output.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')
    const allChecked = Array.from(checkboxes).every((cb) => cb.checked)
    checkboxes.forEach((cb) => { cb.checked = !allChecked })
    toggleAllBtn.textContent = allChecked ? 'Select all' : 'Deselect all'
  })


  const selectedBtn = output.querySelector('.revieu-analyze-selected-btn') as HTMLButtonElement

  selectedBtn.addEventListener('click', async () => {
    const checkboxes = output.querySelectorAll<HTMLInputElement>('input[type="checkbox"]:checked')
    const selectedFiles = Array.from(checkboxes).map((cb) => cb.value)

    if (selectedFiles.length === 0) return

    const { mode, tone, provider } = getSelectedSettings()
    const apiKey = provider === 'anthropic' ? settings.anthropicKey : settings.geminiKey

    output.innerHTML = ''
    hideClearButton()
    let rawMarkdown = ''

    try {
      await analyze({
        adapter,
        mode,
        tone,
        provider,
        apiKey,
        onChunk: (text) => {
          rawMarkdown += text
          output.innerHTML = marked.parse(rawMarkdown) as string
          colorizeHeaders(output)
        },
        selectedFiles,
        // Pass already-parsed files to avoid re-extracting the diff
        initialFiles: files,
      })
      if (analyzeBtn) {
        analyzeBtn.disabled = false
        analyzeBtn.innerHTML = `${PR_ICON} Analyze PR`
      }
      showFooter(rawMarkdown)
      showClearButton()
    } catch (err) {
      const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
      output.innerHTML = `<p class="revieu-error">${message}</p>`
      showClearButton()
    }
  })
}

const colorizeHeaders = (el: HTMLElement) => {
  el.querySelectorAll('h2').forEach((h) => {
    const text = h.textContent?.toLowerCase() ?? ''
    if (text.includes('critical')) h.classList.add('revieu-critical')
    else if (text.includes('improvement')) h.classList.add('revieu-improvements')
    else if (text.includes('minor')) h.classList.add('revieu-minor')
  })
}
