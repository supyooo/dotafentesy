// Каталог. Сгенерировано packages/db/scripts/gen_drizzle.py из docs/db/schema.py, дальше правится руками.
import { bigint, char, check, date, index, pgTable, smallint, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/** Команда */
export const teams = pgTable("teams", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    name: text("name").notNull(),
    tag: text("tag").notNull(),
    countryCode: char("country_code", { length: 2 }),
    logoUrl: text("logo_url"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Игрок про-сцены */
export const players = pgTable("players", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    nickname: text("nickname").notNull(),
    realName: text("real_name"),
    countryCode: char("country_code", { length: 2 }),
    steamAccountId: bigint("steam_account_id", { mode: "number" }).unique(),
    photoUrl: text("photo_url"),
    photoLicense: text("photo_license"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Кто за какую команду играл и когда */
export const teamRosters = pgTable("team_rosters", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    teamId: bigint("team_id", { mode: "number" }).notNull().references(() => teams.id),
    playerId: bigint("player_id", { mode: "number" }).notNull().references(() => players.id),
    position: smallint("position"),
    role: text("role").notNull(),
    validFrom: date("valid_from", { mode: "string" }).notNull(),
    validTo: date("valid_to", { mode: "string" }),
}, (t) => [
  index("team_rosters_player_id_valid_to_idx").on(t.playerId, t.validTo),
  check("team_rosters_position_check", sql`${t.position} between 1 and 5`),
  check("team_rosters_role_check", sql`${t.role} in ('player', 'standin', 'coach')`),
]);

/** Герои Dota */
export const heroes = pgTable("heroes", {
    id: smallint("id").primaryKey(),
    code: text("code").notNull(),
    nameRu: text("name_ru").notNull(),
    iconUrl: text("icon_url"),
});

/** Сопоставление с внешними источниками */
export const externalRefs = pgTable("external_refs", {
    id: bigint("id", { mode: "number" }).primaryKey().generatedByDefaultAsIdentity(),
    entityType: text("entity_type").notNull(),
    entityId: bigint("entity_id", { mode: "number" }).notNull(),
    provider: text("provider").notNull(),
    externalId: text("external_id").notNull(),
    url: text("url"),
}, (t) => [
  uniqueIndex("external_refs_provider_entity_type_external_id_uq").on(t.provider, t.entityType, t.externalId),
  index("external_refs_entity_type_entity_id_idx").on(t.entityType, t.entityId),
  check("external_refs_entity_type_check", sql`${t.entityType} in ('team', 'player', 'tournament', 'series', 'map', 'league')`),
  check("external_refs_provider_check", sql`${t.provider} in ('liquipedia', 'opendota', 'stratz', 'steam', 'pandascore', 'grid')`),
]);
