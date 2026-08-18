CREATE TYPE "public"."ats_type" AS ENUM('greenhouse', 'lever', 'ashby');--> statement-breakpoint
CREATE TYPE "public"."embedding_status" AS ENUM('pending', 'embedded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TABLE "chat_cache" (
	"prompt_hash" text PRIMARY KEY NOT NULL,
	"response_text" text NOT NULL,
	"model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "chat_usage" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_key" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer DEFAULT 0 NOT NULL,
	"completion_tokens" integer DEFAULT 0 NOT NULL,
	"cached" integer DEFAULT 0 NOT NULL,
	"latency_ms" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"ats_type" "ats_type" NOT NULL,
	"board_slug" text NOT NULL,
	"enabled" integer DEFAULT 1 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cv_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"filename" text NOT NULL,
	"content_type" varchar(64) NOT NULL,
	"raw_bytes_ref" text,
	"raw_text" text NOT NULL,
	"contacts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"skills" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"estimated_years_experience" real,
	"target_role" text,
	"embedding" vector(384),
	"embedding_status" "embedding_status" DEFAULT 'pending' NOT NULL,
	"embedding_retry_count" integer DEFAULT 0 NOT NULL,
	"embedding_last_attempt_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cv_skills" (
	"cv_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"occurrences" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "cv_skills_cv_id_skill_pk" PRIMARY KEY("cv_id","skill")
);
--> statement-breakpoint
CREATE TABLE "embedding_cache" (
	"content_hash" text PRIMARY KEY NOT NULL,
	"embedding" vector(384) NOT NULL,
	"model" text NOT NULL,
	"dim" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_skills" (
	"job_id" uuid NOT NULL,
	"skill" text NOT NULL,
	CONSTRAINT "job_skills_job_id_skill_pk" PRIMARY KEY("job_id","skill")
);
--> statement-breakpoint
CREATE TABLE "job_sources" (
	"job_id" uuid NOT NULL,
	"source" text NOT NULL,
	"source_job_id" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_sources_job_id_source_pk" PRIMARY KEY("job_id","source")
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"content_hash" text NOT NULL,
	"title" text NOT NULL,
	"company" text NOT NULL,
	"location" text,
	"remote_allowed" integer,
	"seniority" text,
	"salary_min" integer,
	"salary_max" integer,
	"salary_currency" varchar(8),
	"salary_period" varchar(16),
	"description" text,
	"summary" text NOT NULL,
	"url" text NOT NULL,
	"embedding" vector(384),
	"embedding_status" "embedding_status" DEFAULT 'pending' NOT NULL,
	"embedding_retry_count" integer DEFAULT 0 NOT NULL,
	"embedding_last_attempt_at" timestamp with time zone,
	"posted_at" timestamp with time zone,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"name" text PRIMARY KEY NOT NULL,
	"last_run_at" timestamp with time zone,
	"last_status" "source_status",
	"last_error" text,
	"jobs_fetched" integer DEFAULT 0 NOT NULL,
	"embedding_pending_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cv_skills" ADD CONSTRAINT "cv_skills_cv_id_cv_profiles_id_fk" FOREIGN KEY ("cv_id") REFERENCES "public"."cv_profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_skills" ADD CONSTRAINT "job_skills_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_sources" ADD CONSTRAINT "job_sources_job_id_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "chat_usage_created_idx" ON "chat_usage" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "chat_usage_user_key_idx" ON "chat_usage" USING btree ("user_key");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_name_ats_idx" ON "companies" USING btree ("name","ats_type");--> statement-breakpoint
CREATE INDEX "cv_profiles_embedding_status_idx" ON "cv_profiles" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX "job_skills_skill_idx" ON "job_skills" USING btree ("skill");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_content_hash_idx" ON "jobs" USING btree ("content_hash");--> statement-breakpoint
CREATE INDEX "jobs_embedding_status_idx" ON "jobs" USING btree ("embedding_status");--> statement-breakpoint
CREATE INDEX "jobs_last_seen_at_idx" ON "jobs" USING btree ("last_seen_at");--> statement-breakpoint
CREATE INDEX "jobs_posted_at_idx" ON "jobs" USING btree ("posted_at");--> statement-breakpoint
CREATE INDEX "jobs_company_idx" ON "jobs" USING btree ("company");