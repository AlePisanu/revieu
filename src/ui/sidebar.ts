/**
 * sidebar.ts — UI della sidebar iniettata nella pagina GitHub.
 *
 * Responsabilità:
 * 1. Creare e iniettare il pannello sidebar nel DOM di GitHub
 * 2. Gestire apertura/chiusura della sidebar
 * 3. Collegare i controlli (mode, tone, provider) all'analyzer
 * 4. Renderizzare la review AI come HTML (markdown → HTML via `marked`)
 * 5. Gestire il caso "diff troppo grande" mostrando un selettore file
 *
 * Pattern: CONTROLLER
 * Questo file è il collante tra la UI (DOM) e la logica (analyzer).
 * Non contiene logica di business — legge input dalla UI, chiama l'analyzer,
 * e mostra il risultato. Tutto il lavoro pesante è delegato.
 *
 * Come funziona l'iniezione:
 * Il content script (content.ts) chiama createSidebar() che:
 * - Crea un div con id "revieu-sidebar" e lo appende al body
 * - Crea un tab laterale per aprire/chiudere la sidebar
 * - Gli stili CSS vengono dal file sidebar.css iniettato dal manifest
 *
 * Nota sul cloneNode in wireAnalyzer:
 * Quando l'estensione viene ricaricata durante lo sviluppo, Chrome inietta
 * un nuovo content script SENZA rimuovere il vecchio. Ogni script aggiunge
 * un listener al bottone → click multipli. Il clone rimuove tutti i listener.
 */

import type { Adapter } from '../types'
import { analyze, TooLargeError } from '../core/analyzer'
import { marked } from 'marked'

// ID degli elementi DOM della sidebar — usati per i querySelector
const SIDEBAR_ID = 'revieu-sidebar'
const TAB_ID = 'revieu-tab'
/** Larghezza della sidebar — usata anche per spostare il body a sinistra */
const SIDEBAR_WIDTH = '380px'

const PR_ICON = '<svg class="revieu-btn-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path fill-rule="evenodd" d="M7 8.83a3.001 3.001 0 1 0-2 0v6.34a3.001 3.001 0 1 0 2 0zM6 5a1 1 0 1 0 0 2a1 1 0 0 0 0-2m0 12a1 1 0 1 0 0 2a1 1 0 0 0 0-2m11-1.83a3.001 3.001 0 1 0 2 0V10.4A5.4 5.4 0 0 0 13.6 5h-.186l.293-.293a1 1 0 0 0-1.414-1.414l-2 2a1 1 0 0 0 0 1.414l2 2a1 1 0 1 0 1.414-1.414L13.414 7h.186a3.4 3.4 0 0 1 3.4 3.4zM17 18a1 1 0 1 1 2 0a1 1 0 0 1-2 0" clip-rule="evenodd"/></svg>';
const TRASH_ICON = '<svg class="revieu-btn-icon" width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5m3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0z"/><path d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4zM2.5 3h11V2h-11z"/></svg>';

// ===========================================================================
// CREAZIONE SIDEBAR
// ===========================================================================

/**
 * Crea e inietta la sidebar nel DOM della pagina.
 * Se già presente (navigazione SPA), ritorna quella esistente.
 *
 * La sidebar contiene:
 * - Header con titolo e bottone chiudi
 * - Controlli: mode (diff/full), tone, provider
 * - Bottone "Analyze PR" (disabilitato finché non c'è una API key)
 * - Area output dove viene renderizzata la review
 * - Footer con bottone "Copy" e stima token (nascosto fino a review completata)
 */
export const createSidebar = (): HTMLElement => {
  // Evita doppia iniezione (GitHub è una SPA, il content script può rieseguire)
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
        <label class="revieu-label">
          Provider
          <select class="revieu-select" data-setting="provider">
            <option value="anthropic">Claude</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
      </div>
    </div>
  </div>
  <div class="revieu-body">
    <div class="revieu-output"></div>
    <div class="revieu-btn-row">
      <button class="revieu-analyze-btn" disabled>${PR_ICON} Analyze PR</button>
      <button class="revieu-clear-btn" title="Clear output">${TRASH_ICON}</button>
    </div>
    <div class="revieu-footer revieu-hidden-el">
      <button class="revieu-copy-btn">Copy review</button>
      <span class="revieu-token-hint"></span>
    </div>
  </div>
`

  // Tab laterale — sempre visibile sul bordo destro, apre la sidebar al click
  const tab = document.createElement('div')
  tab.id = TAB_ID

  const img = document.createElement('img')
  img.src = chrome.runtime.getURL('icons/logo-48.png')
  img.alt = 'Revieu'
  img.style.width = '20px'
  img.style.height = '20px'

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

  // Chiude cliccando fuori
  document.addEventListener('click', (e) => {
    if (!settingsPopover.contains(e.target as Node) && e.target !== settingsTrigger) {
      closePopover()
    }
  })

  // Evita che click dentro il popover lo chiudano
  settingsPopover.addEventListener('click', (e) => e.stopPropagation())

  // Wire clear button — persistente, non serve cloneNode
  const clearBtn = getClearButton()
  clearBtn?.addEventListener('click', () => {
    const output = getOutputElement()
    if (output) output.innerHTML = ''
    hideFooter()
    hideClearButton()
  })

  // Parte chiusa di default
  sidebar.classList.add('revieu-hidden')

  return sidebar
}

// ===========================================================================
// APERTURA / CHIUSURA
// ===========================================================================

/**
 * Apre o chiude la sidebar.
 * Quando aperta, sposta il body a sinistra (marginRight) per fare spazio.
 * @param open - true per aprire, false per chiudere, undefined per toggle
 */
export const toggleSidebar = (open?: boolean): void => {
  const sidebar = document.getElementById(SIDEBAR_ID)
  const tab = document.getElementById(TAB_ID)
  if (!sidebar || !tab) return

  const shouldOpen = open ?? sidebar.classList.contains('revieu-hidden')

  if (shouldOpen) {
    sidebar.classList.remove('revieu-hidden')
    tab.classList.add('revieu-tab-hidden')
    // Sposta il body per evitare che la sidebar copra il contenuto
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
 * Carica i settings salvati dal background e li applica ai selettori della sidebar.
 * Abilita il bottone "Analyze PR" solo se almeno una API key è configurata.
 */
export const loadSettings = (): void => {
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (settings) => {
    if (!settings) return

    // Applica i valori salvati a ogni select (mode, tone, provider)
    // Il data-setting sull'HTML matcha la chiave nello storage
    const selects = document.querySelectorAll<HTMLSelectElement>(`#${SIDEBAR_ID} .revieu-select`)
    for (const select of selects) {
      const key = select.dataset.setting as string
      if (key in settings) {
        select.value = settings[key]
      }
    }

    // Il bottone è disabilitato finché non c'è almeno una API key
    const btn = getAnalyzeButton()
    if (btn) {
      const hasKey = settings.anthropicKey || settings.geminiKey
      btn.disabled = !hasKey
    }
  })
}

/** Legge i valori correnti dai selettori della sidebar */
export const getSelectedSettings = (): { mode: string; tone: string; provider: string } => {
  const get = (name: string) => {
    const el = document.querySelector<HTMLSelectElement>(`#${SIDEBAR_ID} [data-setting="${name}"]`)
    return el?.value ?? ''
  }

  return { mode: get('mode'), tone: get('tone'), provider: get('provider') }
}

// ===========================================================================
// HELPER DOM
// ===========================================================================

/** Ritorna il contenitore dove viene renderizzata la review */
export const getOutputElement = (): HTMLElement | null => {
  return document.querySelector(`#${SIDEBAR_ID} .revieu-output`)
}

/** Ritorna il bottone "Analyze PR" */
export const getAnalyzeButton = (): HTMLButtonElement | null => {
  return document.querySelector(`#${SIDEBAR_ID} .revieu-analyze-btn`)
}

/** Ritorna il bottone "Clear" */
const getClearButton = (): HTMLButtonElement | null => {
  return document.querySelector(`#${SIDEBAR_ID} .revieu-clear-btn`)
}

/** Mostra il bottone clear con animazione */
const showClearButton = (): void => {
  getClearButton()?.classList.add('revieu-clear-visible')
}

/** Nasconde il bottone clear con animazione */
const hideClearButton = (): void => {
  getClearButton()?.classList.remove('revieu-clear-visible')
}

// ===========================================================================
// COLLEGAMENTO ANALYZE BUTTON → ANALYZER
// ===========================================================================

/**
 * Collega il click del bottone "Analyze PR" all'intero flusso di review.
 *
 * Flusso al click:
 * 1. Legge i settings dal background (API key, mode, tone, provider)
 * 2. Resetta l'output e mostra "Analyzing..."
 * 3. Chiama analyze() passando un callback onChunk che:
 *    - Accumula il markdown grezzo ricevuto in streaming
 *    - Lo converte in HTML con `marked` e lo inietta nell'output
 * 4. Se il diff è troppo grande → mostra il selettore file
 * 5. Se c'è un errore → mostra il messaggio di errore
 * 6. A fine review → mostra footer con "Copy review" e stima token
 */
export const wireAnalyzer = (adapter: Adapter): void => {
  const oldBtn = getAnalyzeButton()
  if (!oldBtn) return

  // Clona il bottone per rimuovere eventuali listener duplicati
  // (vedi nota nel commento del file sopra)
  const btn = oldBtn.cloneNode(true) as HTMLButtonElement
  oldBtn.replaceWith(btn)

  btn.addEventListener('click', () => {
    const output = getOutputElement()
    if (!output) return

    chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, async (settings) => {
      if (!settings) return

      const { mode, tone, provider } = getSelectedSettings()
      // Prende la API key giusta in base al provider selezionato
      const apiKey = provider === 'anthropic' ? settings.anthropicKey : settings.geminiKey

      if (!apiKey) {
        output.innerHTML = '<p class="revieu-error">No API key configured. Click the Revieu icon in the toolbar to add one.</p>'
        return
      }

      output.innerHTML = ''
      hideFooter()
      hideClearButton()
      btn.disabled = true
      btn.innerHTML = `${PR_ICON} Analyzing...`

      // Accumula il markdown grezzo — serve per il copy e la stima token
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
            // Ri-renderizza tutto il markdown ad ogni chunk.
            // Non è il più efficiente, ma `marked` è veloce e garantisce
            // che il rendering sia sempre coerente (no artefatti parziali).
            output.innerHTML = marked.parse(rawMarkdown) as string
            colorizeHeaders(output)
          },
        })
        showFooter(rawMarkdown)
        showClearButton()
      } catch (err) {
        // TooLargeError: il diff supera il limite → mostra selettore file
        if (err instanceof TooLargeError) {
          renderFileSelector(output, err.files, adapter, settings)
          showClearButton()
          return
        }

        const message = err instanceof Error ? err.message : 'An unexpected error occurred.'
        output.innerHTML = `<p class="revieu-error">${message}</p>`
        showClearButton()
      }
    })
  })
}

// ===========================================================================
// FOOTER (copy + stima token)
// ===========================================================================

/**
 * Stima approssimativa dei token — ~4 caratteri per token.
 * Non è precisa (ogni modello tokenizza diversamente),
 * ma dà un'idea del costo della review.
 */
const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

/** Mostra il footer con il bottone copy e la stima token */
const showFooter = (reviewText: string): void => {
  const footer = document.querySelector(`#${SIDEBAR_ID} .revieu-footer`)
  const hint = document.querySelector(`#${SIDEBAR_ID} .revieu-token-hint`)
  if (!footer || !hint) return

  hint.textContent = `~${estimateTokens(reviewText)} tokens`
  footer.classList.remove('revieu-hidden-el')

  // Collega il bottone copy — usa la Clipboard API del browser
  const copyBtn = footer.querySelector('.revieu-copy-btn') as HTMLButtonElement
  copyBtn.onclick = async () => {
    await navigator.clipboard.writeText(reviewText)
    copyBtn.textContent = 'Copied!'
    setTimeout(() => { copyBtn.textContent = 'Copy review' }, 2000)
  }
}

/** Nasconde il footer (prima di una nuova analisi) */
const hideFooter = (): void => {
  const footer = document.querySelector(`#${SIDEBAR_ID} .revieu-footer`)
  if (footer) footer.classList.add('revieu-hidden-el')
}

// ===========================================================================
// SELETTORE FILE (quando il diff è troppo grande)
// ===========================================================================

/**
 * Mostra un elenco di checkbox con i file della PR.
 * L'utente sceglie quali file analizzare.
 *
 * Quando clicca "Analyze selected":
 * - Prende i file selezionati
 * - Ri-chiama analyze() con selectedFiles e initialFiles
 *   (initialFiles evita di ri-estrarre il diff da zero)
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
    analyzeBtn.innerHTML = `${PR_ICON} Analyzing...`
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
    <div class="revieu-file-list">${list}</div>
    <div class="revieu-btn-row">
      <button class="revieu-analyze-selected-btn">Analyze selected</button>
      <button class="revieu-clear-btn" title="Clear output">${TRASH_ICON}</button>
    </div>
  `

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
        // Passa i file già parsati per evitare di ri-estrarre il diff
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