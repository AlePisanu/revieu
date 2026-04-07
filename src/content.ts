/**
 * content.ts — Entry point del content script.
 *
 * Questo file viene iniettato da Chrome in ogni pagina GitHub
 * (match pattern: "https://github.com/*" nel manifest).
 *
 * Responsabilità:
 * 1. Verificare se la pagina corrente è una PR GitHub
 * 2. Se sì, iniettare la sidebar e collegare l'analyzer
 * 3. Gestire la navigazione SPA di GitHub (che non ricarica la pagina)
 *
 * Rilevamento navigazione SPA:
 * GitHub usa Turbo per la navigazione — non ricarica la pagina ma sostituisce
 * il DOM. Usiamo tre strategie per intercettare la navigazione:
 * 1. turbo:render — evento custom di Turbo, il più affidabile per GitHub
 * 2. popstate — cattura back/forward del browser
 * 3. Polling ogni 1s — fallback per qualsiasi edge case
 */

import { GitHubAdapter } from './adapters/github'
import { createSidebar, loadSettings, wireAnalyzer } from './ui/sidebar'

// Singleton dell'adapter — uno per tutta la vita del content script
const adapter = new GitHubAdapter()

/**
 * Controlla se il contesto dell'estensione è ancora valido.
 * Quando l'estensione viene ricaricata (es. durante sviluppo),
 * Chrome inietta un nuovo content script ma il vecchio resta in pagina.
 * Il vecchio script non può più usare chrome.runtime → "Extension context invalidated".
 */
const isContextValid = (): boolean => {
  try {
    return !!chrome.runtime?.id
  } catch {
    return false
  }
}

/**
 * Inizializza l'estensione sulla pagina corrente.
 * Chiamata al primo caricamento e ad ogni navigazione SPA.
 */
const init = () => {
  // Se non siamo su una PR GitHub, non fare nulla
  if (!adapter.isMatch(window.location.href)) return

  // Inietta la sidebar (no-op se già presente)
  createSidebar()
  // Sincronizza i selettori con i settings salvati
  loadSettings()
  // Collega il bottone "Analyze PR" al flusso di review
  wireAnalyzer(adapter)
}

// Inizializza al primo caricamento della pagina
init()

// --- Gestione navigazione SPA ---
// Tracciamo l'ultima URL vista. Quando cambia, re-inizializziamo.
let lastUrl = window.location.href
let pollTimer: ReturnType<typeof setInterval> | null = null

/**
 * Callback per rilevamento navigazione SPA.
 * Se il contesto dell'estensione è stato invalidato (reload/update),
 * rimuove tutti i listener e ferma il polling per evitare errori in console.
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

/** Rimuove listener e timer quando il contesto dell'estensione non è più valido */
const cleanup = () => {
  if (pollTimer) {
    clearInterval(pollTimer)
    pollTimer = null
  }
  document.removeEventListener('turbo:render', onUrlChange)
  window.removeEventListener('popstate', onUrlChange)
}

// 1. turbo:render — GitHub usa Turbo per navigazione SPA.
//    Turbo dispatcha questo evento sul document dopo ogni navigazione.
//    Gli eventi DOM custom sono visibili ai content script (DOM condiviso).
document.addEventListener('turbo:render', onUrlChange)

// 2. popstate — cattura navigazione back/forward del browser
window.addEventListener('popstate', onUrlChange)

// 3. Polling — fallback per edge case che gli eventi non coprono
//    (es. navigazione via API History non intercettata).
//    Controlla solo window.location.href vs stringa cached, costo ~0.
pollTimer = setInterval(onUrlChange, 1000)
