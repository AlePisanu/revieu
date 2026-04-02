/**
 * content.ts — Entry point del content script.
 *
 * Questo file viene iniettato da Chrome in ogni pagina che matcha
 * i pattern definiti nel manifest.json (es. "https://github.com/*").
 *
 * Responsabilità:
 * 1. Verificare se la pagina corrente è una PR GitHub
 * 2. Se sì, iniettare la sidebar e collegare l'analyzer
 * 3. Gestire la navigazione SPA di GitHub (che non ricarica la pagina)
 *
 * Perché il MutationObserver sul <title>:
 * GitHub è una Single Page Application — quando navighi tra le pagine,
 * il browser NON ricarica il content script. La URL cambia ma il JS resta lo stesso.
 * Osserviamo il tag <title> perché GitHub lo aggiorna ad ogni navigazione.
 * Quando il title cambia → controlliamo se la nuova pagina è una PR → re-init.
 */

import { GitHubAdapter } from './adapters/github'
import { createSidebar, loadSettings, wireAnalyzer } from './ui/sidebar'

// Singleton dell'adapter — uno per tutta la vita del content script
const adapter = new GitHubAdapter()

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

const titleObserver = new MutationObserver(() => {
  const currentUrl = window.location.href
  // Se la URL non è cambiata, il title è cambiato per altro (es. notifiche)
  if (currentUrl === lastUrl) return

  lastUrl = currentUrl
  init()
})

// Osserva le modifiche al <title> (childList = cambio del testo interno)
const titleEl = document.querySelector('title')
if (titleEl) {
  titleObserver.observe(titleEl, { childList: true })
}
