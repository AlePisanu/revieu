/**
 * types.ts — Contratti condivisi tra tutti i moduli dell'estensione.
 *
 * Pattern: DEPENDENCY INVERSION
 * Nessun modulo importa un'implementazione concreta (es. GitHubAdapter).
 * Tutti dipendono da queste interfacce. Questo permette di:
 * - Aggiungere nuovi adapter (es. GitLab) senza toccare analyzer/prompt/sidebar
 * - Testare ogni modulo in isolamento con mock che implementano l'interfaccia
 *
 * Il flusso dei dati segue questa pipeline:
 *   Adapter.extractDiff() → RawDiff[] → parser.parseDiff() → DiffFile[] → prompt → AI
 */

// ---------------------------------------------------------------------------
// DATA: strutture dati che viaggiano nella pipeline
// ---------------------------------------------------------------------------

/**
 * RawDiff — dati grezzi estratti dall'adapter (es. dal .diff di GitHub).
 * Non ha ancora informazioni derivate come il linguaggio.
 * È il formato "intermedio" tra la sorgente (GitHub) e il nostro parser.
 */
export interface RawDiff {
  /** Percorso del file nella repo (es. "src/core/parser.ts") */
  path: string

  /** Righe aggiunte (quelle con "+" nel diff) */
  additions: string[]

  /** Righe rimosse (quelle con "-" nel diff) */
  deletions: string[]

  /**
   * Righe di contesto — codice NON modificato che circonda le modifiche.
   * GitHub include ~3 righe prima e dopo ogni hunk nel diff unificato.
   * Servono all'AI per capire cosa c'è attorno al codice cambiato
   * e ridurre i falsi positivi nella review.
   */
  context: string[]

  /**
   * Contenuto completo del file (opzionale).
   * Popolato solo in mode "full" quando si fa fetch del file intero via API.
   */
  fullContent?: string
}

/**
 * DiffFile — versione "arricchita" di RawDiff, pronta per costruire il prompt.
 * Il parser aggiunge informazioni derivate come il linguaggio e il conteggio righe.
 */
export interface DiffFile {
  path: string
  /** Linguaggio rilevato dall'estensione del file (es. "TypeScript", "Python") */
  language: string
  additions: string[]
  deletions: string[]
  context: string[]
  /** Contenuto completo del file, null se non disponibile */
  fullContent: string | null
  /** Numero di righe del file completo, null se fullContent non è disponibile */
  fullLineCount: number | null
  /** Somma di additions + deletions — usato per stimare la dimensione del diff */
  totalLines: number
}

// ---------------------------------------------------------------------------
// PROVIDER: interfaccia per i servizi AI (Claude, Gemini, ecc.)
// ---------------------------------------------------------------------------

/**
 * Provider — contratto che ogni servizio AI deve implementare.
 *
 * Pattern: STRATEGY
 * L'analyzer non sa se sta parlando con Claude o Gemini.
 * Chiama solo `stream()` e riceve i chunk di testo via callback.
 * Per aggiungere un nuovo provider (es. OpenAI) basta creare una nuova
 * classe che implementa questa interfaccia.
 */
export interface Provider {
  /**
   * Invia il prompt all'AI e streama la risposta chunk per chunk.
   * @param systemPrompt - istruzioni di sistema (tono, formato output)
   * @param userMessage - il messaggio con il diff e il contesto della PR
   * @param onChunk - callback chiamata per ogni pezzo di testo ricevuto
   */
  stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void>
}

// ---------------------------------------------------------------------------
// ADAPTER: interfaccia per le piattaforme (GitHub, GitLab, ecc.)
// ---------------------------------------------------------------------------

/**
 * Adapter — contratto che ogni piattaforma deve implementare.
 *
 * Pattern: ADAPTER (da qui il nome)
 * Traduce i dettagli specifici di una piattaforma (GitHub DOM, API, ecc.)
 * in un formato standard che il resto dell'app capisce (RawDiff[]).
 * Per supportare GitLab basterebbe creare un GitLabAdapter che implementa
 * questa interfaccia — tutto il resto del codice resta uguale.
 */
export interface Adapter {
  /** Controlla se l'URL corrente è una PR su questa piattaforma */
  isMatch(url: string): boolean

  /** Estrae titolo e descrizione della PR dalla pagina */
  extractContext(): { title: string; description: string }

  /** Estrae i diff di tutti i file modificati nella PR */
  extractDiff(): Promise<RawDiff[]>

  /**
   * Scarica il contenuto completo di un file dalla PR.
   * Usato in mode "full" per dare all'AI il contesto dell'intero file.
   * @returns content: il testo del file, source: da dove è stato scaricato
   */
  fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }>
}
