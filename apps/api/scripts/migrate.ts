import { migrate } from "drizzle-orm/node-postgres/migrator";
import { resolve } from "node:path";
import { withDatabase } from "../src/infrastructure/database";

const connection = process.env.DATABASE_URL as string;
await withDatabase(connection, (database) =>
  migrate(database, {
    migrationsFolder: resolve(import.meta.dir, "../migrations"),
  }),
);

console.info("PostgreSQL migrations applied.");
