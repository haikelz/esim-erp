import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

export function createDatabase(client: pg.Client) {
  return drizzle({ client, schema });
}

export type Database = ReturnType<typeof createDatabase>;
export type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];

export async function withDatabase<Result>(
  connectionString: string,
  work: (database: Database) => Promise<Result>,
): Promise<Result> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: 5000,
    query_timeout: 10000,
    statement_timeout: 10000,
  });

  await client.connect();
  try {
    return await work(createDatabase(client));
  } finally {
    await client.end();
  }
}
