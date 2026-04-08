/**
 * popup.ts — Extension popup script (click on the toolbar icon).
 *
 * The popup is the window that appears when the user clicks the
 * Revieu icon in Chrome's toolbar.
 * It's used to configure API keys (Anthropic, Gemini) and the GitHub token.
 *
 * Flow:
 * 1. On popup open, loads settings from the background (GET_SETTINGS)
 * 2. Fills the fields with saved values
 * 3. On "Save" click, sends the new values to the background (SAVE_SETTINGS)
 *
 * Settings are saved in chrome.storage.sync (synced across devices)
 * through the background script. The popup doesn't access storage directly —
 * it only communicates via messages.
 */

const anthropicInput = document.getElementById('anthropic-key') as HTMLInputElement
const geminiInput = document.getElementById('gemini-key') as HTMLInputElement
const githubInput = document.getElementById('github-token') as HTMLInputElement
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement

// Load saved settings when the popup opens
chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
  if (!settings) return
  anthropicInput.value = settings.anthropicKey ?? ''
  geminiInput.value = settings.geminiKey ?? ''
  githubInput.value = settings.githubToken ?? ''
})

// Save all settings on "Save" click
saveBtn.addEventListener('click', () => {
  const payload = {
    anthropicKey: anthropicInput.value.trim(),
    geminiKey: geminiInput.value.trim(),
    githubToken: githubInput.value.trim(),
  }

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload }, (response) => {
    if (response?.success) {
      statusEl.textContent = 'Saved'
      setTimeout(() => { statusEl.textContent = '' }, 2000)
    }
  })
})
