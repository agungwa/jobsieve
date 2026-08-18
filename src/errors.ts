/**
 * Typed error hierarchy. Each error exposes a stable `code` (snake_case) used
 * in the JSON error envelope, and a `retryable` flag so the embedding worker
 * and ingest pipeline can decide whether to back off or give up.
 */
export abstract class AppError extends Error {
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  readonly status: number;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    opts: { status?: number; details?: Record<string, unknown>; cause?: unknown } = {},
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.name = this.constructor.name;
    this.status = opts.status ?? 500;
    this.details = opts.details;
  }
}

export class SourceUnavailableError extends AppError {
  readonly code = "source_unavailable";
  readonly retryable = true;
  constructor(
    message: string,
    opts: { source: string; cause?: unknown } = { source: "unknown" },
  ) {
    super(message, {
      status: 502,
      details: { source: opts.source },
      cause: opts.cause,
    });
  }
}

export class RateLimitError extends AppError {
  readonly code = "rate_limited";
  readonly retryable = true;
  readonly retryAfterMs: number;

  constructor(
    message: string,
    opts: { retryAfterMs?: number; cause?: unknown } = {},
  ) {
    super(message, {
      status: 429,
      details: { retryAfterMs: opts.retryAfterMs ?? 60_000 },
      cause: opts.cause,
    });
    this.retryAfterMs = opts.retryAfterMs ?? 60_000;
  }
}

export class EmbeddingFailedError extends AppError {
  readonly code = "embedding_failed";
  readonly retryable = true;
  constructor(
    message: string,
    opts: { cause?: unknown; batch?: number } = {},
  ) {
    super(message, {
      status: 502,
      details: opts.batch !== undefined ? { batch: opts.batch } : undefined,
      cause: opts.cause,
    });
  }
}

export class ParseError extends AppError {
  readonly code = "parse_error";
  readonly retryable = false;
  constructor(
    message: string,
    opts: { cause?: unknown; format?: string } = {},
  ) {
    super(message, {
      status: 422,
      details: opts.format !== undefined ? { format: opts.format } : undefined,
      cause: opts.cause,
    });
  }
}

export class ValidationError extends AppError {
  readonly code = "validation_error";
  readonly retryable = false;
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, { status: 400, details });
  }
}

export class NotFoundError extends AppError {
  readonly code = "not_found";
  readonly retryable = false;
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`, {
      status: 404,
      details: { resource, id },
    });
  }
}

export class ForbiddenError extends AppError {
  readonly code = "forbidden";
  readonly retryable = false;
  constructor(message = "Admin key required") {
    super(message, { status: 403 });
  }
}
