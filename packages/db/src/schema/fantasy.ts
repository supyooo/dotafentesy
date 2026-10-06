// Фэнтези: очки и цены. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, boolean, check, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { players, teams } from "./catalog.js";
import { maps, stages, tournaments } from "./tournament.js";

/** Версия правил очков */
export const scoringRulesets = pgTable("scoring_rulesets", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    version: text("version").unique(),
    rules: jsonb("rules").notNull(),
    roleCoefs: jsonb("role_coefs").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    notes: text("notes"),
});

/** Игрок в пуле турнира */
export const tournamentPlayers = pgTable("tournament_players", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tournamentId: bigint("tournament_id", { mode: "number" }).notNull().references(() => tournaments.id),
    playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
    teamId: bigint("team_id", { mode: "number" }).notNull().references(() => teams.id),
    position: smallint("position").notNull(),
    isActive: boolean("is_active").notNull(),
    startRating: numeric("start_rating", { precision: 5, scale: 2 }),
    startPrice: numeric("start_price", { precision: 4, scale: 1 }).notNull(),
}, (t) => [
  uniqueIndex("tournament_players_tournament_id_player_id_uq").on(t.tournamentId, t.playerId),
  check("tournament_players_position_check", sql`${t.position} between 1 and 5`),
]);

/** Цена на начало стадии */
export const playerPrices = pgTable("player_prices", {
    tournamentPlayerId: bigint("tournament_player_id", { mode: "number" }).references(() => tournamentPlayers.id),
    stageId: bigint("stage_id", { mode: "number" }).references(() => stages.id),
    price: numeric("price", { precision: 4, scale: 1 }).notNull(),
    change: numeric("change", { precision: 3, scale: 1 }).notNull(),
    reason: text("reason"),
}, (t) => [
  primaryKey({ columns: [t.tournamentPlayerId, t.stageId] }),
]);

/** Очки игрока за карту */
export const playerMapPoints = pgTable("player_map_points", {
    mapId: bigint("map_id", { mode: "number" }).references(() => maps.id),
    tournamentPlayerId: bigint("tournament_player_id", { mode: "number" }).references(() => tournamentPlayers.id),
    rulesetId: bigint("ruleset_id", { mode: "number" }).references(() => scoringRulesets.id),
    rawPoints: numeric("raw_points", { precision: 7, scale: 2 }).notNull(),
    points: numeric("points", { precision: 7, scale: 2 }).notNull(),
    breakdown: jsonb("breakdown").notNull(),
    dataTier: text("data_tier").notNull(),
    computedAt: timestamp("computed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.mapId, t.tournamentPlayerId, t.rulesetId] }),
  check("player_map_points_data_tier_check", sql`${t.dataTier} in ('live', 'basic', 'parsed')`),
]);

/** Очки игрока за стадию (сумма) */
export const playerStagePoints = pgTable("player_stage_points", {
    tournamentPlayerId: bigint("tournament_player_id", { mode: "number" }).references(() => tournamentPlayers.id),
    stageId: bigint("stage_id", { mode: "number" }).references(() => stages.id),
    points: numeric("points", { precision: 7, scale: 2 }).notNull(),
    mapsPlayed: smallint("maps_played").notNull(),
    ownershipPct: numeric("ownership_pct", { precision: 5, scale: 2 }),
}, (t) => [
  primaryKey({ columns: [t.tournamentPlayerId, t.stageId] }),
]);
