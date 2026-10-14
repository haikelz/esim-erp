CREATE TYPE "public"."payment_attempt_status" AS ENUM('creating', 'pending', 'paid', 'failed', 'expired', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."automation_event_kind" AS ENUM('invoice.paid', 'fulfillment.ready', 'fulfillment.failed');--> statement-breakpoint
CREATE TYPE "public"."provisioning_status" AS ENUM('queued', 'processing', 'ready', 'failed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."payment_source" AS ENUM('midtrans', 'demo');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('unpaid', 'pending', 'paid', 'expired', 'failed');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('admin', 'sales', 'operations', 'finance');--> statement-breakpoint
CREATE TYPE "public"."supplier_scenario" AS ENUM('success', 'fail_once');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"actor_id" uuid,
	"action" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_key" text NOT NULL,
	"kind" "automation_event_kind" NOT NULL,
	"payload" jsonb NOT NULL,
	"acknowledged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "automation_events_event_key_unique" UNIQUE("event_key")
);
--> statement-breakpoint
CREATE TABLE "order_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "esim_profiles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"provider_order_id" text NOT NULL,
	"iccid" text NOT NULL,
	"activation_code_encrypted" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "esim_profiles_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "esim_profiles_provider_order_id_unique" UNIQUE("provider_order_id"),
	CONSTRAINT "esim_profiles_iccid_unique" UNIQUE("iccid")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_idr" integer NOT NULL,
	"payment_status" "payment_status" DEFAULT 'unpaid' NOT NULL,
	"paid_attempt_id" uuid,
	"paid_at" timestamp with time zone,
	"reconciliation_required" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoices_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "invoice_amount_positive" CHECK ("invoices"."amount_idr" > 0)
);
--> statement-breakpoint
CREATE TABLE "login_buckets" (
	"key" text PRIMARY KEY NOT NULL,
	"attempts" integer NOT NULL,
	"window_started_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sequence" serial NOT NULL,
	"customer_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"package_snapshot" jsonb NOT NULL,
	"supplier_scenario" "supplier_scenario" DEFAULT 'success' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sales_orders_sequence_unique" UNIQUE("sequence")
);
--> statement-breakpoint
CREATE TABLE "payment_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"gateway_order_id" text NOT NULL,
	"source" "payment_source" NOT NULL,
	"status" "payment_attempt_status" DEFAULT 'creating' NOT NULL,
	"redirect_url" text,
	"transaction_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_attempts_gateway_order_id_unique" UNIQUE("gateway_order_id")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider_sku" text NOT NULL,
	"name" text NOT NULL,
	"countries" text[] NOT NULL,
	"data_mb" integer NOT NULL,
	"validity_days" integer NOT NULL,
	"activation_rule" text DEFAULT 'first_network_connection' NOT NULL,
	"supplier_cost_idr" integer NOT NULL,
	"selling_price_idr" integer NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_provider_sku_unique" UNIQUE("provider_sku"),
	CONSTRAINT "product_cost_positive" CHECK ("products"."supplier_cost_idr" >= 0),
	CONSTRAINT "product_price_positive" CHECK ("products"."selling_price_idr" > 0),
	CONSTRAINT "product_quota_positive" CHECK ("products"."data_mb" > 0),
	CONSTRAINT "product_validity_positive" CHECK ("products"."validity_days" > 0)
);
--> statement-breakpoint
CREATE TABLE "provisioning_jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"status" "provisioning_status" DEFAULT 'queued' NOT NULL,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"lease_token" uuid,
	"locked_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provisioning_jobs_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "staff_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "supplier_account" (
	"id" integer PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"balance_idr" integer NOT NULL,
	"synced_at" timestamp with time zone,
	CONSTRAINT "single_supplier" CHECK ("supplier_account"."id" = 1),
	CONSTRAINT "supplier_balance_nonnegative" CHECK ("supplier_account"."balance_idr" >= 0)
);
--> statement-breakpoint
CREATE TABLE "supplier_debits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"amount_idr" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "supplier_debits_order_id_unique" UNIQUE("order_id"),
	CONSTRAINT "supplier_debit_nonnegative" CHECK ("supplier_debits"."amount_idr" >= 0)
);
--> statement-breakpoint
CREATE TABLE "staff_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "staff_role" NOT NULL,
	"password_hash" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_staff_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "esim_profiles" ADD CONSTRAINT "esim_profiles_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_customer_id_order_contacts_id_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."order_contacts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales_orders" ADD CONSTRAINT "sales_orders_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_attempts" ADD CONSTRAINT "payment_attempts_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioning_jobs" ADD CONSTRAINT "provisioning_jobs_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_sessions" ADD CONSTRAINT "staff_sessions_user_id_staff_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "supplier_debits" ADD CONSTRAINT "supplier_debits_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "automation_pending_idx" ON "automation_events" USING btree ("created_at") WHERE "automation_events"."acknowledged_at" IS NULL;--> statement-breakpoint
CREATE INDEX "invoice_payment_status_idx" ON "invoices" USING btree ("payment_status");--> statement-breakpoint
CREATE INDEX "orders_created_at_idx" ON "sales_orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "one_active_payment_per_invoice" ON "payment_attempts" USING btree ("invoice_id") WHERE "payment_attempts"."status" IN ('creating', 'pending', 'unknown');--> statement-breakpoint
CREATE INDEX "payment_invoice_idx" ON "payment_attempts" USING btree ("invoice_id");--> statement-breakpoint
CREATE INDEX "provisioning_queue_idx" ON "provisioning_jobs" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "session_expiry_idx" ON "staff_sessions" USING btree ("expires_at");