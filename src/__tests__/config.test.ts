import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { writeFileSync, unlinkSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

// We test loadConfig by manipulating process.env before each test
// Import is dynamic to reload the module fresh per test
async function loadConfigFresh() {
  // Bust module cache by appending a query param trick won't work in ESM;
  // instead we import the function and call it — it reads process.env at call time
  const { loadConfig } = await import("../config.js");
  return loadConfig;
}

const BASE_ENV = {
  GITHUB_APP_ID:          "12345",
  GITHUB_PRIVATE_KEY:     Buffer.from("-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n").toString("base64"),
  GITHUB_WEBHOOK_SECRET:  "secret",
  GITHUB_INSTALLATION_ID: "67890",
  GITHUB_REPO_OWNER:      "myorg",
  GITHUB_REPO_NAME:       "myrepo",
  BOT_GITHUB_LOGIN:       "glima[bot]",
  LLM_PROVIDER:           "anthropic",
  LLM_API_KEY:            "sk-ant-test",
  LLM_MODEL_SCOUT:        "claude-sonnet-4-6",
  LLM_MODEL_FIXER:        "claude-sonnet-4-6",
  LLM_MODEL_REVIEWER:     "claude-opus-4-6",
  LLM_MODEL_DOCUMENTER:   "claude-sonnet-4-6",
};

describe("loadConfig", () => {
  let savedEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    savedEnv = { ...process.env };
    // Clear relevant keys
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    // Restore
    for (const key of Object.keys(BASE_ENV)) {
      delete process.env[key];
    }
    Object.assign(process.env, savedEnv);
  });

  it("accepts a valid env with base64 PEM", async () => {
    Object.assign(process.env, BASE_ENV);
    const loadConfig = await loadConfigFresh();
    const config = loadConfig();
    expect(config.GITHUB_APP_ID).toBe(12345);
    expect(config.GITHUB_PRIVATE_KEY_PEM).toContain("-----BEGIN RSA PRIVATE KEY-----");
    expect(config.LLM_PROVIDER).toBe("anthropic");
  });

  it("accepts a raw PEM string directly", async () => {
    Object.assign(process.env, {
      ...BASE_ENV,
      GITHUB_PRIVATE_KEY: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----\n",
    });
    const loadConfig = await loadConfigFresh();
    const config = loadConfig();
    expect(config.GITHUB_PRIVATE_KEY_PEM).toContain("-----BEGIN RSA PRIVATE KEY-----");
  });

  it("accepts a file path PEM", async () => {
    const pemPath = join(tmpdir(), "test-glima.pem");
    const pemContent = "-----BEGIN RSA PRIVATE KEY-----\nfromfile\n-----END RSA PRIVATE KEY-----\n";
    writeFileSync(pemPath, pemContent);
    try {
      Object.assign(process.env, { ...BASE_ENV, GITHUB_PRIVATE_KEY: pemPath });
      const loadConfig = await loadConfigFresh();
      const config = loadConfig();
      expect(config.GITHUB_PRIVATE_KEY_PEM).toContain("fromfile");
    } finally {
      unlinkSync(pemPath);
    }
  });

  it("exits on missing required var", async () => {
    Object.assign(process.env, BASE_ENV);
    delete process.env["GITHUB_APP_ID"];
    const mockExit = vi.spyOn(process, "exit").mockImplementation((_code) => { throw new Error("process.exit called"); });
    const loadConfig = await loadConfigFresh();
    expect(() => loadConfig()).toThrow("process.exit called");
    mockExit.mockRestore();
  });

  it("applies defaults for optional vars", async () => {
    Object.assign(process.env, BASE_ENV);
    const loadConfig = await loadConfigFresh();
    const config = loadConfig();
    expect(config.SCOUT_CRON).toBe("0 2 * * *");
    expect(config.MAX_FIX_ITERATIONS).toBe(3);
    expect(config.LLM_TOKEN_BUDGET_SCOUT).toBe(80000);
    expect(config.PORT).toBe(3000);
  });
});
