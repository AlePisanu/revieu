# Changelog

All notable changes to this project are documented here.
Format based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [0.1.0] 2026-04-09

### Added
- Initial folder structure and `manifest.json` Manifest V3
- esbuild build pipeline (watch + prod)
- Background service worker for storage, messaging, and CORS-safe fetches
- GitHub adapter unified diff extraction with DOM fallback
- Sidebar UI with provider, model, mode (diff/full), and tone selectors
- Anthropic provider (Claude) with SSE streaming
- Gemini provider with SSE streaming, client-side rate limiting, and retry logic
- Full context mode downloads complete files via raw.githubusercontent.com with GitHub API fallback
- Dynamic model listing for both providers
- File selector when diff exceeds size limit
- Lottie animations for empty state and loading
- Popup for API key and GitHub token configuration
- SPA navigation support (turbo:render, popstate, polling)
- XSS protection via DOMPurify on AI output
