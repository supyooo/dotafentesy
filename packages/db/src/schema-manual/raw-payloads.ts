// raw_payloads партиционирована по месяцам (docs/09) — Drizzle этого не умеет, таблица создаётся ручной миграцией
// (migrations/*_raw_payloads_partitioned.sql). Здесь только описание для запросов; drizzle-kit этот файл не видит.
import { bigint, smallint, text, timestamp, jsonb, pgTable, primaryKey } from "drizzle-orm/pg-core";
import { bytea } from "../schema/types.js";

/** Сырой ответ внешнего API */
export const rawPayloads = pgTable("raw_payloads", {
  id: bigint("id", { mode: "number" }).generatedByDefaultAsIdentity(),
  provider: text("provider").notNull(),
  resource: text("resource").notNull(),
  externalId: text("external_id"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  httpStatus: smallint("http_status"),
  payload: jsonb("payload").notNull(),
  payloadHash: bytea("payload_hash").notNull(),
}, (t) => [primaryKey({ columns: [t.id, t.fetchedAt] })]);
