# Revieu — Architecture

## Overview

Revieu is a Chrome Extension (Manifest v3) that injects a sidebar into GitHub PR pages and performs AI-powered code review via the Anthropic or Gemini API. The architecture is split into four independent layers — adapters, providers, core, UI — so that adding a new platform (GitLab) or a new model (WebLLM) requires touching only one layer.

---

## Project structure

```
revieu/
├── manifest.json
├── build.js                  # esbuild config — watch + prod
├── package.json
├── tsconfig.json
├── src/
│   ├── content.ts            # Entry point injected by Chrome into GitHub pages
│   ├── background.ts         # Service worker — storage, messaging
│   ├── adapters/
│   │   ├── github.ts         # Reads diff, context, full files from GitHub DOM
│   │   └── gitlab.ts         # (v2) GitLab MR support
│   ├── providers/
│   │   ├── anthropic.ts      # Streams from api.anthropic.com
│   │   ├── gemini.ts         # Streams from Gemini Flash (free tier)
│   │   └── webllm.ts         # (v3) Local inference via WebGPU
│   ├── core/
│   │   ├── analyzer.ts       # Orchestrator: adapter → parser → prompt → provider
│   │   ├── parser.ts         # Normalizes raw diff, detects language
│   │   ├── prompt.ts         # Builds system prompt + user message
│   │   └── dependencies.ts   # Extracts import graph from changed files
│   ├── types.ts              # Shared interfaces: DiffFile, RawDiff, Provider, Adapter
│   └── ui/
│       ├── sidebar.ts        # Injects and manages the sidebar
│       └── sidebar.css
└── popup/
    ├── popup.html            # API key setup + advanced settings
    └── popup.ts
```

---

## Data flow

```
GitHub PR page
      │
      ▼
content.js  (injected by Chrome)
      │  detects PR page, initializes sidebar
      ▼
sidebar.js
      │  user clicks "Analyze PR"
      ▼
analyzer.js
      │
      ├──► github.js
      │       extractContext()  → { title, description }
      │       extractDiff()     → RawDiff[]
      │       fetchFullFile()   → string | null  (if mode = full)
      │
      ├──► parser.js
      │       parseDiff()       → DiffFile[]
      │
      ├──► dependencies.js
      │       buildGraph()      → DependencyMap
      │
      ├──► prompt.js
      │       buildSystemPrompt(tone)
      │       buildUserMessage(context, files, mode, depMap)
      │
      └──► anthropic.js / gemini.js
               stream(prompt, onChunk) → sidebar renders chunks
```

---

## Core data types

```typescript
interface DiffFile {
  path: string            // file path relative to repo root, e.g. "src/components/Button.tsx"
  language: string        // detected from file extension, e.g. "TypeScript (React)"
  additions: string[]     // added lines, without the leading +
  deletions: string[]     // removed lines, without the leading -
  fullContent: string | null  // full file content, only in full context mode
  fullLineCount: number | null
  totalLines: number      // additions + deletions, used for the 300-line cap
}

interface RawDiff {
  path: string
  additions: string[]
  deletions: string[]
  fullContent?: string    // populated by the adapter if full context was fetched
}

// output of dependencies.ts
// each key is a changed file path, value is the list of other changed files it imports from
// e.g. { "hooks/useAuth.ts": ["api/auth.ts"] }
type DependencyMap = Record<string, string[]>

interface Provider {
  stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void>
}

interface Adapter {
  isMatch(url: string): boolean
  extractContext(): { title: string; description: string }
  extractDiff(): RawDiff[]
  fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }>
}
```

---

## Adapters

Each adapter knows how to read a specific platform's DOM. The rest of the system only speaks `RawDiff[]` — it never cares which platform it's on.

### GitHub Adapter (v1)

GitHub renders the diff as HTML. Key selectors:

```javascript
'.blob-code-addition .blob-code-inner'  // added lines (green)
'.blob-code-deletion .blob-code-inner'  // removed lines (red)
'[data-path]'                           // file path
'.js-issue-title'                       // PR title
'.comment-body p'                       // PR description
```

### Full file fetch strategy

Three strategies in cascade — no GitHub token required for the common case:

```
Is the repo public?
  YES → fetch raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
        Fast, no auth, returns full file content.

  NO (private repo)
    Is a GitHub token configured in advanced settings?
      YES → GitHub API: GET /repos/{owner}/{repo}/contents/{path}
            Requires repo scope token.

      NO  → DOM expand: click .js-expand-btn elements in the file container,
            wait for GitHub to load additional context lines,
            read all .blob-code-inner lines.
            Partial content, but significantly more than the default 3-line context.
            A banner informs the user.
```

### GitLab Adapter (v2)

Same interface, different selectors. Targets `/merge_requests/*` URLs.

---

## Providers

### Anthropic (v1)

Model: `claude-haiku-4-5` — cheapest Anthropic model, sufficient for code review. Uses SSE streaming. A typical PR review costs fractions of a cent.

### Gemini Flash (v1)

Model: `gemini-2.0-flash` — genuinely free tier (15 RPM, no billing required). Uses streaming via the `streamGenerateContent` endpoint.

### WebLLM (v3 roadmap)

Runs a quantized model locally via WebGPU. No API key, no data leaves the browser.

- Recommended: `Qwen2.5-Coder-7B-Instruct` (~5.5GB VRAM) — best quality for code tasks
- Fallback: `Phi-3.5-mini-instruct` (~2.5GB VRAM) — works on integrated GPUs

First load downloads and caches the model in the browser. A progress bar is shown. Subsequent uses are instant.

---

## Prompt design

### System prompt

```
You are a senior software engineer doing a pull request code review.
Analyze the provided code and give clear, actionable feedback.
Focus on: correctness, edge cases, readability, performance, potential bugs.
Use markdown. Be direct and concise. Max 600 words.
[tone modifier]
```

Tone modifiers:
- `balanced` — no addition
- `strict` — "Be thorough. Flag even minor issues — naming, edge cases, missing null checks."
- `security` — "Prioritize security above all. Look for injection risks, data exposure, auth issues, insecure defaults."

### User message structure

```
## PR: Fix race condition in auth token refresh
**Description:** Resolves #412 — users were being logged out randomly...

## Dependency map
- hooks/useAuth.ts imports from api/auth.ts
- components/LoginForm.tsx imports from hooks/useAuth.ts

## Changes

### src/api/auth.ts (TypeScript)
**Full file:** [full content — if mode=full]
**Modified lines:**
+ added line
- removed line

### src/hooks/useAuth.ts (TypeScript (React))
...
```

The dependency map costs almost nothing in tokens but gives the model structural information about which files call which — so it can reason about cross-file impact without guessing.

---

## Dependency map

`dependencies.js` does lightweight static analysis of import statements in the changed files:

```javascript
// matches: import { x } from '../api/auth'
//          import x from './utils'
//          require('../config')
const IMPORT_RE = /(?:from|require)\s*['"]([^'"]+)['"]/g
```

Only intra-PR dependencies are mapped — no need to analyze the entire codebase.

---

## Large diff handling

If total diff lines exceed 300, the analyzer throws `TOO_LARGE` and the sidebar shows a file selector. The user picks which files to analyze. This avoids silent context window truncation — the user always knows what's being analyzed.

---

## Storage schema

```javascript
// chrome.storage.sync
{
  anthropicKey: string,
  geminiKey: string,
  githubToken: string,   // optional, advanced settings only
  provider: 'anthropic' | 'gemini',
  tone: 'balanced' | 'strict' | 'security',
  mode: 'diff' | 'full',
}
```

---

## manifest.json (key fields)

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "activeTab", "scripting"],
  "host_permissions": [
    "https://github.com/*",
    "https://raw.githubusercontent.com/*",
    "https://api.github.com/*",
    "https://api.anthropic.com/*",
    "https://generativelanguage.googleapis.com/*"
  ],
  "content_scripts": [{
    "matches": ["https://github.com/*/pull/*"],
    "js": ["src/content.js"],
    "css": ["src/ui/sidebar.css"]
  }]
}
```

---

## Security notes

- API keys never leave the browser except in direct calls to provider APIs
- In Diff only mode, only changed lines are sent to the model
- In Full context mode (public repos), file content is fetched from `raw.githubusercontent.com` — GitHub's own CDN
- No eval(), no remote code execution, strict CSP enforced
- GitHub token is optional, stored in `chrome.storage.sync`, used only for private repo full context
