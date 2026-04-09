import { App } from "@octokit/app";
import type { Octokit } from "@octokit/rest";
import type { Config } from "../config.js";

let _app: App | null = null;

export function getApp(config: Config): App {
  if (!_app) {
    _app = new App({
      appId: config.GITHUB_APP_ID,
      privateKey: config.GITHUB_PRIVATE_KEY_PEM,
      webhooks: { secret: config.GITHUB_WEBHOOK_SECRET },
    });
  }
  return _app;
}

export async function getInstallationOctokit(config: Config): Promise<Octokit> {
  const app = getApp(config);
  // @octokit/app returns an Octokit-compatible instance
  return app.getInstallationOctokit(config.GITHUB_INSTALLATION_ID) as unknown as Octokit;
}

export async function getInstallationToken(config: Config): Promise<string> {
  const app = getApp(config);
  const { data } = await (
    await app.getInstallationOctokit(config.GITHUB_INSTALLATION_ID)
  ).request("POST /app/installations/{installation_id}/access_tokens", {
    installation_id: config.GITHUB_INSTALLATION_ID,
  });
  return (data as { token: string }).token;
}
