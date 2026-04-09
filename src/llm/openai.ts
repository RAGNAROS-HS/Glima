import OpenAI from "openai";
import type { LLMProvider, LLMRequest, LLMResponse } from "./interface.js";

export class OpenAIProvider implements LLMProvider {
  readonly name = "openai";
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const response = await this.client.chat.completions.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      ...(request.responseFormat === "json"
        ? { response_format: { type: "json_object" as const } }
        : {}),
    });

    const choice = response.choices[0];
    const content = choice?.message?.content ?? "";
    const stopReason = choice?.finish_reason ?? "end_turn";

    return {
      content,
      inputTokens: response.usage?.prompt_tokens ?? 0,
      outputTokens: response.usage?.completion_tokens ?? 0,
      stopReason,
    };
  }
}
