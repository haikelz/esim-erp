# ERP eSIM internal

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Next.js, ReUI, Framer Motion, Hono on Cloudflare Workers, PostgreSQL on a VPS,
Midtrans sandbox, n8n, and Moonrepo. The user selected this stack in the brief.
Vercel is the intended frontend host. No deployment is authorized yet.

## Users and purpose

Internal staff of a telecommunications company reselling travel eSIM data
packages. Staff maintain packages, record customer orders, collect payments,
issue eSIM profiles, and reconcile supplier costs. Customers do not log in to
the ERP; they can pay through a Midtrans-hosted link shared by staff.

## Capabilities and constraints

- Products & Supplier: package coverage, quota, validity, supplier cost, price.
- Sales & Fulfillment: staff-entered orders, customers, provisioning, installation
  information, and recoverable provisioning failures.
- Billing & Finance: one invoice per order, payment links, verified payment state,
  supplier spend, and operational margin before fees and taxes.
- n8n handles internal notifications and reports. It does not decide whether an
  invoice is paid or whether to purchase an eSIM.
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
provisioning, and finance handles payment reconciliation.

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

## Operational language and trust

Use staff-facing operational labels, not demo, development, mock, or static
descriptions. The interface offers payment links and reconciliation, not local
payment simulation or supplier scenario controls. Keep unavailable integrations
and payment provenance clear: fixture payments remain unverified by Midtrans,
and removing a label never changes their source, status, or financial record.
Technical fixtures and local-only guards retain their identifiers and provenance
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
