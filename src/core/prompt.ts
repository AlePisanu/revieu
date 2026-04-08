/**
 * prompt.ts — Builds the messages to send to the AI.
 *
 * Responsibilities:
 * 1. buildSystemPrompt: creates system instructions (who you are, how to respond, format)
 * 2. buildUserMessage: assembles the user message with diff, context, and full files
 *
 * This file is the second-to-last step in the pipeline:
 *   Adapter → parser → analyzer → **prompt** → [system + user message] → AI provider
 *
 * Pattern: TEMPLATE / BUILDER
 * The prompt is built by assembling blocks (PR title, context lines, diff, full files)
 * into a structured text format the AI knows how to interpret.
 * Each block is optional — the prompt adapts to what's available.
 */

import type { DiffFile } from '../types'

// ---------------------------------------------------------------------------
// SYSTEM PROMPT: instructions for the AI on how to behave
// ---------------------------------------------------------------------------

/**
 * Base prompt defining the AI's role and output format.
 * The sections Critical/Improvements/Minor enforce a structured, readable response.
 * "&#58;" is the HTML entity for ":" — prevents the AI from interpreting colons
 * as part of markdown formatting.
 */
const BASE_SYSTEM_PROMPT = `
You are a senior software engineer reviewing a pull request.

Your goal is to find real issues, not to be polite.

Focus on:
- correctness
- bugs and edge cases
- unintended side effects
- architecture/design issues

Pay attention to the fact that the diff has - for deletion and + for addition, check everytime that duplicates are correct and not false positives.

Rules:
- Be concise and direct
- No greetings or filler text
- Do NOT explain your reasoning
- Only report meaningful issues (avoid trivial style comments)

Output format (strict):

## Critical
- [file]&#58; issue + short explanation

## Improvements
- [file]&#58; suggestion

## Minor
- optional small notes

If no issues, say: "No significant issues found."

Keep reasoning minimal. Do not over-analyze.
`

/**
 * Tone modifiers — appended to the system prompt based on the user's choice.
 * - balanced: no modification (neutral tone)
 * - strict: the AI becomes more aggressive in finding issues
 * - security: the AI focuses on security vulnerabilities
 */
const TONE_MODIFIERS: Record<string, string> = {
  balanced: '',
  strict: 'Be extremely critical. Assume bugs exist.',
  security: 'Focus on security vulnerabilities, unsafe data handling, and access control.',
}

/** Combines the base prompt with the user's chosen tone modifier */
export const buildSystemPrompt = (tone: string): string => {
  const modifier = TONE_MODIFIERS[tone] ?? ''
  return modifier ? `${BASE_SYSTEM_PROMPT}\n${modifier}` : BASE_SYSTEM_PROMPT
}

// ---------------------------------------------------------------------------
// USER MESSAGE: PR content formatted for the AI
// ---------------------------------------------------------------------------

/**
 * Assembles the user message with all PR data.
 *
 * The message has this structure:
 * 1. Instructions — explains the notation (+/-/space) to the AI
 * 2. PR title and description — high-level context
 * 3. Dependency map (optional) — who imports from whom (for future feature)
 * 4. For each file:
 *    a. Full file (only in "full" mode if available)
 *    b. Context lines — unchanged code around modifications
 *    c. Modified lines — additions (+) and deletions (-)
 *
 * @param context - PR title and description (from adapter.extractContext)
 * @param files - enriched files from the parser
 * @param mode - "diff" (changes only) or "full" (full file + changes)
 * @param depMap - dependency map between files (optional, for future use)
 */
export const buildUserMessage = (
  context: { title: string; description: string },
  files: DiffFile[],
  mode: string,
  depMap?: Record<string, string[]>
): string => {
  const parts: string[] = []

  // Instructions for the AI on the notation used in the diff
  parts.push(`
    Instructions:
    - Lines starting with "+" are additions
    - Lines starting with "-" are removals
    - Lines starting with " " (space) are unchanged context surrounding the changes
    - Use context lines to understand the surrounding code before flagging issues
    - Focus on added code unless removals introduce issues
  `)

  // PR title and description — give the AI the "why" behind the changes
  parts.push(`## PR: ${context.title}`)
  if (context.description) {
    parts.push(`**Description:** ${context.description}`)
  }

  // Dependency map (e.g. "file A imports from file B")
  // Not yet populated — prepared for a future feature
  if (depMap && Object.keys(depMap).length > 0) {
    parts.push('\n## Dependency map')
    for (const [file, deps] of Object.entries(depMap)) {
      for (const dep of deps) {
        parts.push(`- ${file} imports from ${dep}`)
      }
    }
  }

  // Main section: modified files
  parts.push('\n## Changes')

  for (const file of files) {
    parts.push(`\n### ${file.path} (${file.language})`)

    // In "full" mode, if the full file is available, include it.
    // This gives the AI the context of the entire file (not just the hunks).
    if (mode === 'full' && file.fullContent) {
      parts.push('**Full file:**')
      parts.push('```')
      parts.push(file.fullContent)
      parts.push('```')
    }

    // Context lines: unchanged code around modifications (~3 lines per hunk).
    // Present even in "diff" mode — comes from the unified diff for free.
    parts.push('**Diff:**')
    for (const line of file.rawLines) {
      parts.push(line)
    }
  }

  return parts.join('\n')
}
