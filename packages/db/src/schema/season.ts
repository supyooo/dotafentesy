// Сезон и лиги. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, boolean, check, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { lineups } from "./lineups.js";
import { seasons, tournaments } from "./tournament.js";
import { users } from "./users.js";

/** Лиги (справочник) */
export const leagueTiers = pgTable("league_tiers", {
    id: smallint("id").primaryKey(),
    code: text("code").unique(),
    nameRu: text("name_ru").notNull(),
});

/** Какие лиги активны в сезоне */
export const seasonLadders = pgTable("season_ladders", {
    seasonId: bigint("season_id", { mode: "number" }).references(() => seasons.id),
    tierId: smallint("tier_id").references(() => leagueTiers.id),
    isActive: boolean("is_active").notNull(),
}, (t) => [
  primaryKey({ columns: [t.seasonId, t.tierId] }),
]);

/** Лига менеджера в сезоне */
export const leagueMemberships = pgTable("league_memberships", {
    seasonId: bigint("season_id", { mode: "number" }).references(() => seasons.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    tierId: smallint("tier_id").references(() => leagueTiers.id),
    skipStreak: smallint("skip_streak").notNull(),
    bestTierId: smallint("best_tier_id").references(() => leagueTiers.id),
    calibratedAt: timestamp("calibrated_at", { withTimezone: true }),
}, (t) => [
  primaryKey({ columns: [t.seasonId, t.userId] }),
]);

/** Раунд лиги = турнир */
export const leagueRounds = pgTable("league_rounds", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    seasonId: bigint("season_id", { mode: "number" }).notNull().references(() => seasons.id),
    tournamentId: bigint("tournament_id", { mode: "number" }).unique().references(() => tournaments.id),
    roundNo: smallint("round_no").notNull(),
    status: text("status").notNull(),
    groupsFormedAt: timestamp("groups_formed_at", { withTimezone: true }),
    settledAt: timestamp("settled_at", { withTimezone: true }),
}, (t) => [
  check("league_rounds_status_check", sql`${t.status} in ('upcoming', 'grouped', 'settled')`),
]);

/** Группа раунда */
export const leagueGroups = pgTable("league_groups", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    roundId: bigint("round_id", { mode: "number" }).notNull().references(() => leagueRounds.id),
    tierId: smallint("tier_id").notNull().references(() => leagueTiers.id),
    groupNo: smallint("group_no").notNull(),
    pooledKey: text("pooled_key"),
    zoneUp: smallint("zone_up").notNull(),
    zoneDown: smallint("zone_down").notNull(),
});

/** Менеджер в группе */
export const leagueGroupMembers = pgTable("league_group_members", {
    groupId: bigint("group_id", { mode: "number" }).references(() => leagueGroups.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    roundId: bigint("round_id", { mode: "number" }).notNull().references(() => leagueRounds.id),
    lineupId: bigint("lineup_id", { mode: "number" }).notNull().references(() => lineups.id),
    tierAtStart: smallint("tier_at_start").notNull().references(() => leagueTiers.id),
    place: smallint("place"),
    zone: text("zone"),
    tierAfter: smallint("tier_after").references(() => leagueTiers.id),
}, (t) => [
  primaryKey({ columns: [t.groupId, t.userId] }),
  uniqueIndex("league_group_members_round_id_user_id_uq").on(t.roundId, t.userId),
  check("league_group_members_zone_check", sql`${t.zone} in ('up', 'stay', 'down')`),
]);

/** Очки F1 Титанов за раунд */
export const titanRoundPoints = pgTable("titan_round_points", {
    roundId: bigint("round_id", { mode: "number" }).references(() => leagueRounds.id),
    userId: bigint("user_id", { mode: "number" }).references(() => users.id),
    seasonId: bigint("season_id", { mode: "number" }).notNull().references(() => seasons.id),
    place: smallint("place").notNull(),
    f1Points: smallint("f1_points").notNull(),
}, (t) => [
  primaryKey({ columns: [t.roundId, t.userId] }),
]);

/** Титулы сезона */
export const seasonTitles = pgTable("season_titles", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    seasonId: bigint("season_id", { mode: "number" }).notNull().references(() => seasons.id),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
    title: text("title").notNull(),
    tierId: smallint("tier_id").references(() => leagueTiers.id),
    awardedAt: timestamp("awarded_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("season_titles_title_check", sql`${t.title} in ('best_regular', 'champion', 'best_tier')`),
]);
