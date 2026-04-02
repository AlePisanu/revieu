/**
 * popup.ts — Script del popup dell'estensione (click sull'icona nella toolbar).
 *
 * Il popup è la finestra che appare quando l'utente clicca sull'icona
 * di Revieu nella barra degli strumenti di Chrome.
 * Serve per configurare le API key (Anthropic, Gemini) e il token GitHub.
 *
 * Flusso:
 * 1. All'apertura del popup, carica i settings dal background (GET_SETTINGS)
 * 2. Riempie i campi con i valori salvati
 * 3. Al click su "Save", manda i nuovi valori al background (SAVE_SETTINGS)
 *
 * I settings vengono salvati in chrome.storage.sync (sincronizzato tra dispositivi)
 * tramite il background script. Il popup non accede allo storage direttamente —
 * comunica solo via messaggi.
 */

const anthropicInput = document.getElementById('anthropic-key') as HTMLInputElement
const geminiInput = document.getElementById('gemini-key') as HTMLInputElement
const githubInput = document.getElementById('github-token') as HTMLInputElement
const saveBtn = document.getElementById('save-btn') as HTMLButtonElement
const statusEl = document.getElementById('status') as HTMLElement

// Carica i settings salvati quando il popup si apre
chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
  if (!settings) return
  anthropicInput.value = settings.anthropicKey ?? ''
  geminiInput.value = settings.geminiKey ?? ''
  githubInput.value = settings.githubToken ?? ''
})

// Salva tutti i settings al click su "Save"
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
