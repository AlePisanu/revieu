// RawDiff: data extracted by the adapter before parsing
export interface RawDiff {
  path: string
  additions: string[]
  deletions: string[]
  context: string[]  // unchanged lines surrounding each hunk (~3 per side)
  fullContent?: string
  rawLines: string[]
}

// DiffFile: enriched version of RawDiff, ready for prompt building
export interface DiffFile {
  path: string
  language: string
  additions: string[]
  deletions: string[]
  context: string[]
  fullContent: string | null
  fullLineCount: number | null
  totalLines: number  // additions + deletions, used to estimate diff size
  rawLines: string[]
}

export interface Provider {
  stream(
    systemPrompt: string,
    userMessage: string,
    onChunk: (text: string) => void
  ): Promise<void>
}

export interface Adapter {
  isMatch(url: string): boolean
  extractContext(): { title: string; description: string }
  extractDiff(): Promise<RawDiff[]>
  fetchFullFile(path: string): Promise<{
    content: string | null
    source: 'raw' | 'api' | 'expand' | null
  }>
}

export interface LLMResponse {
    message: string;
}

export type Phase = "loading" | "ready" | "error";

export interface Message {
    role: "user" | "assistant";
    content: string;
}