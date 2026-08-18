import type { Context } from "hono";
import { AppError } from "../errors";

/**
 * Uniform JSON error envelope per spec:
 *   { "error": "<snake_case_code>", "message": "...", "details"?: {} }
 */
export function errorEnvelope(err: unknown): {
  status: number;
  body: { error: string; message: string; details?: Record<string, unknown> };
} {
  if (err instanceof AppError) {
    return {
      status: err.status,
      body: {
        error: err.code,
        message: err.message,
        ...(err.details ? { details: err.details } : {}),
      },
    };
  }
  return {
    status: 500,
    body: { error: "internal_error", message: "Unexpected error" },
  };
}

export function errorHandler(err: unknown, c: Context) {
  const { status, body } = errorEnvelope(err);
  if (status >= 500) {
    console.error("[error]", err);
  }
  c.status(status as 400 | 401 | 403 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503);
  return c.json(body);
}
