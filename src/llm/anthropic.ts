import Anthropic from "@anthropic-ai/sdk";
import type { LLMProvider, LLMRequest, LLMResponse, LLMMessage } from "./interface.js";

export class AnthropicProvider implements LLMProvider {
  readonly name = "anthropic";
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const systemMessages = request.messages.filter((m) => m.role === "system");
    const nonSystemMessages = request.messages.filter((m) => m.role !== "system");

    const system = systemMessages.map((m) => m.content).join("\n\n");

    // For JSON mode, append a JSON enforcement instruction to the last user message
    let messages: LLMMessage[] = nonSystemMessages;
    if (request.responseFormat === "json") {
      messages = [...nonSystemMessages];
      const last = messages[messages.length - 1];
      if (last && last.role === "user") {
        messages[messages.length - 1] = {
          ...last,
          content: last.content + "\n\nRespond with a single valid JSON object and nothing else.",
        };
      }
    }

    const response = await this.client.messages.create({
      model: request.model,
      max_tokens: request.maxTokens ?? 4096,
      system: system || undefined,
      messages: messages.map((m) => ({ role: m.role as "user" | "assistant", content: m.content })),
    });

    const content =
      response.content[0]?.type === "text" ? response.content[0].text : "";

    return {
      content,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      stopReason: response.stop_reason ?? "end_turn",
    };
  }
}
