CREATE TYPE "public"."billing_mode" AS ENUM('PER_MINUTE', 'SLAB');--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "billing_mode" "billing_mode" DEFAULT 'PER_MINUTE' NOT NULL;