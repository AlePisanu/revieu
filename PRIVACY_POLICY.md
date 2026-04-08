# Privacy Policy — Revieu

**Last updated:** April 9, 2026

Revieu ("the Extension") is a Chrome extension that provides AI-powered code review for GitHub Pull Requests. This Privacy Policy explains what data is collected, how it is used, and your rights.

## 1. Data Controller

Revieu is developed and maintained by an independent developer. For any privacy-related inquiries, contact: **[YOUR_EMAIL]**

## 2. Data We Collect

Revieu does **not** collect, store, or transmit any personal data to its own servers. The Extension has **no backend server, no analytics, and no tracking**.

The only data processed by the Extension is:

| Data | Where it is stored | Purpose |
|---|---|---|
| API keys (Anthropic, Google Gemini) | Locally in your browser via `chrome.storage.sync` | Authenticate requests to the AI provider you chose |
| GitHub personal access token (optional) | Locally in your browser via `chrome.storage.sync` | Access private repositories in "Full context" mode |
| Extension preferences (tone, mode, provider) | Locally in your browser via `chrome.storage.sync` | Remember your settings across sessions |

## 3. How Your Data Is Used

When you click "Analyze PR", the Extension:

1. **Reads the Pull Request diff** directly from the GitHub page you are viewing.
2. **Sends the diff** directly from your browser to the AI provider you selected:
   - **Anthropic API** (`api.anthropic.com`) if you use Claude, or
   - **Google Gemini API** (`generativelanguage.googleapis.com`) if you use Gemini.
3. **Displays the AI response** in the sidebar.

There is **no intermediary server**. The data flows directly from your browser to the AI provider's API using your own API key.

## 4. Data We Do NOT Collect

- We do **not** collect usage analytics or telemetry.
- We do **not** track browsing activity.
- We do **not** sell, share, or transfer any data to third parties.
- We do **not** use cookies.
- We do **not** store any code, diffs, or AI responses on any server.

## 5. Third-Party Services

The Extension communicates directly with the following third-party APIs **only when you initiate an analysis**:

- **Anthropic API** — governed by [Anthropic's Privacy Policy](https://www.anthropic.com/privacy) and [Terms of Service](https://www.anthropic.com/terms).
- **Google Gemini API** — governed by [Google's API Terms of Service](https://developers.google.com/terms) and [Privacy Policy](https://policies.google.com/privacy).
- **GitHub** — the Extension reads Pull Request data from `github.com` pages you are actively viewing, using your existing browser session.

You are responsible for reviewing and accepting the terms of the AI provider you choose to use. Each provider's data retention and usage policies apply to the data you send through their API.

## 6. Data Retention

All data (API keys, settings) is stored locally in your browser via Chrome's built-in storage. No data is retained on any external server controlled by Revieu.

To delete all stored data, simply uninstall the Extension. You can also clear individual settings from the Extension popup.

## 7. Security

- API keys are stored in Chrome's encrypted extension storage, not in the page source code or accessible to websites.
- All communications with AI providers use HTTPS encryption.
- The Extension requests only the minimum permissions necessary to function.

## 8. Your Rights Under GDPR (European Economic Area)

If you are located in the EEA, you have the following rights:

- **Right of access** — You can view all stored data directly in Chrome's extension storage.
- **Right to erasure** — Uninstall the Extension to delete all locally stored data.
- **Right to restriction of processing** — You can stop using the Extension at any time.
- **Right to data portability** — Your data is stored locally and under your control.

Since Revieu does not collect or store personal data on any server, most GDPR data subject requests are satisfied by default. For any questions, contact **[YOUR_EMAIL]**.

## 9. Your Rights Under CCPA (California)

If you are a California resident, you have the right to:

- **Know** what personal information is collected — see Section 2 above.
- **Delete** your personal information — uninstall the Extension.
- **Opt-out of sale** — Revieu does **not** sell any personal information.
- **Non-discrimination** — You will not be discriminated against for exercising your rights.

## 10. Children's Privacy

Revieu is not directed at children under the age of 13. We do not knowingly collect any data from children.

## 11. Changes to This Policy

We may update this Privacy Policy from time to time. Changes will be reflected in the "Last updated" date at the top. Continued use of the Extension after changes constitutes acceptance of the updated policy.

## 12. Contact

For any questions or concerns about this Privacy Policy, contact: **[YOUR_EMAIL]**
