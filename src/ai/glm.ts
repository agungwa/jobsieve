import OpenAI from "openai";
import { config } from "../config";

/**
 * GLM client. Two wire protocols, same provider:
 *
 *   OpenAI-compatible  — {GLM_BASE_URL}/chat/completions (pay-as-you-go API
 *                        balance; base like https://api.z.ai/api/paas/v4)
 *   Anthropic-compatible — {GLM_BASE_URL}/v1/messages (Coding Plan quota;
 *                        base like https://api.z.ai/api/anthropic)
 *
 * The protocol is picked from the base URL, so switching plans is just a
 * GLM_BASE_URL / x-glm-base-url change — no other code path differs.
 */
export const glm = new OpenAI({
  apiKey: config.GLM_API_KEY || "not-configured",
  baseURL: config.GLM_BASE_URL,
});

export function isAnthropicBase(baseURL?: string): boolean {
  return (baseURL ?? config.GLM_BASE_URL).includes("/anthropic");
}

/** Admin gets the big model; anon users get the cheap model. */
export function pickModel(role: "admin" | "anon"): string {
  return role === "admin" ? config.GLM_MODEL_ADMIN : config.GLM_MODEL_USER;
}

export interface ChatResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
}

/**
 * Chat completion — the ONLY LLM call site in the app.
 *
 * `apiKey` (bring-your-own-key): when provided, an ephemeral client is used
 * for this single call. The key is never stored, cached, or logged — it
 * exists only for the lifetime of the request.
 */
export async function chatCompletion(opts: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<ChatResult> {
  if (!opts.apiKey && !config.GLM_API_KEY) {
    throw new AppNoSharedKeyError(
      "No shared AI key is configured on this server.",
    );
  }
  return isAnthropicBase(opts.baseURL)
    ? anthropicCompletion(opts)
    : openaiCompletion(opts);
}

// ── Anthropic protocol (Coding Plan) ────────────────────────────────────────

async function anthropicCompletion(opts: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<ChatResult> {
  const base = opts.baseURL ?? config.GLM_BASE_URL;
  const res = await fetch(`${base}/v1/messages`, {
    method: "POST",
    headers: {
      "x-api-key": opts.apiKey ?? config.GLM_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      max_tokens: 1024,
      system: opts.systemPrompt,
      messages: [{ role: "user", content: opts.userMessage }],
      temperature: opts.temperature ?? 0.3,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw mapUpstreamError(res.status, body);
  }

  const json = (await res.json()) as {
    content?: Array<{ type: string; text?: string }>;
    usage?: { input_tokens?: number; output_tokens?: number };
  };
  return {
    text: (json.content ?? [])
      .filter((b) => b.type === "text")
      .map((b) => b.text ?? "")
      .join(""),
    promptTokens: json.usage?.input_tokens ?? 0,
    completionTokens: json.usage?.output_tokens ?? 0,
  };
}

// ── OpenAI protocol (pay-as-you-go API) ─────────────────────────────────────

async function openaiCompletion(opts: {
  model: string;
  systemPrompt: string;
  userMessage: string;
  temperature?: number;
  apiKey?: string;
  baseURL?: string;
}): Promise<ChatResult> {
  const client = opts.apiKey
    ? new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL ?? config.GLM_BASE_URL })
    : glm;
  try {
    const res = await client.chat.completions.create({
      model: opts.model,
      messages: [
        { role: "system", content: opts.systemPrompt },
        { role: "user", content: opts.userMessage },
      ],
      temperature: opts.temperature ?? 0.3,
    });
    return {
      text: res.choices[0]?.message?.content ?? "",
      promptTokens: res.usage?.prompt_tokens ?? 0,
      completionTokens: res.usage?.completion_tokens ?? 0,
    };
  } catch (err) {
    const e = err as { status?: number; message?: string };
    throw mapUpstreamError(e.status ?? 0, e.message ?? "");
  }
}

/** Reachability check for /healthz — protocol-aware, no tokens spent. */
export async function glmPing(timeoutMs = 5000): Promise<void> {
  if (!config.GLM_API_KEY) return; // BYOK-only deployment — nothing to ping
  if (isAnthropicBase()) {
    const res = await fetch(`${config.GLM_BASE_URL}/v1/models`, {
      headers: {
        "x-api-key": config.GLM_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) throw new Error(`anthropic endpoint ${res.status}`);
    return;
  }
  await glm.models.list({ timeout: timeoutMs } as never);
}

// ── Shared upstream error mapping ───────────────────────────────────────────

/**
 * Maps provider failures to precise app errors so users get actionable
 * messages. 1113 = insufficient balance (Z.ai/bigmodel reports it as HTTP
 * 429 on the OpenAI protocol) — NOT the same as a real rate limit.
 */
function mapUpstreamError(status: number, message: string): Error {
  if (status === 429 && /1113|insufficient balance|余额/i.test(message)) {
    return new AppNoBalanceError("This API key has no remaining balance.");
  }
  if (status === 401 || status === 403) {
    return new AppInvalidKeyError("This API key was rejected by the provider.");
  }
  if (status === 429) {
    return new AppRateLimitError(`GLM chat rate limit: ${message}`);
  }
  if (status === 404 || /unknown model|model not found/i.test(message)) {
    return new AppBadModelError(`Model not available for this key: ${message}`);
  }
  return new Error(`GLM chat failed: ${message}`);
}

/** Marker classes so the /chat route can map upstream failures precisely. */
export class AppNoSharedKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppNoSharedKeyError";
  }
}
export class AppRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppRateLimitError";
  }
}
export class AppNoBalanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppNoBalanceError";
  }
}
export class AppInvalidKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppInvalidKeyError";
  }
}
export class AppBadModelError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AppBadModelError";
  }
}
