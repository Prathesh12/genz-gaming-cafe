ALTER TABLE "food_items" ADD COLUMN "member_price" integer;--> statement-breakpoint
-- A member deal that costs more than the ordinary price is a typo, not a deal.
ALTER TABLE "food_items"
  ADD CONSTRAINT "food_items_member_price_sane"
  CHECK ("member_price" IS NULL OR ("member_price" >= 0 AND "member_price" <= "price"));
