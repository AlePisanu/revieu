import type { DiffFile } from '../types'

// "&#58;" is the HTML entity for ":" prevents the AI from misinterpreting
// colons as markdown formatting in its own output
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

const TONE_MODIFIERS: Record<string, string> = {
  balanced: '',
  strict: 'Be extremely critical. Assume bugs exist.',
  security: 'Focus on security vulnerabilities, unsafe data handling, and access control.',
}

export const buildSystemPrompt = (tone: string): string => {
  const modifier = TONE_MODIFIERS[tone] ?? ''
  return modifier ? `${BASE_SYSTEM_PROMPT}\n${modifier}` : BASE_SYSTEM_PROMPT
}

export const buildUserMessage = (
  context: { title: string; description: string },
  files: DiffFile[],
  mode: string,
  depMap?: Record<string, string[]>
): string => {
  const parts: string[] = []

  parts.push(`
    Instructions:
    - Lines starting with "+" are additions
    - Lines starting with "-" are removals
    - Lines starting with " " (space) are unchanged context surrounding the changes
    - Use context lines to understand the surrounding code before flagging issues
    - Focus on added code unless removals introduce issues
  `)

  parts.push(`## PR: ${context.title}`)
  if (context.description) {
    parts.push(`**Description:** ${context.description}`)
  }

  if (depMap && Object.keys(depMap).length > 0) {
    parts.push('\n## Dependency map')
    for (const [file, deps] of Object.entries(depMap)) {
      for (const dep of deps) {
        parts.push(`- ${file} imports from ${dep}`)
      }
    }
  }

  parts.push('\n## Changes')

  for (const file of files) {
    parts.push(`\n### ${file.path} (${file.language})`)

    if (mode === 'full' && file.fullContent) {
      parts.push('**Full file:**')
      parts.push('```')
      parts.push(file.fullContent)
      parts.push('```')
    }

    parts.push('**Diff:**')
    for (const line of file.rawLines) {
      parts.push(line)
    }
  }

  return parts.join('\n')
}
