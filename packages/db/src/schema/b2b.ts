// B2B и интеграции наружу. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, boolean, check, integer, jsonb, pgTable, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bytea } from "./types.js";

/** Тенант (бренд) */
export const tenants = pgTable("tenants", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    slug: text("slug").unique(),
    name: text("name").notNull(),
    branding: jsonb("branding"),
    isDefault: boolean("is_default").notNull(),
});

/** Ключ API партнёра */
export const apiClients = pgTable("api_clients", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id),
    name: text("name").notNull(),
    keyHash: bytea("key_hash").unique(),
    scopes: text("scopes").array().notNull(),
    rateLimitPerMin: integer("rate_limit_per_min").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
});

/** Подписка на события */
export const webhookSubscriptions = pgTable("webhook_subscriptions", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    apiClientId: bigint("api_client_id", { mode: "number" }).notNull().references(() => apiClients.id),
    url: text("url").notNull(),
    events: text("events").array().notNull(),
    secretHash: bytea("secret_hash").notNull(),
    isActive: boolean("is_active").notNull(),
});

/** Доставка вебхука */
export const webhookDeliveries = pgTable("webhook_deliveries", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    subscriptionId: bigint("subscription_id", { mode: "number" }).notNull().references(() => webhookSubscriptions.id),
    event: text("event").notNull(),
    payload: jsonb("payload").notNull(),
    status: text("status").notNull(),
    attempts: smallint("attempts").notNull(),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
}, (t) => [
  check("webhook_deliveries_status_check", sql`${t.status} in ('pending', 'delivered', 'failed')`),
]);
