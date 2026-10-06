// Достижения и уведомления. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, check, index, jsonb, pgTable, primaryKey, smallint, text, timestamp } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { seasons, tournaments } from "./tournament.js";
import { users } from "./users.js";

/** Достижение (справочник) */
export const achievements = pgTable("achievements", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    code: text("code").unique(),
    nameRu: text("name_ru").notNull(),
    category: text("category").notNull(),
    tiers: jsonb("tiers"),
});

/** Полученное достижение */
export const userAchievements = pgTable("user_achievements", {
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    achievementId: bigint("achievement_id", { mode: "number" }).references(() => achievements.id),
    tier: smallint("tier").notNull(),
    earnedAt: timestamp("earned_at", { withTimezone: true }).notNull().defaultNow(),
    context: jsonb("context"),
}, (t) => [
  primaryKey({ columns: [t.userId, t.achievementId] }),
]);

/** Трофей */
export const trophies = pgTable("trophies", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
    kind: text("kind").notNull(),
    tournamentId: bigint("tournament_id", { mode: "number" }).references(() => tournaments.id),
    seasonId: bigint("season_id", { mode: "number" }).references(() => seasons.id),
    label: text("label").notNull(),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("trophies_kind_check", sql`${t.kind} in ('promotion', 'group_first', 'best_stage', 'pickem_medal')`),
]);

/** Уведомление */
export const notifications = pgTable("notifications", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
    kind: text("kind").notNull(),
    payload: jsonb("payload").notNull(),
    channel: text("channel").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    readAt: timestamp("read_at", { withTimezone: true }),
}, (t) => [
  index("notifications_user_id_created_at_idx").on(t.userId, t.createdAt.desc()),
  check("notifications_channel_check", sql`${t.channel} in ('telegram', 'email', 'push', 'inapp')`),
]);
