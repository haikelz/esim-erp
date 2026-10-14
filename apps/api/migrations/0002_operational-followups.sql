CREATE TYPE "public"."exception_follow_up_outcome" AS ENUM('investigating', 'waiting_gateway', 'waiting_supplier', 'review_complete');--> statement-breakpoint
ALTER TYPE "public"."automation_event_kind" ADD VALUE 'invoice.reminder_due';--> statement-breakpoint
ALTER TYPE "public"."payment_status" ADD VALUE 'cancelled';--> statement-breakpoint
CREATE TABLE "exception_follow_ups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_id" uuid NOT NULL,
	"actor_id" uuid NOT NULL,
	"assignee_id" uuid,
	"outcome" "exception_follow_up_outcome" NOT NULL,
	"note" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "invoices" ADD COLUMN "cancelled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "exception_follow_ups" ADD CONSTRAINT "exception_follow_ups_order_id_sales_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."sales_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_follow_ups" ADD CONSTRAINT "exception_follow_ups_actor_id_staff_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exception_follow_ups" ADD CONSTRAINT "exception_follow_ups_assignee_id_staff_users_id_fk" FOREIGN KEY ("assignee_id") REFERENCES "public"."staff_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exception_follow_up_order_idx" ON "exception_follow_ups" USING btree ("order_id","created_at","id");--> statement-breakpoint
CREATE INDEX "contact_email_normalized_idx" ON "order_contacts" USING btree (lower("email"));