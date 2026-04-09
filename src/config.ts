import { z } from "zod";
import { readFileSync } from "fs";

const EnvSchema = z.object({
  // GitHub App
  GITHUB_APP_ID:           z.string().regex(/^\d+$/).transform(Number),
  GITHUB_PRIVATE_KEY:      z.string().min(1),
  GITHUB_WEBHOOK_SECRET:   z.string().min(1),
  GITHUB_INSTALLATION_ID:  z.string().regex(/^\d+$/).transform(Number),
  GITHUB_REPO_OWNER:       z.string().min(1),
  GITHUB_REPO_NAME:        z.string().min(1),
  BOT_GITHUB_LOGIN:        z.string().min(1),

  // LLM
  LLM_PROVIDER:            z.enum(["anthropic", "openai"]),
  LLM_API_KEY:             z.string().min(1),
  LLM_MODEL_SCOUT:         z.string().min(1),
  LLM_MODEL_FIXER:         z.string().min(1),
  LLM_MODEL_REVIEWER:      z.string().min(1),
  LLM_MODEL_DOCUMENTER:    z.string().min(1),

  // Behaviour
  SCOUT_CRON:              z.string().default("0 2 * * *"),
  MAX_FIX_ITERATIONS:      z.string().regex(/^\d+$/).transform(Number).default("3"),
  QODO_BOT_USERNAME:       z.string().default("qodo-merge[bot]"),
  LLM_TOKEN_BUDGET_SCOUT:  z.string().regex(/^\d+$/).transform(Number).default("80000"),
  PORT:                    z.string().regex(/^\d+$/).transform(Number).default("3000"),
});

export type Config = z.infer<typeof EnvSchema> & { GITHUB_PRIVATE_KEY_PEM: string };

function resolvePem(raw: string): string {
  if (raw.startsWith("-----BEGIN")) {
    return raw;
  }
  // Treat as base64
  const decoded = Buffer.from(raw, "base64").toString("utf8");
  if (decoded.startsWith("-----BEGIN")) {
    return decoded;
  }
  // Treat as file path
  return readFileSync(raw, "utf8");
}

export function loadConfig(): Config {
  const result = EnvSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    process.stderr.write(`Config validation failed:\n${issues}\n`);
    process.exit(1);
  }
  const data = result.data;
  return {
    ...data,
    GITHUB_PRIVATE_KEY_PEM: resolvePem(data.GITHUB_PRIVATE_KEY),
  };
}
