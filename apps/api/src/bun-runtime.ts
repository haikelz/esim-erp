import { type Bindings, readConfig } from "./config";
import { runFulfillment } from "./fulfillment-worker";
import { createApp } from "./http/app";
import { withDatabase } from "./infrastructure/database";
import { DomainError } from "./modules/errors";

const bindings: Bindings = {
  APP_ENV: process.env.APP_ENV ?? "",
  WEB_ORIGIN: process.env.WEB_ORIGIN ?? "",
  ERP_PROXY_SECRET: process.env.ERP_PROXY_SECRET ?? "",
  ESIM_ENCRYPTION_KEY: process.env.ESIM_ENCRYPTION_KEY ?? "",
  AUTOMATION_TOKEN: process.env.AUTOMATION_TOKEN ?? "",
  ALLOW_DEMO_PAYMENTS: process.env.ALLOW_DEMO_PAYMENTS ?? "false",
  MIDTRANS_SERVER_KEY: process.env.MIDTRANS_SERVER_KEY,
  DATABASE_URL: process.env.DATABASE_URL,
  RUNTIME: "bun",
};
const config = readConfig(bindings);
const port = Number(process.env.PORT ?? "3011");
if (!Number.isInteger(port) || port < 1024 || port > 65535)
  throw new Error("PORT must be an integer between 1024 and 65535");

const isWorker = process.argv.includes("--worker");
let isStopping = false;
let currentRun: Promise<void> | undefined;

function processQueue() {
  if (isStopping || currentRun) return;

  currentRun = withDatabase(config.connectionString, (database) =>
    runFulfillment(database, config.ESIM_ENCRYPTION_KEY),
  )
    .then((processed) => {
      console.info(
        JSON.stringify({ event: "fulfillment.processed", processed }),
      );
    })
    .catch((error: unknown) => {
      console.error(
        JSON.stringify({
          event: "fulfillment.run_failed",
          code: error instanceof DomainError ? error.code : "unexpected_error",
        }),
      );
    })
    .finally(() => {
      currentRun = undefined;
    });
}

const app = createApp();
const server = isWorker
  ? undefined
  : Bun.serve({
      hostname: "0.0.0.0",
      port,
      fetch: (request) => app.fetch(request, bindings),
    });
const timer = isWorker ? setInterval(processQueue, 60000) : undefined;
if (isWorker) processQueue();

async function shutdown() {
  if (isStopping) return;

  isStopping = true;
  if (timer) clearInterval(timer);
  // Unfinished claims expire to unknown rather than repurchasing after a kill.
  const deadline = setTimeout(() => process.exit(1), 25000);
  deadline.unref();

  try {
    await Promise.all([server?.stop(), currentRun]);
    clearTimeout(deadline);
    process.exit(0);
  } catch {
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown());
process.once("SIGINT", () => void shutdown());
console.info(
  JSON.stringify({
    event: "runtime.started",
    role: isWorker ? "worker" : "api",
    port: isWorker ? null : port,
  }),
);
