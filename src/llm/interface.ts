export interface LLMMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  maxTokens?: number;
  responseFormat?: "json";
}

export interface LLMResponse {
  content: string;
  inputTokens: number;
  outputTokens: number;
  stopReason: "end_turn" | "max_tokens" | string;
}

export interface LLMProvider {
  readonly name: string;
  complete(request: LLMRequest): Promise<LLMResponse>;
}
