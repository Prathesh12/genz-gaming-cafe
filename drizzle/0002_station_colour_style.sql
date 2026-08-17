CREATE TYPE "public"."color_style" AS ENUM('SOLID', 'GRADIENT');--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "color_style" "color_style" DEFAULT 'SOLID' NOT NULL;--> statement-breakpoint
ALTER TABLE "stations" ADD COLUMN "color_accent" text DEFAULT '#FF8A00' NOT NULL;