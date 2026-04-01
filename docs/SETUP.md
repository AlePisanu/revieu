# Revieu — Setup & Local Development

## Prerequisites

- Node.js >= 18
- Chrome or Chromium
- At least one API key:
  - Anthropic: [console.anthropic.com](https://console.anthropic.com/settings/keys)
  - Google Gemini (free, no billing): [aistudio.google.com](https://aistudio.google.com/app/apikey)

---

## Install

```bash
git clone https://github.com/yourusername/revieu
cd revieu
npm install
```

---

## Development

```bash
npm run dev
```

Watches `src/` and `popup/` and rebuilds to `dist/` on every save.

### Load the extension in Chrome

1. Open `chrome://extensions`
2. Enable **Developer mode** (top right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

After any code change, click the **refresh icon** on the Revieu card in `chrome://extensions`.

---

## Production build

```bash
npm run build
```

Minified output in `dist/`.

---

## First run

1. Click the Revieu icon in the Chrome toolbar
2. Enter your API key (Anthropic and/or Gemini)
3. Navigate to any GitHub PR
4. Choose mode and tone in the sidebar
5. Click **Analyze PR**

---

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Watch mode — rebuilds on file change |
| `npm run build` | Production build to `dist/` |
| `npm test` | Unit tests |

---

## Adding a new adapter

1. Create `src/adapters/yourplatform.ts`
2. Implement the interface:

```typescript
import type { Adapter, RawDiff } from '../types'

export class YourPlatformAdapter implements Adapter {
  isMatch(url: string): boolean { ... }
  extractContext() { return { title: '', description: '' } }
  extractDiff(): RawDiff[] { return [] }
  async fetchFullFile(path: string) { return { content: null, source: null } }
}
```

3. Register in `src/content.ts`
4. Add URL patterns to `manifest.json` under `content_scripts.matches` and `host_permissions`

---

## Adding a new provider

1. Create `src/providers/yourprovider.ts`
2. Implement:

```typescript
import type { Provider } from '../types'

export class YourProvider implements Provider {
  async stream(systemPrompt: string, userMessage: string, onChunk: (text: string) => void): Promise<void> {
    ...
  }
}
```

3. Register in `src/core/analyzer.ts` inside `createProvider()`
4. Add the key field to the popup and `chrome.storage.sync`

---

## Folder structure

```
src/
  adapters/       Platform-specific DOM readers
  providers/      AI providers (Anthropic, Gemini, WebLLM)
  core/           Analyzer, parser, prompt builder, dependency map
  ui/             Sidebar and CSS
  types.ts        Shared interfaces (DiffFile, RawDiff, Provider, Adapter)
  content.ts      Chrome content script entry point
  background.ts   Service worker
popup/
  popup.html      API key setup + advanced settings
  popup.ts
dist/             Build output — load this in Chrome
tests/
  fixtures/       HTML snapshots of real PR pages for adapter tests
  unit/           Unit tests for parser, prompt builder, dependency map
```
