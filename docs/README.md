# Documentation Map

Start with the requested outcome and the smallest authoritative ERP surface.

## Product and operation

- [Product contract](../PRODUCT.md): internal travel eSIM ERP, staff roles,
  scope, payment and fulfillment boundaries.
- [Application README](../README.md): setup, configuration, running services,
  architecture, validation, deployment prerequisites, and recovery.
- [Web design](../apps/web/DESIGN.md): ReUI conventions, operational copy,
  accessibility, responsive states, and offline behavior.
- [Midtrans verification](MIDTRANS-VERIFICATION.md): actual sandbox payment
  evidence, screenshots, reproduction procedure, and unverified boundaries.

## Code and commands

- [Root commands](../package.json), [Bun lockfile](../bun.lock), and
  [tool versions](../.prototools) own the workspace tooling.
- [Shared contracts](../packages/contracts/src/index.ts) own HTTP schemas and
  public payment, order, catalog, and installation types.
- [Next.js routes](../apps/web/src/app/),
  [feature components](../apps/web/src/components/operations/),
  [client services](../apps/web/src/services/), and
  [server proxy](../apps/web/src/server/) own the staff application.
- [PWA manifest](../apps/web/src/app/manifest.ts),
  [offline page](../apps/web/src/app/~offline/page.tsx), and
  [build configuration](../apps/web/next.config.ts) own installation and caching.
- [Hono HTTP boundary](../apps/api/src/http/app.ts),
  [domain modules](../apps/api/src/modules/),
  [infrastructure adapters](../apps/api/src/infrastructure/), and
  [Wrangler configuration](../apps/api/wrangler.jsonc) own the API runtime.
- [Database schema](../apps/api/src/infrastructure/schema.ts),
  [migrations](../apps/api/migrations/), and
  [guarded local database scripts](../apps/api/scripts/) own PostgreSQL state.
- [Image workflow](../.github/workflows/images.yml) owns branch-based GHCR
  publication; [API image](../apps/api/Dockerfile) includes a one-shot migration
  runner and separate HTTP/queue-worker roles, and
  [web image](../apps/web/Dockerfile) packages Next.js standalone.
- Local `infra:up` currently lacks its root `compose.yaml`; the
  [application README](../README.md#instalasi-dan-menjalankan-aplikasi) records
  that prerequisite. [Automation instructions](../automation/n8n/README.md)
  own local workflows.
- [VPS Compose runbook](runbooks/vps-compose.md) covers separate
  [web](../apps/web/docker-compose.yaml), [API + worker](../apps/api/compose.yaml), and
  [PostgreSQL](../database/docker-compose.postgres.yaml) stacks, including
  the optional [Workers DB access](../database/docker-compose.worker-access.yaml).
- [API integration tests](../apps/api/src/http/app.test.ts),
  [Midtrans adapter tests](../apps/api/src/infrastructure/midtrans.test.ts), and
  [browser tests](../tests/e2e/erp.spec.ts) own executable proof. Local tests do
  not establish production deployment or real supplier connectivity.

## Repository guidance

- [Agent entrypoint](../AGENTS.md) preserves the existing engineering profiles
  and adds the upstream Harness block.
- [Workflow](WORKFLOW.md) covers understanding, authority, missing capabilities,
  and evidence; the ERP retains its own task workflow.
- [Harness maintenance](HARNESS.md) owns installation provenance, checks,
  recovery, and the pinned-source update boundary.
- [Product index](product/README.md), [decision records](decisions/README.md),
  and [plan index](plans/README.md) point to consumer-owned knowledge.
- [`patterns/encoding-invariants.md`](patterns/encoding-invariants.md): turn
  accepted architecture, reliability, security, and quality rules into native
  mechanical validation.
- [Templates](templates/): optional decisions, plans, application runbooks,
  and Harness-improvement structure; none replaces executed validation.

Private configuration, local planning notes, and review captures stay outside
Git. A checked-in image workflow does not establish that it has run, that images
have been published, or that the supplied live domains serve this revision.
