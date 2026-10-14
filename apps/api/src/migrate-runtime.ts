import { resolve } from "node:path";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { withDatabase } from "./infrastructure/database";

const connection = process.env.DATABASE_URL;
if (!connection) throw new Error("DATABASE_URL is required for migrations");

await withDatabase(connection, (database) =>
  migrate(database, {
    migrationsFolder: resolve(import.meta.dir, "migrations"),
  }),
);

console.info("PostgreSQL migrations applied.");
