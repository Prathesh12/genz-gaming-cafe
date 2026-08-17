CREATE TABLE "session_players" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"slot" integer NOT NULL,
	"member_id" uuid,
	"membership_id" uuid,
	"customer_type" "customer_type" DEFAULT 'REGULAR' NOT NULL,
	"name" text,
	"membership_valid_until" timestamp with time zone,
	"amount" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "game_sessions" ADD COLUMN "player_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "station_categories" ADD COLUMN "max_players" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "player_count" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_players" ADD CONSTRAINT "session_players_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "session_players_slot_key" ON "session_players" USING btree ("session_id","slot");--> statement-breakpoint
CREATE INDEX "session_players_session_idx" ON "session_players" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_players_member_idx" ON "session_players" USING btree ("member_id");--> statement-breakpoint
-- ---------------------------------------------------------------------------
-- Guards. The application checks all of these too; these are the backstop that
-- holds even if a future code path forgets.
-- ---------------------------------------------------------------------------

-- The same member cannot be added twice to one session.
CREATE UNIQUE INDEX "session_players_member_key"
  ON "session_players" ("session_id", "member_id")
  WHERE "member_id" IS NOT NULL;--> statement-breakpoint

-- Member pricing must always point at the member it belongs to.
ALTER TABLE "session_players"
  ADD CONSTRAINT "session_players_member_required"
  CHECK ("customer_type" = 'REGULAR' OR "member_id" IS NOT NULL);--> statement-breakpoint

ALTER TABLE "session_players"
  ADD CONSTRAINT "session_players_slot_positive" CHECK ("slot" >= 1);--> statement-breakpoint

ALTER TABLE "session_players"
  ADD CONSTRAINT "session_players_amount_not_negative" CHECK ("amount" IS NULL OR "amount" >= 0);--> statement-breakpoint

ALTER TABLE "game_sessions"
  ADD CONSTRAINT "game_sessions_player_count_positive" CHECK ("player_count" >= 1);--> statement-breakpoint

ALTER TABLE "transactions"
  ADD CONSTRAINT "transactions_player_count_positive" CHECK ("player_count" >= 1);--> statement-breakpoint

-- A category can seat between one and twelve people.
ALTER TABLE "station_categories"
  ADD CONSTRAINT "station_categories_max_players_range"
  CHECK ("max_players" BETWEEN 1 AND 12);--> statement-breakpoint

-- ---------------------------------------------------------------------------
-- Backfill. Every session that already exists becomes a one-player session, so
-- the new code (which reads session_players) sees exactly what the old member
-- columns on game_sessions always said. Nothing about any past bill changes.
-- ---------------------------------------------------------------------------
INSERT INTO "session_players"
  ("session_id", "slot", "member_id", "membership_id", "customer_type", "name", "membership_valid_until")
SELECT s."id", 1, s."member_id", s."membership_id", s."customer_type", s."customer_name", m."end_date"
FROM "game_sessions" s
LEFT JOIN "memberships" m ON m."id" = s."membership_id";--> statement-breakpoint

-- With one player, that player's share of the bill is the whole bill.
UPDATE "session_players" sp
SET "amount" = t."total_amount"
FROM "transactions" t
WHERE t."session_id" = sp."session_id"
  AND t."status" = 'COMPLETED'
  AND sp."amount" IS NULL;
