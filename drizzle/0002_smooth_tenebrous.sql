CREATE TABLE "rate_limit_hits" (
	"user_key" text NOT NULL,
	"hit_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "rate_limit_hits_user_key_hit_at_pk" PRIMARY KEY("user_key","hit_at")
);
--> statement-breakpoint
CREATE INDEX "rate_limit_hits_user_key_idx" ON "rate_limit_hits" USING btree ("user_key");