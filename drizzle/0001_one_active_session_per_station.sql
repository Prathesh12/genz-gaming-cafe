-- A station can host at most ONE live (ACTIVE or PAUSED) session at a time.
-- Enforced in the database so that two staff members tapping "START" on the
-- same station at the same moment can never both succeed, regardless of
-- application-level checks or race windows.
CREATE UNIQUE INDEX IF NOT EXISTS "game_sessions_one_live_per_station"
  ON "game_sessions" ("station_id")
  WHERE "status" IN ('ACTIVE', 'PAUSED');
--> statement-breakpoint

-- A session can have at most one OPEN pause segment.
CREATE UNIQUE INDEX IF NOT EXISTS "session_pauses_one_open_per_session"
  ON "session_pauses" ("session_id")
  WHERE "resumed_at" IS NULL;
--> statement-breakpoint

-- Payment amounts are always positive; a transaction total can never be negative.
ALTER TABLE "payments" ADD CONSTRAINT "payments_amount_positive" CHECK ("amount" > 0);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_total_non_negative" CHECK ("total_amount" >= 0);
--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_split_matches_total"
  CHECK ("cash_amount" + "upi_amount" = "total_amount");
--> statement-breakpoint

-- Pricing rules and menu prices can never be negative.
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_price_non_negative" CHECK ("price" >= 0);
--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_duration_positive" CHECK ("duration_minutes" > 0);
--> statement-breakpoint
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_price_non_negative" CHECK ("price" >= 0);
--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_quantity_positive" CHECK ("quantity" > 0);
--> statement-breakpoint

-- A reservation must end after it starts.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_time_order" CHECK ("end_time" > "start_time");
--> statement-breakpoint

-- Seed the singleton settings row so the app always has configuration.
INSERT INTO "business_settings" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;
