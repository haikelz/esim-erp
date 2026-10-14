import { type Bindings, readConfig } from "./config";
import { runFulfillment } from "./fulfillment-worker";
import { createApp } from "./http/app";
import { withDatabase } from "./infrastructure/database";

const app = createApp();

export default {
  fetch: app.fetch,
  async scheduled(_controller: ScheduledController, bindings: Bindings) {
    const config = readConfig(bindings);
    await withDatabase(config.connectionString, (database) =>
      runFulfillment(database, config.ESIM_ENCRYPTION_KEY),
    );
  },
} satisfies ExportedHandler<Bindings>;
