import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { sql } from "drizzle-orm";
import pg from "pg";
import * as schema from "./schema/index.js";

export type Db = NodePgDatabase<typeof schema>;
export { schema };
export type Pool = pg.Pool;

export function createDb(url: string): { db: Db; pool: pg.Pool } {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return { db: drizzle(pool, { schema }), pool };
}

/** Для /health: версия сервера и время ответа. */
export async function ping(db: Db): Promise<{ version: string; ms: number }> {
  const t = performance.now();
  const r = await db.execute<{ version: string }>(sql`select current_setting('server_version') as version`);
  return { version: r.rows[0]?.version ?? "?", ms: Math.round(performance.now() - t) };
}
