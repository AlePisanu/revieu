# Revieu — User Stories & Flows

## Personas

**Marco** — Senior frontend engineer at a scale-up. Reviews 3-5 PRs a day. Wants quick feedback before reading line by line.

**Sara** — Junior developer. Wants to understand what to improve in her code before asking the team for a review.

**Luca** — Tech Lead. Reviews PRs on a private, sensitive codebase. Does not want to send code to external services.

**Elena** — Open source maintainer. Works on public repos, wants zero friction and ideally zero cost.

---

## User Stories

### Onboarding

**US-01** — As a new user, I want to enter my API key on first launch so I can start using Revieu without reading documentation.

**US-02** — As a user, I want my API key stored securely so I don't have to re-enter it every time.

**US-03** — As a user without a credit card, I want to use Revieu for free via Gemini Flash so I can evaluate the tool before paying.

---

### Core flow

**US-04** — As a user, I want to see the sidebar when I open a PR on GitHub so I know Revieu is available.

**US-05** — As a user, I want to click a single button to start the review so the flow is as simple as possible.

**US-06** — As a user, I want to see the review streaming as it is generated so I'm not waiting in silence.

**US-07** — As a user, I want to choose the review tone so the feedback is calibrated to my context (quick vs thorough vs security-focused).

**US-08** — As a user, I want to copy the review with one click so I can paste it into a comment or Notion.

---

### Analysis modes

**US-09** — As a user (Marco) on a quick PR, I want to use Diff only so I get fast feedback with minimal token usage.

**US-10** — As a user (Sara) on a PR with complex logic, I want to use Full context so the model understands what surrounds my changes and doesn't make things up based on the diff alone.

**US-11** — As a user on a public repo in Full context mode, I want Revieu to fetch the file without asking for a GitHub token so I don't have to configure anything extra.

**US-12** — As a user on a private repo in Full context mode without a token, I want a clear warning that context is partial so I understand why the review might be less precise.

**US-13** — As a user (Luca) on a private repo, I want to add a GitHub token in advanced settings so I can get the full file without making the repo public.

---

### Dependency map

**US-14** — As a user with a PR that touches interconnected files, I want Revieu to include the relationships between files in the prompt so the model understands that `useAuth` depends on `api/auth` and can make cross-file observations.

---

### Large diffs

**US-15** — As a user with a large PR, I want to be warned when the diff exceeds the analysis limit so I understand why not everything is being analyzed.

**US-16** — As a user with a large PR, I want to select specific files to analyze so I can focus the review on the most important changes.

---

### Provider

**US-17** — As a user (Elena) on public repos, I want to use Gemini Flash for free so I can do reviews at no cost.

**US-18** — As a user (Luca), I want to eventually use a local model via WebLLM so no code data ever leaves my browser.

---

## Main flows

### Flow 1 — First launch

```
Install extension
      │
      ▼
Click Revieu icon in toolbar
      │
      ▼
Popup: Anthropic section + Gemini section (free tier)
      │
      ▼
Enter at least one key → Save
      │
      ▼
"✓ Saved" — ready to use
```

---

### Flow 2 — Standard review (Diff only)

```
Open github.com/user/repo/pull/123
      │
      ▼
Revieu sidebar visible on the right (tab toggle)
      │
      ▼
Mode: [Diff only]  ← default
Tone: [Balanced]
Provider: [Claude]
      │
      ▼
Click "Analyze PR"
      │
      ▼
Revieu reads: PR title + description + diff from DOM
      │
      ▼
Streaming — review appears word by word
      │
      ▼
Review complete → [Copy review]  ~230 tokens
```

---

### Flow 3 — Full context on a public repo

```
Mode: [Full context]
      │
      ▼
Click "Analyze PR"
      │
      ▼
For each file in the diff:
  fetch raw.githubusercontent.com/{owner}/{repo}/{branch}/{path}
  → full file, no auth required
      │
      ▼
Prompt includes: full file content + highlighted modified lines
      │
      ▼
Review with real context, no guessing
```

---

### Flow 4 — Full context on a private repo without a token

```
Mode: [Full context], private repo
      │
      ▼
Click "Analyze PR"
      │
      ▼
Yellow banner appears:
"🔒 Private repo — partial context (DOM expand).
 For the full file, add a GitHub token in settings."
      │
      ▼
Revieu automatically expands diff gaps
Waits for additional lines to load
Reads all available context
      │
      ▼
Review with partial but significantly richer context
than the raw diff
```

---

### Flow 5 — Large diff

```
PR with 600 lines of diff
      │
      ▼
Click "Analyze PR"
      │
      ▼
Sidebar shows file selector:
"⚠ Diff too large (600 lines). Select files to analyze:"

[ ] src/api/auth.ts            45 lines
[ ] src/hooks/useAuth.ts       89 lines
[ ] src/components/Form.tsx   120 lines
...
      │
      ▼
User selects 2 files → "Analyze selected"
      │
      ▼
Normal review on selected files
```

---

## Edge cases

| Scenario | Expected behavior |
|----------|-------------------|
| No key configured | Banner in sidebar with link to popup |
| Invalid API key (401) | Error message with link to settings |
| Rate limit (429) | Message suggesting to wait |
| No network connection | Generic network error message |
| PR with no diff (e.g. comments only) | "No code changes found in this PR" |
| GitHub changes DOM selectors | Adapter fails with a clear error, not silently |
| WebGPU not supported (v3) | "Your browser does not support WebGPU. Use Claude API or Gemini." |
| GitHub SPA navigation | Content script reinitializes on the new PR |
| File not loaded (lazy load) | Warning to manually expand files before analyzing |
