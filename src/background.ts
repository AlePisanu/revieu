/**
 * background.ts — Service worker dell'estensione (Manifest V3).
 *
 * Gira in un contesto isolato dal DOM della pagina. Non può accedere
 * a document, window, ecc. — può solo:
 * - Ricevere messaggi da popup e content script via chrome.runtime.onMessage
 * - Fare fetch HTTP senza restrizioni CORS (il background ha permessi speciali)
 * - Leggere/scrivere chrome.storage
 *
 * Pattern: MESSAGE BUS
 * Il background fa da "centralina" tra le parti dell'estensione.
 * Popup e content script mandano messaggi tipizzati (Message),
 * il background li gestisce e risponde in modo asincrono.
 *
 * Perché le fetch passano da qui:
 * Il content script gira nella pagina di GitHub e ha le stesse restrizioni
 * CORS del browser. Il background invece può fare fetch a qualsiasi URL
 * (github.com/...diff, api.github.com, ecc.) senza essere bloccato.
 */

// ---------------------------------------------------------------------------
// STORAGE: schema dei dati salvati in chrome.storage.sync
// ---------------------------------------------------------------------------

/**
 * Struttura dei settings dell'estensione.
 * chrome.storage.sync li sincronizza tra i dispositivi dell'utente.
 * L'index signature [key: string] è richiesta da chrome.storage.sync.get()
 * che si aspetta un tipo compatibile con Record<string, unknown>.
 */
interface StorageData {
  anthropicKey: string
  geminiKey: string
  /** Token GitHub per accedere a repo private in mode "Full context" */
  githubToken: string
  provider: 'anthropic' | 'gemini'
  tone: 'balanced' | 'strict' | 'security'
  mode: 'diff' | 'full'
  [key: string]: string
}

/** Valori di default usati quando l'utente non ha ancora configurato nulla */
const DEFAULTS: StorageData = {
  anthropicKey: '',
  geminiKey: '',
  githubToken: '',
  provider: 'gemini',
  tone: 'balanced',
  mode: 'diff',
}

// ---------------------------------------------------------------------------
// MESSAGGI: tipi di messaggi che il background può ricevere
// ---------------------------------------------------------------------------

/**
 * Union type di tutti i messaggi supportati.
 * Ogni tipo ha un campo `type` discriminante e un payload opzionale.
 * Questo pattern (discriminated union) permette a TypeScript di
 * restringere il tipo automaticamente dentro ogni `if`.
 */
type Message =
  | { type: 'GET_SETTINGS' }
  | { type: 'SAVE_SETTINGS'; payload: Partial<StorageData> }
  | { type: 'FETCH_GITHUB_DIFF'; payload: { url: string } }
  | { type: 'FETCH_GITHUB_FILE'; payload: { url: string; token?: string } }

// ---------------------------------------------------------------------------
// HANDLER: gestisce i messaggi in arrivo da popup e content script
// ---------------------------------------------------------------------------

chrome.runtime.onMessage.addListener((message: Message, _sender, sendResponse) => {

  // --- Legge i settings dallo storage e li ritorna al chiamante ---
  if (message.type === 'GET_SETTINGS') {
    // Il secondo argomento di .get() sono i default: se un campo non esiste
    // nello storage, viene riempito con il valore di DEFAULTS.
    chrome.storage.sync.get(DEFAULTS, (data) => {
      sendResponse(data as StorageData)
    })
    // `return true` dice a Chrome di tenere aperto il canale del messaggio
    // finché non chiamiamo sendResponse (che succede in modo asincrono).
    // Senza questo, Chrome chiude il canale prima che lo storage risponda.
    return true
  }

  // --- Salva i settings nello storage ---
  if (message.type === 'SAVE_SETTINGS') {
    // Partial<StorageData> permette di salvare anche un solo campo
    // senza dover passare tutti i settings ogni volta.
    chrome.storage.sync.set(message.payload, () => {
      sendResponse({ success: true })
    })
    return true
  }

  // --- Scarica il diff unificato di una PR (es. github.com/.../pull/42.diff) ---
  // Usato dall'adapter per ottenere il diff in formato testo.
  // credentials: 'include' manda i cookie dell'utente, così funziona
  // anche se l'utente è loggato su GitHub con una sessione attiva.
  if (message.type === 'FETCH_GITHUB_DIFF') {
    fetch(message.payload.url, {
      method: 'GET',
      credentials: 'include',
      headers: { Accept: 'text/plain' },
    })
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, status: response.status })
          return
        }
        sendResponse({
          ok: true,
          status: response.status,
          text: await response.text(),
        })
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, status: 0, error: detail })
      })
    return true
  }

  // --- Scarica il contenuto completo di un file da GitHub ---
  // Usato in mode "Full context" per dare all'AI l'intero file, non solo il diff.
  // L'header Accept: application/vnd.github.v3.raw dice all'API di GitHub
  // di ritornare il file grezzo (testo) invece del JSON con il base64.
  // Il token Authorization è opzionale: serve solo per repo private.
  if (message.type === 'FETCH_GITHUB_FILE') {
    const headers: Record<string, string> = { Accept: 'application/vnd.github.v3.raw' }

    if (message.payload.token) {
      headers['Authorization'] = `Bearer ${message.payload.token}`
    }

    fetch(message.payload.url, { method: 'GET', headers })
      .then(async (response) => {
        if (!response.ok) {
          sendResponse({ ok: false, status: response.status })
          return
        }
        sendResponse({
          ok: true,
          status: response.status,
          text: await response.text(),
        })
      })
      .catch((error: unknown) => {
        const detail = error instanceof Error ? error.message : String(error)
        sendResponse({ ok: false, status: 0, error: detail })
      })
    return true
  }
})
