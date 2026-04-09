const anthropicInput = document.getElementById('anthropic-key') as HTMLInputElement
const geminiInput = document.getElementById('gemini-key') as HTMLInputElement
const githubInput = document.getElementById('github-token') as HTMLInputElement
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement
const onboardingEl = document.getElementById('onboarding') as HTMLElement

chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
  if (!settings) return
  anthropicInput.value = settings.anthropicKey ?? ''
  geminiInput.value = settings.geminiKey ?? ''
  githubInput.value = settings.githubToken ?? ''

  if (!settings.popupOnboarded) {
    onboardingEl.classList.remove('hidden')
  }
})

saveBtn.addEventListener('click', () => {
  const payload: Record<string, string> = {
    anthropicKey: anthropicInput.value.trim(),
    geminiKey: geminiInput.value.trim(),
    githubToken: githubInput.value.trim(),
  }

  if (!onboardingEl.classList.contains('hidden')) {
    payload.popupOnboarded = '1'
    onboardingEl.classList.add('hidden')
  }

  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', payload }, (response) => {
    if (response?.success) {
      statusEl.textContent = 'Saved'
      setTimeout(() => { statusEl.textContent = '' }, 2000)
    }
  })
})
