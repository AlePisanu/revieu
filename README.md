<p align="center">
  <img src="icons/logo-128.png" alt="Revieu" width="80" />
</p>

# Revieu

> AI-powered code review sidebar for GitHub which runs in your browser, analyzes PR diffs with Claude or Gemini, streams suggestions in real time.

![Version](https://img.shields.io/badge/version-0.1.0-blue)
![Manifest](https://img.shields.io/badge/manifest-v3-green)
![License](https://img.shields.io/badge/license-MIT-gray)

---

## What it does

Revieu adds a sidebar to any GitHub Pull Request page. With one click it reads the diff, sends it to an AI model, and streams a code review directly in your browser.

No backend. No account. No context switching. The review appears inline while you're on the PR.

Unlike copy-paste tools, Revieu brings the review directly into your GitHub workflow, no tab switching, no manual prompting, streaming results inline.

---

## Features

- Streams AI code review in real time
- Reads PR title and description for better context
- **Diff only** mode: fast, minimal token usage
- **Full context** mode: sends the full file for deeper analysis
  - Public repos: fetches via `raw.githubusercontent.com` (no auth needed)
  - Private repos: expands DOM context automatically, or uses an optional GitHub token
- **Dependency map**: analyzes imports between changed files, adds relationship context to the prompt
- Tone selector: `Balanced` / `Strict` / `Security-focused`
- Provider selector: `Claude` (Anthropic) or `Gemini Flash` (free tier, no billing required)
- Handles large diffs: lets you select which files to analyze
- Copy review with one click
- Works with GitHub's SPA navigation

---

## How it works

1. Navigate to any GitHub PR (`github.com/user/repo/pull/123`)
2. Click the Revieu icon in the Chrome toolbar to open the sidebar
3. Choose your mode (Diff only / Full context) and tone
4. Click **Analyze PR**
5. The review streams back in the sidebar

---

## Installation (dev)

```bash
git clone https://github.com/yourusername/revieu
cd revieu
npm install
npm run build
```

Load the `dist/` folder as an unpacked extension in `chrome://extensions`.

Full setup instructions: [docs/SETUP.md](./docs/SETUP.md)

---

## API keys

Revieu needs at least one AI provider key. Both have free options:

| Provider | Free tier | Get key |
|----------|-----------|---------|
| Anthropic Claude | Credits on signup | [console.anthropic.com](https://console.anthropic.com/settings/keys) |
| Google Gemini Flash | Genuinely free, no billing required | [aistudio.google.com](https://aistudio.google.com/app/apikey) |

Keys are stored in `chrome.storage.sync` encrypted by Chrome, never sent to any server of ours. Requests go directly from your browser to the provider's API.

---

## Roadmap

| Version | What ships |
|---------|-----------|
| **v0.1** | Project setup, manifest, build pipeline |
| **v0.2** | GitHub adapter: diff extraction from DOM |
| **v0.3** | Sidebar UI (no AI yet) |
| **v0.4** | Anthropic provider, first working review |
| **v0.5** | Full context mode |
| **v0.6** | Gemini provider |
| **v0.7** | Dependency map |
| **v1.0** | Chrome Web Store release |

Full roadmap: [docs/ROADMAP.md](./docs/ROADMAP.md)

---

## Tech stack

- Chrome Extension Manifest v3
- TypeScript: no framework
- esbuild for bundling
- Anthropic Claude API (streaming)
- Google Gemini API (streaming, free tier)
- WebLLM (v3 roadmap: local inference, no API key)

---

## Privacy

- API keys stored locally in `chrome.storage.sync`, never on our servers
- In Diff only mode: only the changed lines leave your browser
- In Full context mode (public repos): file content is fetched directly from `raw.githubusercontent.com`
- No analytics, no telemetry, no data stored anywhere

---

## License

MIT
