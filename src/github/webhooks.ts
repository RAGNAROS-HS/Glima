import type { Request, Response, NextFunction } from "express";
import { createHmac, timingSafeEqual } from "crypto";
import type { Config } from "../config.js";
import type { IssuePayload, PRPayload, PushPayload, InstallationPayload } from "./types.js";
import { logger } from "../util/logger.js";

export type WebhookHandlers = {
  onIssueScout: (payload: IssuePayload) => Promise<void>;
  onPROpenedOrSync: (payload: PRPayload) => Promise<void>;
  onInstallationCreated: (payload: InstallationPayload) => Promise<void>;
};

function verifySignature(secret: string, body: Buffer, signature: string): boolean {
  const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

export function createWebhookMiddleware(config: Config, handlers: WebhookHandlers) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const signature = req.headers["x-hub-signature-256"] as string | undefined;
    const event     = req.headers["x-github-event"] as string | undefined;
    const rawBody   = (req as Request & { rawBody?: Buffer }).rawBody;

    if (!rawBody) {
      res.status(400).json({ error: "Missing raw body" });
      return;
    }

    if (!signature || !verifySignature(config.GITHUB_WEBHOOK_SECRET, rawBody, signature)) {
      res.status(401).json({ error: "Invalid signature" });
      return;
    }

    const payload = req.body as Record<string, unknown>;

    try {
      if (event === "ping") {
        res.status(200).json({ ok: true });
        return;
      }

      if (event === "push") {
        const push = payload as unknown as PushPayload;
        if (push.sender?.login === config.BOT_GITHUB_LOGIN) {
          res.status(200).json({ ok: true, dropped: "bot-push" });
          return;
        }
      }

      if (event === "installation") {
        const inst = payload as unknown as InstallationPayload;
        if (inst.action === "created") {
          res.status(200).json({ ok: true });
          setImmediate(() => handlers.onInstallationCreated(inst).catch((e) =>
            logger.error("onInstallationCreated failed", { phase: "webhook" })));
          return;
        }
      }

      if (event === "issues") {
        const issue = payload as unknown as IssuePayload;
        const labelNames = issue.issue.labels.map((l) => l.name);
        const isScoutLabel =
          (issue.action === "opened" && labelNames.includes("glima:scout")) ||
          (issue.action === "labeled" && issue.label?.name === "glima:scout");

        if (isScoutLabel) {
          res.status(200).json({ ok: true });
          setImmediate(() => handlers.onIssueScout(issue).catch((e) =>
            logger.error("onIssueScout failed", { phase: "webhook", issueNumber: issue.issue.number })));
          return;
        }
      }

      if (event === "pull_request") {
        const pr = payload as unknown as PRPayload;
        if (pr.action === "opened" || pr.action === "synchronize") {
          res.status(200).json({ ok: true });
          setImmediate(() => handlers.onPROpenedOrSync(pr).catch((e) =>
            logger.error("onPROpenedOrSync failed", { phase: "webhook", prNumber: pr.pull_request.number })));
          return;
        }
      }

      res.status(200).json({ ok: true, event, action: payload["action"] });
    } catch (err) {
      next(err);
    }
  };
}
