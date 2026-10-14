# Local internal automation

These two secret-free workflows target the disposable `esim-erp-local` Compose
stack and n8n **2.43.4**. They are not production deployment or credential-management
tools. Email goes only to explicitly synthetic internal `*.demo.invalid`
addresses through Mailpit; never set the recipient from customer data.

## Setup and execution

From the repository root, run the normal local setup/migration/seed steps, start
Compose, and start the API on port 3011. Then:

```sh
bun scripts/import-automation.ts --import-only
docker compose -p esim-erp-local exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id=erp-local-order-events
docker compose -p esim-erp-local exec -T -e N8N_RUNNERS_BROKER_PORT=5680 n8n n8n execute --id=erp-local-finance-position
bun scripts/import-automation.ts
```

The last command publishes both schedules and restarts **only n8n** to load them,
including on a rerun after an interrupted publication/restart.
Order events run every minute; the finance email runs daily at **08:00
Asia/Jakarta**. Both have Manual Trigger and Schedule Trigger; CLI execution must
use an imported workflow ID, not `execute --file`. Inspect captured messages at
<http://localhost:8029> and n8n at <http://localhost:5679>.

Run CLI executions sequentially. The per-command broker port override avoids
colliding with the running n8n server's internal task broker on port 5679; it does
not change the server or publish another host port.

The importer reads the existing private `.amp/in/local-config.json` and
`.amp/in/n8n/credentials.json`, requires private file permissions, and never
overwrites them. Credentials are streamed through Docker stdin into a temporary
container file under `umask 077`, imported into the owner's personal project, and
removed. Existing n8n credentials are privately compared and preserved; conflicting
credentials, ownership, IDs, versions, or local configuration cause an actionable
failure rather than a reset. Identical workflows are not reimported. Do not run
multiple importers concurrently.

On an empty first-run instance, the importer uses n8n's supported
`POST /rest/owner/setup` endpoint to claim a synthetic
`n8n-owner@esim-erp.demo.invalid` owner. Its local-only password is derived privately
from the existing automation secret; it is neither printed nor written to a new
credential file. Later runs authenticate that owner without changing its password.
This is deliberately not an importer for another person's configured n8n instance:
use their UI/personal project to import manually instead of replacing the owner.

Container API requests use `http://host.docker.internal:3011`. The importer checks
authenticated container-to-host access before making changes. If that fails,
check the API binding, Docker host mapping, and matching private configuration;
Wrangler may need `--ip 0.0.0.0`, with access restricted to the local environment.
No host credential permission is weakened to make the read-only `/bootstrap`
mount accessible.

`--import-only` skips publication/restart for initial validation. It does not
deactivate unchanged, already-published workflows, and refuses changes to active
definitions that would leave the running scheduler out of sync.

## Delivery and finance semantics

`order-events.json` polls `GET /automation/events` (oldest 25 unacknowledged
events), splits only the `events` field, and sends one plain-text internal
notification per event. The text explicitly selects event/order/invoice references,
amounts in IDR, and timestamps—never customer contact details or eSIM installation
codes. Only the SMTP success output reaches `POST /automation/events/{id}/ack`.
The ack URL uses `$('Split Events').item.json.id`, not SMTP's output JSON.

Delivery is **at least once, not exactly once**. SMTP failure stops the workflow
and leaves events unacknowledged for the next poll. Since n8n processes this batch
through the email node before the ack node, a partial batch failure can also leave
already-sent notifications pending. A crash, failed ack, or overlapping manual and
scheduled run can therefore send duplicates; use the event ID to identify them.
Do not enable “continue on error” on SMTP or connect an error output to ack.
An empty event batch sends no email and acknowledges nothing.

`finance-position.json` reads `GET /automation/finance-summary` and sends an
**all-time cumulative position**, not daily sales. Labels distinguish paid gross,
outstanding non-paid invoice amounts, recorded supplier-debit spend, realized
margin for paid/fulfillment-ready invoices, and the count of invoices requiring
reconciliation. All monetary fields are whole IDR; the send timestamp is not a
reporting date filter. The workflow is read-only.

Neither workflow creates payments, changes provisioning, contacts customers,
or reveals installation data. The event acknowledgement is the only ERP mutation.
