import { logger } from "./logger.js";

export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts: number = 3,
  baseDelayMs: number = 500,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      const jitter = Math.random() * baseDelayMs * 0.5;
      const delay = baseDelayMs * Math.pow(2, attempt - 1) + jitter;
      logger.warn(`Retry attempt ${attempt}/${maxAttempts} failed, retrying in ${Math.round(delay)}ms`, {
        phase: "retry",
      });
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}
