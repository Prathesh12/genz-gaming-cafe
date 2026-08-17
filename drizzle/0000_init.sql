CREATE TYPE "public"."customer_type" AS ENUM('REGULAR', 'MEMBER');--> statement-breakpoint
CREATE TYPE "public"."discount_type" AS ENUM('NONE', 'FLAT', 'PERCENT');--> statement-breakpoint
CREATE TYPE "public"."food_order_status" AS ENUM('ORDERED', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."payment_channel" AS ENUM('CASH', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."payment_method" AS ENUM('CASH', 'UPI', 'SPLIT');--> statement-breakpoint
CREATE TYPE "public"."pricing_kind" AS ENUM('SLAB', 'DAY_PASS');--> statement-breakpoint
CREATE TYPE "public"."reservation_status" AS ENUM('BOOKED', 'STARTED', 'COMPLETED', 'CANCELLED', 'NO_SHOW');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('ADMIN', 'MANAGER', 'STAFF');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."station_status" AS ENUM('AVAILABLE', 'OCCUPIED', 'RESERVED', 'MAINTENANCE');--> statement-breakpoint
CREATE TYPE "public"."time_band" AS ENUM('NORMAL', 'NIGHT');--> statement-breakpoint
CREATE TYPE "public"."transaction_status" AS ENUM('COMPLETED', 'REFUNDED', 'VOID');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"user_label" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"ip_address" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "business_settings" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"cafe_name" text DEFAULT 'GENZ GAMING CAFE' NOT NULL,
	"address" text,
	"phone" text,
	"email" text,
	"gst_number" text,
	"tax_enabled" boolean DEFAULT false NOT NULL,
	"currency_symbol" text DEFAULT '₹' NOT NULL,
	"night_start" text DEFAULT '23:00' NOT NULL,
	"night_end" text DEFAULT '06:00' NOT NULL,
	"day_pass_enabled" boolean DEFAULT true NOT NULL,
	"day_pass_minutes" integer DEFAULT 720 NOT NULL,
	"membership_days" integer DEFAULT 365 NOT NULL,
	"membership_price" integer DEFAULT 100000 NOT NULL,
	"membership_expiry_warning_days" integer DEFAULT 30 NOT NULL,
	"minimum_bill_minutes" integer DEFAULT 1 NOT NULL,
	"receipt_footer" text DEFAULT 'Thank you for gaming with us!' NOT NULL,
	"invoice_prefix" text DEFAULT 'GZ' NOT NULL,
	"invoice_counter" integer DEFAULT 0 NOT NULL,
	"timezone" text DEFAULT 'Asia/Kolkata' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"price" integer NOT NULL,
	"description" text,
	"image_url" text,
	"tax_percent" integer DEFAULT 0 NOT NULL,
	"prep_minutes" integer,
	"is_available" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_order_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"food_item_id" uuid NOT NULL,
	"name_snapshot" text NOT NULL,
	"unit_price" integer NOT NULL,
	"tax_percent" integer DEFAULT 0 NOT NULL,
	"quantity" integer NOT NULL,
	"line_total" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "food_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"session_id" uuid NOT NULL,
	"status" "food_order_status" DEFAULT 'ORDERED' NOT NULL,
	"notes" text,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "game_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"station_id" uuid NOT NULL,
	"member_id" uuid,
	"membership_id" uuid,
	"customer_name" text,
	"customer_mobile" text,
	"customer_type" "customer_type" DEFAULT 'REGULAR' NOT NULL,
	"status" "session_status" DEFAULT 'ACTIVE' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"planned_minutes" integer,
	"paused_seconds" integer DEFAULT 0 NOT NULL,
	"notes" text,
	"started_by_id" uuid NOT NULL,
	"ended_by_id" uuid,
	"reservation_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "members" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_code" text NOT NULL,
	"full_name" text NOT NULL,
	"mobile" text NOT NULL,
	"date_of_birth" date,
	"aadhaar_enc" text,
	"aadhaar_last4" text,
	"aadhaar_hash" text,
	"address" text,
	"notes" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"member_id" uuid NOT NULL,
	"start_date" timestamp with time zone NOT NULL,
	"end_date" timestamp with time zone NOT NULL,
	"price" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"transaction_id" uuid NOT NULL,
	"channel" "payment_channel" NOT NULL,
	"amount" integer NOT NULL,
	"reference" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pricing_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"category_id" uuid NOT NULL,
	"customer_type" "customer_type" NOT NULL,
	"time_band" time_band NOT NULL,
	"kind" "pricing_kind" DEFAULT 'SLAB' NOT NULL,
	"duration_minutes" integer NOT NULL,
	"price" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pricing_rules_unique" UNIQUE("category_id","customer_type","time_band","kind","duration_minutes")
);
--> statement-breakpoint
CREATE TABLE "reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"station_id" uuid NOT NULL,
	"customer_name" text NOT NULL,
	"mobile" text,
	"start_time" timestamp with time zone NOT NULL,
	"end_time" timestamp with time zone NOT NULL,
	"notes" text,
	"status" "reservation_status" DEFAULT 'BOOKED' NOT NULL,
	"created_by_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"minutes" integer NOT NULL,
	"created_by_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"paused_at" timestamp with time zone NOT NULL,
	"resumed_at" timestamp with time zone,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "station_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"color" text DEFAULT '#F5C518' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"category_id" uuid NOT NULL,
	"color" text DEFAULT '#F5C518' NOT NULL,
	"description" text,
	"status" "station_status" DEFAULT 'AVAILABLE' NOT NULL,
	"maintenance_reason" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "transactions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"session_id" uuid NOT NULL,
	"station_id" uuid NOT NULL,
	"station_snapshot" text NOT NULL,
	"category_snapshot" text NOT NULL,
	"member_id" uuid,
	"customer_name" text,
	"customer_mobile" text,
	"customer_type" "customer_type" DEFAULT 'REGULAR' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone NOT NULL,
	"duration_minutes" integer NOT NULL,
	"billed_minutes" integer NOT NULL,
	"gaming_amount" integer NOT NULL,
	"food_amount" integer NOT NULL,
	"tax_amount" integer DEFAULT 0 NOT NULL,
	"subtotal" integer NOT NULL,
	"discount_type" "discount_type" DEFAULT 'NONE' NOT NULL,
	"discount_value" integer DEFAULT 0 NOT NULL,
	"discount_amount" integer DEFAULT 0 NOT NULL,
	"discount_reason" text,
	"discount_by_id" uuid,
	"total_amount" integer NOT NULL,
	"payment_method" "payment_method" NOT NULL,
	"cash_amount" integer DEFAULT 0 NOT NULL,
	"upi_amount" integer DEFAULT 0 NOT NULL,
	"status" "transaction_status" DEFAULT 'COMPLETED' NOT NULL,
	"breakdown" jsonb,
	"staff_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "role" DEFAULT 'STAFF' NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"can_discount" boolean DEFAULT false NOT NULL,
	"max_discount_percent" integer DEFAULT 0 NOT NULL,
	"can_view_sensitive" boolean DEFAULT false NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_items" ADD CONSTRAINT "food_items_category_id_food_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."food_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_order_id_food_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."food_orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_order_items" ADD CONSTRAINT "food_order_items_food_item_id_food_items_id_fk" FOREIGN KEY ("food_item_id") REFERENCES "public"."food_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "food_orders" ADD CONSTRAINT "food_orders_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_started_by_id_users_id_fk" FOREIGN KEY ("started_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_ended_by_id_users_id_fk" FOREIGN KEY ("ended_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_sessions" ADD CONSTRAINT "game_sessions_reservation_id_reservations_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."reservations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_transaction_id_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."transactions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pricing_rules" ADD CONSTRAINT "pricing_rules_category_id_station_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."station_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_extensions" ADD CONSTRAINT "session_extensions_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_extensions" ADD CONSTRAINT "session_extensions_created_by_id_users_id_fk" FOREIGN KEY ("created_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_pauses" ADD CONSTRAINT "session_pauses_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stations" ADD CONSTRAINT "stations_category_id_station_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."station_categories"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_session_id_game_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."game_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_station_id_stations_id_fk" FOREIGN KEY ("station_id") REFERENCES "public"."stations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_member_id_members_id_fk" FOREIGN KEY ("member_id") REFERENCES "public"."members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_discount_by_id_users_id_fk" FOREIGN KEY ("discount_by_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_staff_id_users_id_fk" FOREIGN KEY ("staff_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_action_idx" ON "audit_logs" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_logs_user_idx" ON "audit_logs" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_categories_name_key" ON "food_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "food_items_name_category_key" ON "food_items" USING btree (lower("name"),"category_id");--> statement-breakpoint
CREATE INDEX "food_items_available_idx" ON "food_items" USING btree ("is_active","is_available");--> statement-breakpoint
CREATE INDEX "food_order_items_order_idx" ON "food_order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "food_order_items_item_idx" ON "food_order_items" USING btree ("food_item_id");--> statement-breakpoint
CREATE UNIQUE INDEX "food_orders_code_key" ON "food_orders" USING btree ("code");--> statement-breakpoint
CREATE INDEX "food_orders_session_idx" ON "food_orders" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "food_orders_status_idx" ON "food_orders" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "game_sessions_code_key" ON "game_sessions" USING btree ("code");--> statement-breakpoint
CREATE INDEX "game_sessions_status_idx" ON "game_sessions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "game_sessions_station_status_idx" ON "game_sessions" USING btree ("station_id","status");--> statement-breakpoint
CREATE INDEX "game_sessions_started_idx" ON "game_sessions" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "members_code_key" ON "members" USING btree ("member_code");--> statement-breakpoint
CREATE UNIQUE INDEX "members_mobile_key" ON "members" USING btree ("mobile");--> statement-breakpoint
CREATE UNIQUE INDEX "members_aadhaar_hash_key" ON "members" USING btree ("aadhaar_hash");--> statement-breakpoint
CREATE INDEX "members_name_idx" ON "members" USING btree ("full_name");--> statement-breakpoint
CREATE INDEX "memberships_member_idx" ON "memberships" USING btree ("member_id","end_date");--> statement-breakpoint
CREATE INDEX "memberships_end_idx" ON "memberships" USING btree ("end_date");--> statement-breakpoint
CREATE INDEX "payments_transaction_idx" ON "payments" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "payments_channel_idx" ON "payments" USING btree ("channel","created_at");--> statement-breakpoint
CREATE INDEX "pricing_rules_category_idx" ON "pricing_rules" USING btree ("category_id","is_active");--> statement-breakpoint
CREATE INDEX "reservations_station_idx" ON "reservations" USING btree ("station_id","start_time");--> statement-breakpoint
CREATE INDEX "reservations_status_idx" ON "reservations" USING btree ("status","start_time");--> statement-breakpoint
CREATE INDEX "session_extensions_session_idx" ON "session_extensions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "session_pauses_session_idx" ON "session_pauses" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "station_categories_name_key" ON "station_categories" USING btree (lower("name"));--> statement-breakpoint
CREATE UNIQUE INDEX "stations_code_key" ON "stations" USING btree (upper("code"));--> statement-breakpoint
CREATE INDEX "stations_status_idx" ON "stations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "stations_category_idx" ON "stations" USING btree ("category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_code_key" ON "transactions" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_session_key" ON "transactions" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "transactions_created_idx" ON "transactions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "transactions_station_created_idx" ON "transactions" USING btree ("station_id","created_at");--> statement-breakpoint
CREATE INDEX "transactions_method_idx" ON "transactions" USING btree ("payment_method");--> statement-breakpoint
CREATE INDEX "transactions_status_idx" ON "transactions" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "users_role_idx" ON "users" USING btree ("role");