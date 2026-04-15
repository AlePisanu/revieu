import * as webllm from "@mlc-ai/web-llm";
import { LLMResponse } from "../types";
import { MODEL_ID } from "../constants/constants";

let engineInstance: webllm.MLCEngine | null = null;

export type LoadProgress = {
    text: string;
    progress: number;
};

export const getEngine = async (
    onProgress?: (p: LoadProgress) => void
): Promise<webllm.MLCEngine> => {
    if (engineInstance) return engineInstance;

    const engine = new webllm.MLCEngine();

    engine.setInitProgressCallback((report) => {
        onProgress?.({
            text: report.text,
            progress: report.progress,
        });
    });

    await engine.reload(MODEL_ID);

    engineInstance = engine;
    return engine;
}

export const chat = async (
  engine: webllm.MLCEngine,
  messages: { role: "user" | "assistant"; content: string }[]
): Promise<LLMResponse> => {
  const fullMessages: webllm.ChatCompletionMessageParam[] = [
    { role: "system", content: LLM_PROMPT },
    ...messages.map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    })),
  ];

  const reply = await engine.chat.completions.create({
    messages: fullMessages,
    temperature: 0.3,
    max_tokens: 1024,
  });

  const raw = reply.choices[0]?.message?.content || "{}";
  console.log("[LLM raw]", raw);
let result: LLMResponse;
  return result;
}