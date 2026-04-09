# Revieu — Roadmap

## v1 — GitHub + Claude + Gemini
**Goal:** A complete, working extension on GitHub, ready for the Chrome Web Store.

### v0.1 — Setup
- [ ] Folder structure and initial files
- [ ] `manifest.json` Manifest v3
- [ ] esbuild pipeline (watch + prod)
- [ ] Background service worker
- [ ] `.gitignore`, `package.json`

### v0.2 — GitHub Adapter
- [ ] Diff extraction from DOM (additions, deletions, file name)
- [ ] PR title and description extraction
- [ ] Language detection from file extension
- [ ] Handle GitHub lazy-loaded files
- [ ] Tests with real HTML fixtures

### v0.3 — Sidebar UI
- [ ] Sidebar injection into GitHub PR pages
- [ ] Tab toggle (open/close)
- [ ] Tone selector: Balanced / Strict / Security
- [ ] Provider selector: Claude / Gemini
- [ ] Mode toggle: Diff only / Full context
- [ ] Popup onboarding for API keys (Claude + Gemini)
- [ ] GitHub SPA navigation handling

### v0.4 — First provider (Anthropic)
- [ ] Anthropic provider with SSE streaming
- [ ] Prompt builder with system prompt and tone modifier
- [ ] Analyzer orchestrator
- [ ] Streamed review in sidebar
- [ ] Error handling: no key, 401, 429, network failure
- [ ] Copy review button
- [ ] Approximate token count indicator

### v0.5 — Full context mode
- [ ] Fetch full file via `raw.githubusercontent.com` (public repos)
- [ ] Fetch via DOM expand (private repos without token)
- [ ] Fetch via GitHub API (private repos with optional token)
- [ ] Automatic public/private repo detection
- [ ] Contextual banner for private repos without token
- [ ] GitHub token in advanced settings (collapsed by default)
- [ ] Updated prompt builder for full context

### v0.6 — Gemini provider
- [ ] Gemini Flash provider with streaming
- [ ] Working provider switch in sidebar
- [ ] Gemini key in popup

### v0.7 — Dependency map
- [ ] Static analysis of imports in changed files
- [ ] Intra-PR dependency graph
- [ ] Dependency map section in prompt
- [ ] Dependency parser tests

### v0.8 — Inline comments
- [ ] Prompt updated to request structured JSON output with file, line, and comment fields
- [ ] Line-numbered diff extraction in the GitHub adapter
- [ ] JSON response parser with line number validation
- [ ] DOM injection of comment rows directly into the diff table
- [ ] Toggle in sidebar: Summary mode / Inline mode

### v1.0 — Release
- [ ] Tested on 10+ real PRs (public + private)
- [ ] SVG icons (16, 48, 128px)
- [ ] Chrome Web Store screenshots
- [ ] Chrome Web Store description
- [ ] Tag `v1.0` on `main`

---

## v2 — GitLab
**Goal:** Same workflow on GitLab Merge Requests, zero changes to core logic.

- [ ] `GitLabAdapter` for `/merge_requests/*` pages
- [ ] Updated manifest with GitLab match patterns
- [ ] Tested on real GitLab.com MRs
- [ ] Updated README

---

## v3 — WebLLM (local inference)
**Goal:** Fully offline review, zero API key, zero data leaving the browser.

- [ ] `@mlc-ai/web-llm` integration
- [ ] Provider switcher: Claude API / Gemini / Local
- [ ] Model download with progress bar on first use
- [ ] Model cached in browser for subsequent sessions
- [ ] Default model: `Qwen2.5-Coder-7B-Instruct` (~5.5GB VRAM)
- [ ] Fallback: `Phi-3.5-mini-instruct` (~2.5GB VRAM) for limited hardware
- [ ] Clear warning about local model limitations vs cloud
- [ ] Requires WebGPU: clear message if not supported

---

## Ideas for later

- **Firefox support**: Manifest v3 is now supported, relatively clean port
- **Custom prompt**: user writes their own system prompt
- **Review history**: per-PR review history stored in `chrome.storage.local`
- **Team prompts**: share prompt sets with the team via sync
- **GitHub Actions integration**: trigger Revieu as a CI step, auto-comment on PRs
