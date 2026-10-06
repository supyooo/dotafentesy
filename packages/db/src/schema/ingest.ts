// Сбор данных. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, check, integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./users.js";

/** Журнал запусков сборщиков */
export const ingestRuns = pgTable("ingest_runs", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    job: text("job").notNull(),
    provider: text("provider").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    status: text("status").notNull(),
    itemsSeen: integer("items_seen"),
    itemsChanged: integer("items_changed"),
    error: text("error"),
}, (t) => [
  check("ingest_runs_status_check", sql`${t.status} in ('ok', 'partial', 'failed')`),
]);

/** Ручные правки данных */
export const dataOverrides = pgTable("data_overrides", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    field: text("field").notNull(),
    value: jsonb("value").notNull(),
    reason: text("reason").notNull(),
    createdBy: bigint("created_by", { mode: "number" }).notNull().references(() => users.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
