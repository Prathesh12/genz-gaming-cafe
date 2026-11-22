CREATE TYPE "public"."pricing_model" AS ENUM('PER_PLAYER', 'ROOM');--> statement-breakpoint
CREATE TYPE "public"."playstation_type" AS ENUM('PS4', 'PS5');--> statement-breakpoint

ALTER TABLE "station_categories"
  ADD COLUMN "playstation_type" "playstation_type";--> statement-breakpoint
ALTER TABLE "station_categories"
  ADD COLUMN "pricing_model" "pricing_model" DEFAULT 'PER_PLAYER' NOT NULL;--> statement-breakpoint
ALTER TABLE "pricing_rules"
  ADD COLUMN "player_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions"
  ADD COLUMN "pricing_model" "pricing_model" DEFAULT 'PER_PLAYER' NOT NULL;--> statement-breakpoint
ALTER TABLE "game_sessions"
  ADD COLUMN "pricing_snapshot" jsonb;--> statement-breakpoint

ALTER TABLE "pricing_rules" DROP CONSTRAINT "pricing_rules_unique";--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_unique"
  UNIQUE("category_id", "customer_type", "time_band", "kind", "duration_minutes", "player_count");--> statement-breakpoint

ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_player_count_range"
  CHECK ("player_count" BETWEEN 1 AND 4);--> statement-breakpoint
ALTER TABLE "station_categories" ADD CONSTRAINT "station_categories_room_configuration"
  CHECK (
    "pricing_model" = 'PER_PLAYER'
    OR ("playstation_type" IS NOT NULL AND "max_players" BETWEEN 1 AND 4)
  );--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_room_player_count_range"
  CHECK ("pricing_model" = 'PER_PLAYER' OR "player_count" BETWEEN 1 AND 4);--> statement-breakpoint

-- Add Dr. Games defaults without converting legacy categories or replacing any
-- configured rule. Rules are created only for categories inserted by this CTE;
-- a same-name customized category makes the insert return no row and is left
-- completely untouched. UUIDs come from the table's gen_random_uuid() default.
WITH category_defaults("name", "description", "playstation_type", "sort_order") AS (
  VALUES
    ('PS4 Room', 'PlayStation 4 room', 'PS4'::playstation_type, 10),
    ('PS5 Room', 'PlayStation 5 room', 'PS5'::playstation_type, 20)
),
inserted_categories AS (
  INSERT INTO "station_categories"
    ("name", "description", "playstation_type", "pricing_model", "max_players", "sort_order")
  SELECT "name", "description", "playstation_type", 'ROOM', 4, "sort_order"
  FROM category_defaults
  ON CONFLICT DO NOTHING
  RETURNING "id", "playstation_type"
),
room_rates("playstation_type", "player_count", "price") AS (
  VALUES
    ('PS4'::playstation_type, 1, 6000),
    ('PS4'::playstation_type, 2, 6000),
    ('PS4'::playstation_type, 3, 8000),
    ('PS4'::playstation_type, 4, 8000),
    ('PS5'::playstation_type, 1, 8000),
    ('PS5'::playstation_type, 2, 8000),
    ('PS5'::playstation_type, 3, 10000),
    ('PS5'::playstation_type, 4, 10000)
)
INSERT INTO "pricing_rules"
  ("category_id", "customer_type", "time_band", "kind", "duration_minutes", "player_count", "price")
SELECT category."id", 'REGULAR', 'NORMAL', 'SLAB', 60, rate."player_count", rate."price"
FROM inserted_categories category
INNER JOIN room_rates rate ON rate."playstation_type" = category."playstation_type";
