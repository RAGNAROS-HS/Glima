import type { Config } from "../config.js";
import type { LLMProvider } from "./interface.js";
import { AnthropicProvider } from "./anthropic.js";
import { OpenAIProvider } from "./openai.js";

export function createProvider(config: Config): LLMProvider {
  switch (config.LLM_PROVIDER) {
    case "anthropic": return new AnthropicProvider(config.LLM_API_KEY);
    case "openai":    return new OpenAIProvider(config.LLM_API_KEY);
    default: throw new Error(`Unknown LLM provider: ${config.LLM_PROVIDER}`);
  }
}
