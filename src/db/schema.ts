import {
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * pgvector column. Drizzle does not ship a native vector type, so we register
 * one. The `vector(N)` SQL type is emitted via dataType() and the extension is
 * created in the first migration (see `src/db/migrate.ts`).
 *
 * Dimension is tied to the embedding model choice (BGE small-en-v1.5 → 384).
 * Changing models requires regenerating the migration.
 */
export const VECTOR_DIM = 384;

const vectorColumn = customType<{ data: string; default: false }>({
  dataType() {
    return `vector(${VECTOR_DIM})`;
  },
});

export const vector512 = () => vectorColumn();

// ── Enums ─────────────────────────────────────────────────────────────────

export const embeddingStatusEnum = pgEnum("embedding_status", [
  "pending",
  "embedded",
  "failed",
]);

export const atsTypeEnum = pgEnum("ats_type", ["greenhouse", "lever", "ashby"]);

export const sourceStatusEnum = pgEnum("source_status", ["ok", "error"]);

// ── Companies (ATS board registry) ─────────────────────────────────────────

export const companies = pgTable(
  "companies",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    atsType: atsTypeEnum("ats_type").notNull(),
    boardSlug: text("board_slug").notNull(),
    hqLocation: text("hq_location"), // appended to jobs whose location is generic ("Hybrid", "Remote")
    enabled: integer("enabled")
      .$type<0 | 1>()
      .notNull()
      .default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameAtsIdx: uniqueIndex("companies_name_ats_idx").on(t.name, t.atsType),
  }),
);

// ── Source run metadata ────────────────────────────────────────────────────

export const sources = pgTable("sources", {
  name: text("name").primaryKey(),
  lastRunAt: timestamp("last_run_at", { withTimezone: true }),
  lastStatus: sourceStatusEnum("last_status"),
  lastError: text("last_error"),
  jobsFetched: integer("jobs_fetched").notNull().default(0),
  embeddingPendingCount: integer("embedding_pending_count").notNull().default(0),
});

// ── Jobs (canonical, deduped by content_hash) ──────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    contentHash: text("content_hash").notNull(),
    title: text("title").notNull(),
    company: text("company").notNull(),
    location: text("location"),
    remoteAllowed: integer("remote_allowed").$type<0 | 1>(),
    seniority: text("seniority"),

    salaryMin: integer("salary_min"),
    salaryMax: integer("salary_max"),
    salaryCurrency: varchar("salary_currency", { length: 8 }),
    salaryPeriod: varchar("salary_period", { length: 16 }),

    description: text("description"),
    summary: text("summary").notNull(),
    url: text("url").notNull(),

    embedding: vector512(),
    embeddingStatus: embeddingStatusEnum("embedding_status").notNull().default("pending"),
    embeddingRetryCount: integer("embedding_retry_count").notNull().default(0),
    embeddingLastAttemptAt: timestamp("embedding_last_attempt_at", { withTimezone: true }),

    postedAt: timestamp("posted_at", { withTimezone: true }),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    contentHashIdx: uniqueIndex("jobs_content_hash_idx").on(t.contentHash),
    embeddingStatusIdx: index("jobs_embedding_status_idx").on(t.embeddingStatus),
    lastSeenAtIdx: index("jobs_last_seen_at_idx").on(t.lastSeenAt),
    postedAtIdx: index("jobs_posted_at_idx").on(t.postedAt),
    companyIdx: index("jobs_company_idx").on(t.company),
  }),
);

// ── Job ↔ sources (many-to-many) ───────────────────────────────────────────

export const jobSources = pgTable(
  "job_sources",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    source: text("source").notNull(),
    sourceJobId: text("source_job_id"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.jobId, t.source] }),
  }),
);

// ── Job skills (denormalized for filtering) ────────────────────────────────

export const jobSkills = pgTable(
  "job_skills",
  {
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.jobId, t.skill] }),
    skillIdx: index("job_skills_skill_idx").on(t.skill),
  }),
);

// ── CV profiles ────────────────────────────────────────────────────────────

export const cvProfiles = pgTable(
  "cv_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    filename: text("filename").notNull(),
    contentType: varchar("content_type", { length: 128 }).notNull(),
    rawBytesRef: text("raw_bytes_ref"), // filesystem path; bytes are not stored in DB
    rawText: text("raw_text").notNull(),

    contacts: jsonb("contacts").notNull().default({}),
    sections: jsonb("sections").notNull().default({}),
    skills: jsonb("skills").notNull().default([]), // [{ skill, occurrences }]
    estimatedYearsExperience: real("estimated_years_experience"),
    targetRole: text("target_role"),

    embedding: vector512(),
    embeddingStatus: embeddingStatusEnum("embedding_status").notNull().default("pending"),
    embeddingRetryCount: integer("embedding_retry_count").notNull().default(0),
    embeddingLastAttemptAt: timestamp("embedding_last_attempt_at", { withTimezone: true }),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    embeddingStatusIdx: index("cv_profiles_embedding_status_idx").on(t.embeddingStatus),
  }),
);

// ── CV skills (denormalized for fast filtering) ────────────────────────────

export const cvSkills = pgTable(
  "cv_skills",
  {
    cvId: uuid("cv_id")
      .notNull()
      .references(() => cvProfiles.id, { onDelete: "cascade" }),
    skill: text("skill").notNull(),
    occurrences: integer("occurrences").notNull().default(1),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.cvId, t.skill] }),
  }),
);

// ── Embedding cache (keyed by content hash) ────────────────────────────────

export const embeddingCache = pgTable("embedding_cache", {
  contentHash: text("content_hash").primaryKey(),
  embedding: vector512().notNull(),
  model: text("model").notNull(),
  dim: integer("dim").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Chat usage logging ─────────────────────────────────────────────────────

export const chatUsage = pgTable(
  "chat_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userKey: text("user_key").notNull(), // 'admin' or 'ip:<sha256>'
    model: text("model").notNull(),
    promptTokens: integer("prompt_tokens").notNull().default(0),
    completionTokens: integer("completion_tokens").notNull().default(0),
    cached: integer("cached").$type<0 | 1>().notNull().default(0),
    latencyMs: integer("latency_ms").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("chat_usage_created_idx").on(t.createdAt),
    userKeyIdx: index("chat_usage_user_key_idx").on(t.userKey),
  }),
);

// ── Rate limit hits (serverless-safe sliding window) ──────────────────────

export const rateLimitHits = pgTable(
  "rate_limit_hits",
  {
    userKey: text("user_key").notNull(),
    hitAt: timestamp("hit_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.userKey, t.hitAt] }),
    userKeyIdx: index("rate_limit_hits_user_key_idx").on(t.userKey),
  }),
);

// ── Chat response cache ────────────────────────────────────────────────────

export const chatCache = pgTable("chat_cache", {
  promptHash: text("prompt_hash").primaryKey(),
  responseText: text("response_text").notNull(),
  model: text("model").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
