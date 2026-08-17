ALTER TABLE "business_settings" ADD COLUMN "logo_mime" text;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "logo_data" text;--> statement-breakpoint
ALTER TABLE "business_settings" ADD COLUMN "logo_updated_at" timestamp with time zone;