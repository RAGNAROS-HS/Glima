import express from "express";
import cron from "node-cron";
import { loadConfig } from "./config.js";
import { createProvider } from "./llm/factory.js";
import { getInstallationOctokit } from "./github/app.js";
import { ensureLabels } from "./github/labels.js";
import { createWebhookMiddleware } from "./github/webhooks.js";
import { runScoutPipeline } from "./pipeline/scout.pipeline.js";
import { runFixPipeline } from "./pipeline/fix.pipeline.js";
import { runReviewPipeline } from "./pipeline/review.pipeline.js";
import { logger } from "./util/logger.js";
import type { IssuePayload, PRPayload, InstallationPayload } from "./github/types.js";

const config = loadConfig();
const llm    = createProvider(config);
const app    = express();

// Capture raw body for webhook signature verification
app.use((req, _res, next) => {
  const chunks: Buffer[] = [];
  req.on("data", (chunk: Buffer) => chunks.push(chunk));
  req.on("end", () => {
    (req as express.Request & { rawBody: Buffer }).rawBody = Buffer.concat(chunks);
    try {
      req.body = JSON.parse((req as express.Request & { rawBody: Buffer }).rawBody.toString("utf8"));
    } catch {
      req.body = {};
    }
    next();
  });
});

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.post(
  "/webhook",
  createWebhookMiddleware(config, {
    async onIssueScout(payload: IssuePayload) {
      await runFixPipeline(llm, config, payload);
    },
    async onPROpenedOrSync(payload: PRPayload) {
      await runReviewPipeline(llm, config, payload);
    },
    async onInstallationCreated(_payload: InstallationPayload) {
      const octokit = await getInstallationOctokit(config);
      await ensureLabels(octokit, config.GITHUB_REPO_OWNER, config.GITHUB_REPO_NAME);
      logger.info("Labels bootstrapped on new installation", { phase: "startup" });
    },
  }),
);

// Nightly Scout cron
cron.schedule(config.SCOUT_CRON, async () => {
  logger.info("Cron: Scout triggered", { phase: "cron" });
  await runScoutPipeline(llm, config).catch((e) =>
    logger.error("Scout pipeline failed", { phase: "cron" }),
  );
});

// Bootstrap labels on startup
getInstallationOctokit(config)
  .then((octokit) => ensureLabels(octokit, config.GITHUB_REPO_OWNER, config.GITHUB_REPO_NAME))
  .then(() => logger.info("Labels bootstrapped", { phase: "startup" }))
  .catch((e) => logger.warn("Label bootstrap failed (non-fatal)", { phase: "startup" }));

app.listen(config.PORT, () => {
  logger.info(`Glima listening on port ${config.PORT}`, { phase: "startup" });
});
