// Накатить миграции: pnpm --filter @df/db migrate (через drizzle-kit) или этот скрипт из кода/CI.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { createDb } from "./index.js";

const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/dota_fantasy");
await migrate(db, { migrationsFolder: fileURLToPath(new URL("../migrations", import.meta.url)) });
await pool.end();
console.log("миграции применены");
