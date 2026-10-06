// Пользователи. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, boolean, check, jsonb, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { bytea } from "./types.js";
import { tenants } from "./b2b.js";
import { teams } from "./catalog.js";

/** Менеджер */
export const users = pgTable("users", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tenantId: bigint("tenant_id", { mode: "number" }).notNull().references(() => tenants.id),
    nickname: text("nickname").notNull(),
    avatarHue: smallint("avatar_hue"),
    favoriteTeamId: bigint("favorite_team_id", { mode: "number" }).references(() => teams.id),
    locale: text("locale").notNull(),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("users_tenant_id_lower_nickname_uq").on(t.tenantId, sql`lower(${t.nickname})`),
  check("users_role_check", sql`${t.role} in ('user', 'admin')`),
]);

/** Способ входа */
export const authIdentities = pgTable("auth_identities", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
    provider: text("provider").notNull(),
    providerUid: text("provider_uid").notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("auth_identities_provider_provider_uid_uq").on(t.provider, t.providerUid),
  check("auth_identities_provider_check", sql`${t.provider} in ('device', 'telegram', 'email', 'vk')`),
]);

/** Сессия */
export const userSessions = pgTable("user_sessions", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
    tokenHash: bytea("token_hash").unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
});

/** Настройки уведомлений */
export const notificationPrefs = pgTable("notification_prefs", {
    userId: bigint("user_id", { mode: "number" }).primaryKey().references(() => users.id),
    roundOpen: boolean("round_open").notNull(),
    deadlineReminder: boolean("deadline_reminder").notNull(),
    roundResult: boolean("round_result").notNull(),
    replayParsed: boolean("replay_parsed").notNull(),
    channels: jsonb("channels").notNull(),
});
