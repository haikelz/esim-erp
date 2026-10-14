CREATE TYPE "public"."invoice_adjustment_kind" AS ENUM('gateway_fee', 'refund');--> statement-breakpoint
CREATE TABLE "invoice_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"invoice_id" uuid NOT NULL,
	"kind" "invoice_adjustment_kind" NOT NULL,
	"amount_idr" integer NOT NULL,
	"reference" text NOT NULL,
	"reason" text NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "invoice_adjustment_positive" CHECK ("invoice_adjustments"."amount_idr" > 0)
);
--> statement-breakpoint
CREATE TABLE "staff_access_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	CONSTRAINT "staff_access_purpose_valid" CHECK ("staff_access_tokens"."purpose" IN ('invite', 'reset'))
);
--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "resource_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "audit_events" ADD COLUMN "details" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "staff_users" ADD COLUMN "onboarded_at" timestamp with time zone DEFAULT now();--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_adjustments" ADD CONSTRAINT "invoice_adjustments_created_by_staff_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_access_tokens" ADD CONSTRAINT "staff_access_tokens_user_id_staff_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "invoice_adjustment_reference_unique" ON "invoice_adjustments" USING btree ("invoice_id","kind","reference");--> statement-breakpoint
CREATE INDEX "staff_access_user_idx" ON "staff_access_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "one_unused_access_link_per_staff" ON "staff_access_tokens" USING btree ("user_id") WHERE "staff_access_tokens"."used_at" IS NULL;--> statement-breakpoint
CREATE INDEX "audit_created_id_idx" ON "audit_events" USING btree ("created_at","id");