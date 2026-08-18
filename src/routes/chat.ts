import { createHash } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { chatCache, chatUsage, cvProfiles, jobs } from "../db/schema";
import { NotFoundError, ValidationError } from "../errors";
import type { RoleContext } from "../middleware/admin";
import { chatRateLimit } from "../middleware/rate-limit";
import {
  AppBadModelError,
  AppInvalidKeyError,
  AppNoBalanceError,
  AppNoSharedKeyError,
  AppRateLimitError,
  chatCompletion,
  pickModel,
} from "../ai/glm";

const SYSTEM_PROMPT = `You are a concise career assistant for a job aggregator.
You answer questions about job listings and the user's CV profile.
Keep answers under 200 words. Use only the context provided; if something
is not in the context, say so. No markdown headers.`;

/** Z.ai API keys look like "<32 hex>.<22 chars>". Loosely validated. */
const BYOK_KEY_RE = /^[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}$/;
/** Only GLM model ids are accepted (prevents arbitrary-endpoint abuse). */
const MODEL_RE = /^glm-[0-9]+(\.[0-9]+)?(-air|-turbo|-flash)?$/;
/** Allowlisted GLM endpoints. The /anthropic ones are Coding-Plan endpoints
 *  (subscription quota); /paas/v4 are pay-as-you-go API endpoints. */
const BASE_URLS = [
  "https://api.z.ai/api/anthropic",
  "https://open.bigmodel.cn/api/anthropic",
  "https://api.z.ai/api/paas/v4",
  "https://open.bigmodel.cn/api/paas/v4",
] as const;

export const chatRouter = new Hono<RoleContext>()

  /**
   * POST /chat — the ONLY LLM call site.
   * Body: { cv_id?, job_id?, message }
   * Headers (bring-your-own-key): x-glm-key, x-glm-model (optional).
   *   A user-supplied key is used for that single request only — it is
   *   never stored or logged, and bypasses the daily rate limit since the
   *   caller pays their own provider costs.
   * Admin → glm-4.6 unlimited; anon → glm-4.5-air, RATE_LIMIT_PER_DAY/day.
   * Identical prompts hit chat_cache (zero tokens).
   */
  .post("/chat", chatRateLimit, async (c) => {
    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new ValidationError("invalid JSON body");
    }
    const message =
      typeof body.message === "string" ? body.message.trim() : "";
    const cvId = typeof body.cv_id === "string" ? body.cv_id : null;
    const jobId = typeof body.job_id === "string" ? body.job_id : null;

    if (!message || message.length > 2000) {
      throw new ValidationError("message is required (max 2000 chars)", {
        field: "message",
      });
    }

    // ── Bring-your-own-key (validated, request-scoped, never persisted) ─────
    const byokKeyRaw = c.req.header("x-glm-key")?.trim() || null;
    const byokModelRaw = c.req.header("x-glm-model")?.trim() || null;
    const byokBaseRaw = c.req.header("x-glm-base-url")?.trim() || null;
    if (byokKeyRaw && !BYOK_KEY_RE.test(byokKeyRaw)) {
      throw new ValidationError(
        "x-glm-key does not look like a Z.ai API key (expected format: id.secret)",
        { field: "x-glm-key" },
      );
    }
    if (byokModelRaw && !MODEL_RE.test(byokModelRaw)) {
      throw new ValidationError("x-glm-model must be a GLM model id", {
        field: "x-glm-model",
      });
    }
    if (byokBaseRaw && !(BASE_URLS as readonly string[]).includes(byokBaseRaw)) {
      throw new ValidationError("x-glm-base-url must be an allowlisted GLM endpoint", {
        field: "x-glm-base-url",
      });
    }

    const db = await getDb();
    const role = c.get("role");
    const userKey = c.get("userKey") ?? "anon";
    const model = byokModelRaw ?? pickModel(role);

    // ── Build token-light context from structured columns only ──────────────
    const contextParts: string[] = [];
    let cvUpdatedAt: Date | null = null;
    let jobUpdatedAt: Date | null = null;

    if (cvId) {
      const [cv] = await db
        .select({
          id: cvProfiles.id,
          skills: cvProfiles.skills,
          years: cvProfiles.estimatedYearsExperience,
          targetRole: cvProfiles.targetRole,
          updatedAt: cvProfiles.updatedAt,
        })
        .from(cvProfiles)
        .where(eq(cvProfiles.id, cvId))
        .limit(1);
      if (!cv) throw new NotFoundError("cv", cvId);
      cvUpdatedAt = cv.updatedAt;
      const topSkills = (cv.skills as Array<{ skill: string; occurrences: number }>)
        .sort((a, b) => b.occurrences - a.occurrences)
        .slice(0, 10)
        .map((s) => s.skill)
        .join(", ");
      contextParts.push(
        `User CV profile: target role ${cv.targetRole ?? "unknown"}; ` +
          `${cv.years ?? "?"} years experience; skills: ${topSkills || "none detected"}.`,
      );
    }

    if (jobId) {
      const [job] = await db
        .select({
          id: jobs.id,
          summary: jobs.summary,
          updatedAt: jobs.updatedAt,
        })
        .from(jobs)
        .where(eq(jobs.id, jobId))
        .limit(1);
      if (!job) throw new NotFoundError("job", jobId);
      jobUpdatedAt = job.updatedAt;
      contextParts.push(`Referenced job: ${job.summary}.`);
    }

    // ── Cache key: system + message + model + entity ids + updated_at ──────
    // (model, not role: same model shares cache regardless of who asked)
    const promptHash = sha256(
      [
        SYSTEM_PROMPT,
        model,
        message,
        cvId ? `${cvId}@${cvUpdatedAt?.toISOString() ?? ""}` : "",
        jobId ? `${jobId}@${jobUpdatedAt?.toISOString() ?? ""}` : "",
      ].join("\x1f"),
    );

    const cacheStart = Date.now();
    const [cached] = await db
      .select({ responseText: chatCache.responseText })
      .from(chatCache)
      .where(eq(chatCache.promptHash, promptHash))
      .limit(1);

    if (cached) {
      await logUsage({
        userKey,
        model,
        promptTokens: 0,
        completionTokens: 0,
        cached: 1,
        latencyMs: Date.now() - cacheStart,
      });
      return c.json({
        reply: cached.responseText,
        cached: true,
        model,
        byok: !!byokKeyRaw,
      });
    }

    // ── Live GLM call ────────────────────────────────────────────────────────
    const userContent =
      contextParts.length > 0
        ? `${contextParts.join("\n")}\n\nQuestion: ${message}`
        : message;

    let result;
    const start = Date.now();
    try {
      result = await chatCompletion({
        model,
        systemPrompt: SYSTEM_PROMPT,
        userMessage: userContent,
        apiKey: byokKeyRaw ?? undefined,
        baseURL: byokBaseRaw ?? undefined,
      });
    } catch (err) {
      // Actionable messages instead of a blanket "rate limited".
      const from = byokKeyRaw ? "your API key" : "the shared API key";
      if (err instanceof AppNoSharedKeyError) {
        return c.json(
          {
            error: "no_shared_key",
            message:
              "This server has no shared AI key configured. Add your own Z.ai API key above (it stays in your browser) to use chat.",
          },
          503,
        );
      }
      if (err instanceof AppNoBalanceError) {
        return c.json(
          {
            error: "insufficient_balance",
            message: `${from[0]!.toUpperCase() + from.slice(1)} has no remaining balance. Top up at https://z.ai (or open.bigmodel.cn) and try again.`,
          },
          402,
        );
      }
      if (err instanceof AppInvalidKeyError) {
        return c.json(
          {
            error: "invalid_api_key",
            message: `${from[0]!.toUpperCase() + from.slice(1)} was rejected. Check the key (and endpoint) and save it again.`,
          },
          401,
        );
      }
      if (err instanceof AppBadModelError) {
        return c.json(
          {
            error: "model_unavailable",
            message: `Model "${model}" is not available for this key. Pick another model.`,
          },
          400,
        );
      }
      if (err instanceof AppRateLimitError) {
        return c.json(
          { error: "rate_limited", message: "Upstream AI provider is rate-limiting. Retry shortly." },
          429,
        );
      }
      throw err;
    }
    const latencyMs = Date.now() - start;

    // Persist cache + usage.
    await db
      .insert(chatCache)
      .values({ promptHash, responseText: result.text, model })
      .onConflictDoNothing();
    await logUsage({
      userKey,
      model,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      cached: 0,
      latencyMs,
    });

    return c.json({
      reply: result.text,
      cached: false,
      model,
      byok: !!byokKeyRaw,
      usage: {
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        latencyMs,
      },
    });
  })

  /**
   * GET /chat/usage — per-user token spend (admin sees global).
   */
  .get("/chat/usage", async (c) => {
    const db = await getDb();
    const rows = await db
      .select()
      .from(chatUsage)
      .orderBy(chatUsage.createdAt)
      .limit(100);
    if (c.get("role") === "admin") {
      return c.json({ items: rows });
    }
    const userKey = c.get("userKey") ?? "anon";
    return c.json({
      items: rows.filter((r) => r.userKey === userKey),
    });
  });

async function logUsage(entry: {
  userKey: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  cached: 0 | 1;
  latencyMs: number;
}): Promise<void> {
  const db = await getDb();
  await db.insert(chatUsage).values({
    userKey: entry.userKey,
    model: entry.model,
    promptTokens: entry.promptTokens,
    completionTokens: entry.completionTokens,
    cached: entry.cached,
    latencyMs: entry.latencyMs,
  });
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
