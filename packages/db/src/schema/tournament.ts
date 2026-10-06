// Турнир и формат. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, boolean, check, date, index, integer, jsonb, numeric, pgTable, primaryKey, smallint, text, timestamp, uniqueIndex, type AnyPgColumn } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { heroes, players, teams } from "./catalog.js";
import { scoringRulesets } from "./fantasy.js";

/** Организатор */
export const organizers = pgTable("organizers", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    slug: text("slug").unique(),
});

/** Сезон (от TI до TI) */
export const seasons = pgTable("seasons", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    startsOn: date("starts_on", { mode: "string" }).notNull(),
    endsOn: date("ends_on", { mode: "string" }),
    status: text("status").notNull(),
    config: jsonb("config").notNull(),
}, (t) => [
  check("seasons_status_check", sql`${t.status} in ('planned', 'active', 'finished')`),
]);

/** Турнир */
export const tournaments = pgTable("tournaments", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    seasonId: bigint("season_id", { mode: "number" }).references(() => seasons.id),
    organizerId: bigint("organizer_id", { mode: "number" }).references(() => organizers.id),
    slug: text("slug").unique(),
    name: text("name").notNull(),
    tier: smallint("tier").notNull(),
    prizePoolUsd: integer("prize_pool_usd"),
    location: text("location"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull(),
    isLeagueRound: boolean("is_league_round").notNull(),
    skin: text("skin"),
    scoringRulesetId: bigint("scoring_ruleset_id", { mode: "number" }).notNull().references(() => scoringRulesets.id),
    config: jsonb("config").notNull(),
}, (t) => [
  check("tournaments_status_check", sql`${t.status} in ('announced', 'open', 'live', 'finished', 'cancelled')`),
]);

/** Стадия (окно → дедлайн → игры) */
export const stages = pgTable("stages", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tournamentId: bigint("tournament_id", { mode: "number" }).notNull().references(() => tournaments.id),
    idx: smallint("idx").notNull(),
    name: text("name").notNull(),
    format: text("format").notNull(),
    deadlineAt: timestamp("deadline_at", { withTimezone: true }),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    endsAt: timestamp("ends_at", { withTimezone: true }),
    status: text("status").notNull(),
}, (t) => [
  uniqueIndex("stages_tournament_id_idx_uq").on(t.tournamentId, t.idx),
  check("stages_format_check", sql`${t.format} in ('gsl', 'swiss', 'round_robin', 'double_elim', 'single_elim')`),
  check("stages_status_check", sql`${t.status} in ('upcoming', 'open', 'locked', 'settling', 'settled')`),
]);

/** Группа внутри стадии */
export const stageGroups = pgTable("stage_groups", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    stageId: bigint("stage_id", { mode: "number" }).notNull().references(() => stages.id),
    label: text("label").notNull(),
});

/** Участник турнира */
export const tournamentTeams = pgTable("tournament_teams", {
    tournamentId: bigint("tournament_id", { mode: "number" }).references(() => tournaments.id),
    teamId: bigint("team_id", { mode: "number" }).references(() => teams.id),
    seed: smallint("seed"),
    groupId: bigint("group_id", { mode: "number" }).references(() => stageGroups.id),
    status: text("status").notNull(),
    eliminatedAfterStageId: bigint("eliminated_after_stage_id", { mode: "number" }).references(() => stages.id),
    finalPlace: smallint("final_place"),
}, (t) => [
  primaryKey({ columns: [t.tournamentId, t.teamId] }),
  check("tournament_teams_status_check", sql`${t.status} in ('active', 'eliminated')`),
]);

/** Серия (узел сетки) */
export const series = pgTable("series", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tournamentId: bigint("tournament_id", { mode: "number" }).notNull().references(() => tournaments.id),
    stageId: bigint("stage_id", { mode: "number" }).notNull().references(() => stages.id),
    groupId: bigint("group_id", { mode: "number" }).references(() => stageGroups.id),
    roundLabel: text("round_label").notNull(),
    bracketSide: text("bracket_side"),
    roundNo: smallint("round_no"),
    slot: smallint("slot"),
    bestOf: smallint("best_of").notNull(),
    teamAId: bigint("team_a_id", { mode: "number" }).references(() => teams.id),
    teamBId: bigint("team_b_id", { mode: "number" }).references(() => teams.id),
    scoreA: smallint("score_a").notNull().default(0),
    scoreB: smallint("score_b").notNull().default(0),
    winnerTeamId: bigint("winner_team_id", { mode: "number" }).references(() => teams.id),
    status: text("status").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    nextWinSeriesId: bigint("next_win_series_id", { mode: "number" }).references((): AnyPgColumn => series.id),
    nextLoseSeriesId: bigint("next_lose_series_id", { mode: "number" }).references((): AnyPgColumn => series.id),
}, (t) => [
  index("series_tournament_id_stage_id_idx").on(t.tournamentId, t.stageId),
  index("series_status_idx").on(t.status).where(sql`${t.status} = 'live'`),
  check("series_bracket_side_check", sql`${t.bracketSide} in ('group', 'upper', 'lower', 'final')`),
  check("series_best_of_check", sql`${t.bestOf} in (1, 2, 3, 5)`),
  check("series_status_check", sql`${t.status} in ('scheduled', 'live', 'finished', 'forfeit', 'cancelled')`),
]);

/** Трансляции */
export const streams = pgTable("streams", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    tournamentId: bigint("tournament_id", { mode: "number" }).notNull().references(() => tournaments.id),
    seriesId: bigint("series_id", { mode: "number" }).references(() => series.id),
    platform: text("platform").notNull(),
    url: text("url").notNull(),
    language: text("language"),
}, (t) => [
  check("streams_platform_check", sql`${t.platform} in ('twitch', 'youtube', 'vk', 'kick')`),
]);

/** Карта (одна игра серии) */
export const maps = pgTable("maps", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    seriesId: bigint("series_id", { mode: "number" }).notNull().references(() => series.id),
    mapNo: smallint("map_no").notNull(),
    dotaMatchId: bigint("dota_match_id", { mode: "number" }).unique(),
    radiantTeamId: bigint("radiant_team_id", { mode: "number" }).references(() => teams.id),
    direTeamId: bigint("dire_team_id", { mode: "number" }).references(() => teams.id),
    winnerTeamId: bigint("winner_team_id", { mode: "number" }).references(() => teams.id),
    durationS: integer("duration_s"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    status: text("status").notNull(),
    dataTier: text("data_tier").notNull(),
    parsedAt: timestamp("parsed_at", { withTimezone: true }),
}, (t) => [
  uniqueIndex("maps_series_id_map_no_uq").on(t.seriesId, t.mapNo),
  check("maps_map_no_check", sql`${t.mapNo} between 1 and 5`),
  check("maps_status_check", sql`${t.status} in ('live', 'finished', 'void')`),
  check("maps_data_tier_check", sql`${t.dataTier} in ('live', 'basic', 'parsed')`),
]);

/** Пики и баны карты */
export const mapDraft = pgTable("map_draft", {
    mapId: bigint("map_id", { mode: "number" }).references(() => maps.id),
    orderNo: smallint("order_no"),
    teamId: bigint("team_id", { mode: "number" }).notNull().references(() => teams.id),
    heroId: smallint("hero_id").notNull().references(() => heroes.id),
    isPick: boolean("is_pick").notNull(),
}, (t) => [
  primaryKey({ columns: [t.mapId, t.orderNo] }),
]);

/** Статистика игрока на карте (сырая, без очков) */
export const playerMapStats = pgTable("player_map_stats", {
    mapId: bigint("map_id", { mode: "number" }).references(() => maps.id),
    playerId: bigint("player_id", { mode: "number" }).references(() => players.id),
    teamId: bigint("team_id", { mode: "number" }).notNull().references(() => teams.id),
    heroId: smallint("hero_id").references(() => heroes.id),
    isRadiant: boolean("is_radiant").notNull(),
    won: boolean("won"),
    kills: smallint("kills").notNull(),
    deaths: smallint("deaths").notNull(),
    assists: smallint("assists").notNull(),
    lastHits: smallint("last_hits").notNull(),
    denies: smallint("denies").notNull(),
    gpm: smallint("gpm"),
    xpm: smallint("xpm"),
    netWorth: integer("net_worth"),
    heroDamage: integer("hero_damage"),
    buildingDamage: integer("building_damage"),
    heroHealing: integer("hero_healing"),
    obsPlaced: smallint("obs_placed"),
    obsKilled: smallint("obs_killed"),
    stunS: numeric("stun_s", { precision: 6, scale: 1 }),
    campsStacked: smallint("camps_stacked"),
    dataTier: text("data_tier").notNull(),
    extra: jsonb("extra"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  primaryKey({ columns: [t.mapId, t.playerId] }),
  index("player_map_stats_player_id_idx").on(t.playerId),
  check("player_map_stats_data_tier_check", sql`${t.dataTier} in ('live', 'basic', 'parsed')`),
]);
