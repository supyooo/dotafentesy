import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";

config({ path: "../../.env" });

export default defineConfig({
  dialect: "postgresql",
  // без index.ts (тянет schema-manual) и types.ts
  schema: ["catalog", "tournament", "ingest", "fantasy", "users", "lineups", "pickem", "season", "engagement", "b2b"].map((f) => `./src/schema/${f}.ts`),
  out: "./migrations",
  dbCredentials: { url: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/dota_fantasy" },
  strict: true,
});
