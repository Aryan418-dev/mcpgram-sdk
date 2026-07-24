/**
 * Thrown for any non-2xx response from the MCPGRAM API, except the 502
 * "tool executed but the tool itself failed" case — that comes back as a
 * normal ExecuteResult with status: "error" instead of throwing, since
 * it's an expected outcome an agent should be able to branch on, not an
 * exceptional one.
 */
export class PlatformApiError extends Error {
  status: number;
  body: unknown;
  retryAfterMs?: number;

  constructor(message: string, status: number, body: unknown, retryAfterMs?: number) {
    super(message);
    this.name = "PlatformApiError";
    this.status = status;
    this.body = body;
    this.retryAfterMs = retryAfterMs;
  }
}
