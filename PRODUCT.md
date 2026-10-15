# ERP eSIM internal

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, ReUI, Hono on Cloudflare Workers (or a Bun image),
PostgreSQL, Midtrans Snap sandbox, n8n, and Moonrepo. Vercel and Workers remain
the intended hosts; Docker images are an alternative distribution artifact.
The user supplied `esim-erp.ekel.dev` (web) and `api.esim-erp.ekel.dev` (API)
as live addresses, but this revision has not been verified on them.

## Users and purpose

Internal staff of a telecommunications company reselling travel eSIM data
packages. Staff maintain packages, record customer orders, collect payments,
issue eSIM profiles, and reconcile supplier costs. Customers do not log in to
the ERP; they can pay through a Midtrans-hosted link shared by staff.

## Capabilities and constraints

- Products & Supplier: package coverage, quota, validity, supplier cost, price.
- Sales & Fulfillment: staff-entered orders, a customer directory with order
  history, pre-payment cancellation, provisioning, installation information, a
  durable job queue, and an exception inbox with assigned follow-up history.
- Billing & Finance: one invoice per order, payment links, Midtrans-verified
  settlements, an opt-in internal payment simulation, a browser-printable
  invoice, period-scoped summaries and paid-sales breakdowns, CSV export,
  supplier spend, and recorded gateway fees/refunds. Recording a refund does
  not submit it to the gateway.
- Staff access: administrator-issued one-use invitations and password-reset
  links, role changes and deactivation with session revocation, and an audit log.
- The web app is installable as a PWA. Staff pages, API responses, and
  transactions require a connection; they are not saved for offline use.
- n8n handles internal notifications, one reminder after 24 hours without
  payment, and reports. It does not decide whether an invoice is paid or whether
  to purchase an eSIM. Its finance email is an all-time position, not the
  period-filtered UI report.
- A paid invoice and failed fulfillment are distinct states.
- Order prices and package details are immutable snapshots.
- Installation codes are confidential. Validity starts according to the package's
  activation rule, never automatically at invoice creation.
- No storefront, customer accounts, multi-company, multiple suppliers, top-ups,
  automatic refunds, or full general ledger in the MVP.

## Operational scope

One company, one supplier, IDR, and one package/profile per order. Admin, sales,
operations, and finance are staff roles; there is no public registration.
Admin controls catalog pricing, sales creates orders, operations handles
provisioning, and finance handles payment reconciliation. A separate Docker
worker process or Workers Cron consumes queued fulfillment; the HTTP process
does not process jobs periodically.

The supplier is selected by the company, but its identity and API contract have
not been supplied. The current adapter serves local fixtures, not mobile service.
The UI reports the supplier as disconnected and catalog/balance as unverified.
Non-service profiles must not expose an installation QR, activation code, or copy
action. A ready provisioning record is not proof of installation or activation.

Midtrans sandbox credentials have been supplied. A hosted Snap checkout and BCA
VA payment through the official simulator reached settlement; server-side
reconciliation persisted the paid invoice without duplicate jobs or debits.
Automatic delivery to a public webhook has not been verified. The ERP uses
Snap redirect, not a custom checkout or the snap.js popup.

Finance periods select invoices by their inclusive creation dates in WIB, then
show current payment/fulfillment states and adjustment totals. They are not
historical end-of-period balances. Net recorded margin excludes unrecorded fees;
the UI flags those invoices rather than assuming the fee is zero. CSV search
does not narrow the finance summary.

The sales breakdown includes only invoices currently paid within the same
creation-date period. It groups by package snapshot, WIB issue date, and covered
country. A regional package appears in each country it covers, so country rows
overlap and cannot be summed into a total. The customer directory groups
immutable order-contact snapshots by case-insensitive email; it shows the latest
name and phone but retains each order's original contact details. Only admin and
sales can access it.

Admin and finance can print an invoice or save it as a PDF through the browser's
print dialog. This is a current-state billing document, not a tax invoice or a
server-generated PDF. Admin and sales can cancel an unpaid order only if **no
payment attempt has ever been created**, including failed or expired attempts.
Cancellation cannot be undone or used as a refund; cancelled invoices are
excluded from outstanding amounts and cannot receive a new payment attempt.

Admin, operations, and finance can assign an active, onboarded staff member and
record an outcome and note for an open exception. Notes remain in history and
audit after the exception closes; a note itself never closes it. The local-only
reminder enqueues one internal outbox event per invoice at least 24 hours after
issue while unpaid, pending, failed, or expired and not under reconciliation.
Payment, cancellation, or reconciliation suppress a pending reminder. The
recipient is a fixed synthetic internal address through Mailpit, never the
customer. Delivery remains at least once; an event fetched just before a status
change may still produce an outdated internal notification.

## Operational language and trust

Use staff-facing operational labels, not demo, development, mock, or static
descriptions. Admin and finance can create Snap payment links or reconcile their
status; when `ALLOW_DEMO_PAYMENTS=true`, they can also confirm a simulated
settlement for an invoice without a prior Midtrans attempt. The flag is disabled
by default in Docker and explicitly enabled in the supplied Workers production
configuration; the staging Workers configuration leaves it off.
The ERP checks access, invoice state, and amount, then records the simulation
and queues fulfillment; it does **not** confirm money received or contact
Midtrans. The interface and audit history retain its internal source. Real
gateway verification requires Snap sandbox checkout, the official simulator,
and a server-side Midtrans status check. Keep unavailable supplier integration
and payment provenance clear: removing a label never changes source, status, or
financial records. Technical fixtures retain their identifiers and provenance
in source and documentation; they must not become production credentials or data.

## Evidence on hand

The original `/Users/mac/plan.md` brief and the booking-system backend/frontend
references. Midtrans integration follows https://docs.midtrans.com/.
Actual sandbox observations and sanitized screenshots are recorded in
[Midtrans verification](docs/MIDTRANS-VERIFICATION.md). There are no real supplier
credentials, real customer records, production payment evidence, supplied company
branding, or production deployment evidence.

## Operating context

The internal ERP follows an operational presentation under a short deadline.
Current execution and data remain local; production tone is not a deployment
claim. Production rollout requires the selected supplier's API, public webhook
verification, infrastructure access, backup/recovery preparation, and separate
approval. Repository Harness provides the documentation map and optional tools;
it does not authorize release, deployment, or shared-system changes.
