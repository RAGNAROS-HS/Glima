import { describe, it, expect, vi, beforeEach } from "vitest";

// ── AnthropicProvider ──────────────────────────────────────────────────────────

vi.mock("@anthropic-ai/sdk", () => {
  const create = vi.fn().mockResolvedValue({
    content: [{ type: "text", text: '{"ok":true}' }],
    usage: { input_tokens: 10, output_tokens: 5 },
    stop_reason: "end_turn",
  });
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: { create },
    })),
    __create: create,
  };
});

vi.mock("openai", () => {
  const create = vi.fn().mockResolvedValue({
    choices: [{ message: { content: '{"ok":true}' }, finish_reason: "stop" }],
    usage: { prompt_tokens: 10, completion_tokens: 5 },
  });
  return {
    default: vi.fn().mockImplementation(() => ({
      chat: { completions: { create } },
    })),
    __create: create,
  };
});

describe("AnthropicProvider", () => {
  it("maps LLMRequest to Anthropic SDK call and returns LLMResponse", async () => {
    const { AnthropicProvider } = await import("../llm/anthropic.js");
    const provider = new AnthropicProvider("sk-ant-test");
    const response = await provider.complete({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "You are a bot." },
        { role: "user",   content: "Hello" },
      ],
    });
    expect(response.content).toBe('{"ok":true}');
    expect(response.inputTokens).toBe(10);
    expect(response.stopReason).toBe("end_turn");
    expect(provider.name).toBe("anthropic");
  });

  it("appends JSON enforcement to last user message in JSON mode", async () => {
    const sdkMod = await import("@anthropic-ai/sdk");
    const AnthropicSdk = sdkMod.default as ReturnType<typeof vi.fn>;
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    });
    AnthropicSdk.mockImplementationOnce(() => ({ messages: { create: createFn } }));

    const { AnthropicProvider } = await import("../llm/anthropic.js");
    const provider = new AnthropicProvider("key");
    await provider.complete({
      model: "claude-sonnet-4-6",
      messages: [{ role: "user", content: "Give me JSON" }],
      responseFormat: "json",
    });

    const callArgs = createFn.mock.calls[0][0];
    const lastMsg = callArgs.messages[callArgs.messages.length - 1];
    expect(lastMsg.content).toContain("single valid JSON object");
  });

  it("extracts system messages separately", async () => {
    const sdkMod = await import("@anthropic-ai/sdk");
    const AnthropicSdk = sdkMod.default as ReturnType<typeof vi.fn>;
    const createFn = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "{}" }],
      usage: { input_tokens: 1, output_tokens: 1 },
      stop_reason: "end_turn",
    });
    AnthropicSdk.mockImplementationOnce(() => ({ messages: { create: createFn } }));

    const { AnthropicProvider } = await import("../llm/anthropic.js");
    const provider = new AnthropicProvider("key");
    await provider.complete({
      model: "claude-sonnet-4-6",
      messages: [
        { role: "system", content: "You are a bot" },
        { role: "user",   content: "Hi" },
      ],
    });

    const callArgs = createFn.mock.calls[0][0];
    expect(callArgs.system).toBe("You are a bot");
    expect(callArgs.messages.every((m: { role: string }) => m.role !== "system")).toBe(true);
  });
});

describe("OpenAIProvider", () => {
  it("maps LLMRequest to OpenAI SDK call", async () => {
    const { OpenAIProvider } = await import("../llm/openai.js");
    const provider = new OpenAIProvider("sk-test");
    const response = await provider.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "Hello" }],
    });
    expect(response.content).toBe('{"ok":true}');
    expect(provider.name).toBe("openai");
  });

  it("sets json_object response_format in JSON mode", async () => {
    const openaiMod = await import("openai");
    const OpenAISdk = openaiMod.default as ReturnType<typeof vi.fn>;
    const createFn = vi.fn().mockResolvedValue({
      choices: [{ message: { content: "{}" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    OpenAISdk.mockImplementationOnce(() => ({ chat: { completions: { create: createFn } } }));

    const { OpenAIProvider } = await import("../llm/openai.js");
    const provider = new OpenAIProvider("key");
    await provider.complete({
      model: "gpt-4o",
      messages: [{ role: "user", content: "JSON please" }],
      responseFormat: "json",
    });

    const callArgs = createFn.mock.calls[0][0];
    expect(callArgs.response_format).toEqual({ type: "json_object" });
  });
});

describe("createProvider factory", () => {
  it("returns AnthropicProvider for anthropic", async () => {
    const { createProvider } = await import("../llm/factory.js");
    const { AnthropicProvider } = await import("../llm/anthropic.js");
    const config = { LLM_PROVIDER: "anthropic", LLM_API_KEY: "k" } as Parameters<typeof createProvider>[0];
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(AnthropicProvider);
  });

  it("returns OpenAIProvider for openai", async () => {
    const { createProvider } = await import("../llm/factory.js");
    const { OpenAIProvider } = await import("../llm/openai.js");
    const config = { LLM_PROVIDER: "openai", LLM_API_KEY: "k" } as Parameters<typeof createProvider>[0];
    const provider = createProvider(config);
    expect(provider).toBeInstanceOf(OpenAIProvider);
  });

  it("throws for unknown provider", async () => {
    const { createProvider } = await import("../llm/factory.js");
    const config = { LLM_PROVIDER: "unknown" as "anthropic", LLM_API_KEY: "k" } as Parameters<typeof createProvider>[0];
    expect(() => createProvider(config)).toThrow("Unknown LLM provider");
  });
});
