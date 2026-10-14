import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { withDatabase } from "../src/infrastructure/database";
import { localDatabaseUrl } from "./local-database";

const connection = localDatabaseUrl(process.env.DATABASE_URL, "esim_erp");
await withDatabase(connection, (database) =>
  migrate(database, {
    migrationsFolder: resolve(import.meta.dir, "../migrations"),
  }),
);

console.info("Local PostgreSQL migrations applied.");
