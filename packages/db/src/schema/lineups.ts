// Составы и таблица. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, boolean, check, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { tournamentPlayers } from "./fantasy.js";
import { stages, tournaments } from "./tournament.js";
import { users } from "./users.js";

/** Состав менеджера на турнир */
export const lineups = pgTable("lineups", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    userId: bigint("user_id", { mode: "number" }).notNull().references(() => users.id),
    tournamentId: bigint("tournament_id", { mode: "number" }).notNull().references(() => tournaments.id),
    bank: numeric("bank", { precision: 4, scale: 1 }).notNull(),
    freeTransfers: smallint("free_transfers").notNull(),
    captainPosition: smallint("captain_position"),
    chipPending: text("chip_pending").notNull(),
    tripleUsedStageId: bigint("triple_used_stage_id", { mode: "number" }).references(() => stages.id),
    wildcardUsedStageId: bigint("wildcard_used_stage_id", { mode: "number" }).references(() => stages.id),
    firstCompletedAt: timestamp("first_completed_at", { withTimezone: true }),
    totalPoints: numeric("total_points", { precision: 8, scale: 2 }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("lineups_user_id_tournament_id_uq").on(t.userId, t.tournamentId),
  check("lineups_free_transfers_check", sql`${t.freeTransfers} between 0 and 2`),
  check("lineups_captain_position_check", sql`${t.captainPosition} between 1 and 5`),
  check("lineups_chip_pending_check", sql`${t.chipPending} in ('none', 'triple', 'wildcard')`),
]);

/** Текущий черновик (то, что видно в окне) */
export const lineupSlots = pgTable("lineup_slots", {
    lineupId: bigint("lineup_id", { mode: "number" }).references(() => lineups.id),
    position: smallint("position"),
    tournamentPlayerId: bigint("tournament_player_id", { mode: "number" }).notNull().references(() => tournamentPlayers.id),
    boughtPrice: numeric("bought_price", { precision: 4, scale: 1 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.lineupId, t.position] }),
  check("lineup_slots_position_check", sql`${t.position} between 1 and 5`),
]);

/** Снимок состава в дедлайн стадии */
export const lineupLocks = pgTable("lineup_locks", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    lineupId: bigint("lineup_id", { mode: "number" }).notNull().references(() => lineups.id),
    stageId: bigint("stage_id", { mode: "number" }).notNull().references(() => stages.id),
    captainTpId: bigint("captain_tp_id", { mode: "number" }).notNull().references(() => tournamentPlayers.id),
    chip: text("chip").notNull(),
    freeUsed: smallint("free_used").notNull(),
    paidTransfers: smallint("paid_transfers").notNull(),
    penalty: numeric("penalty", { precision: 5, scale: 1 }).notNull(),
    lockedAt: timestamp("locked_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("lineup_locks_lineup_id_stage_id_uq").on(t.lineupId, t.stageId),
  check("lineup_locks_chip_check", sql`${t.chip} in ('none', 'triple', 'wildcard')`),
]);

/** Игроки снимка */
export const lineupLockSlots = pgTable("lineup_lock_slots", {
    lockId: bigint("lock_id", { mode: "number" }).references(() => lineupLocks.id),
    position: smallint("position"),
    tournamentPlayerId: bigint("tournament_player_id", { mode: "number" }).notNull().references(() => tournamentPlayers.id),
    priceAtLock: numeric("price_at_lock", { precision: 4, scale: 1 }).notNull(),
}, (t) => [
  primaryKey({ columns: [t.lockId, t.position] }),
  index("lineup_lock_slots_tournament_player_id_idx").on(t.tournamentPlayerId),
]);

/** Трансферы окна (фиксируются в дедлайн) */
export const transfers = pgTable("transfers", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    lineupId: bigint("lineup_id", { mode: "number" }).notNull().references(() => lineups.id),
    stageId: bigint("stage_id", { mode: "number" }).notNull().references(() => stages.id),
    position: smallint("position").notNull(),
    outTpId: bigint("out_tp_id", { mode: "number" }).notNull().references(() => tournamentPlayers.id),
    inTpId: bigint("in_tp_id", { mode: "number" }).notNull().references(() => tournamentPlayers.id),
    outPrice: numeric("out_price", { precision: 4, scale: 1 }).notNull(),
    inPrice: numeric("in_price", { precision: 4, scale: 1 }).notNull(),
    kind: text("kind").notNull(),
}, (t) => [
  check("transfers_kind_check", sql`${t.kind} in ('free', 'paid', 'eliminated', 'guaranteed', 'wildcard')`),
]);

/** Очки состава за стадию */
export const lineupStageScores = pgTable("lineup_stage_scores", {
    lineupId: bigint("lineup_id", { mode: "number" }).references(() => lineups.id),
    stageId: bigint("stage_id", { mode: "number" }).references(() => stages.id),
    points: numeric("points", { precision: 8, scale: 2 }).notNull(),
    dataTier: text("data_tier").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.lineupId, t.stageId] }),
  check("lineup_stage_scores_data_tier_check", sql`${t.dataTier} in ('live', 'basic', 'parsed')`),
]);

/** Таблица турнира (материализована) */
export const tournamentStandings = pgTable("tournament_standings", {
    tournamentId: bigint("tournament_id", { mode: "number" }).references(() => tournaments.id),
    lineupId: bigint("lineup_id", { mode: "number" }).references(() => lineups.id),
    totalPoints: numeric("total_points", { precision: 8, scale: 2 }).notNull(),
    rank: integer("rank").notNull(),
    prevRank: integer("prev_rank"),
    tiebreak: jsonb("tiebreak").notNull(),
    isFinal: boolean("is_final").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.tournamentId, t.lineupId] }),
  index("tournament_standings_tournament_id_rank_idx").on(t.tournamentId, t.rank),
]);
