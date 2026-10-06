// Сиды (B1): справочники + каталог и пулы Slam VIII / Slam IX из prototype/data. Идемпотентно: повторный запуск обновляет.
//   pnpm --filter @df/db seed
// Временные данные помечены в tournaments.config.provisional: состав Slam IX не объявлен (кроме NAVI),
// рейтинги и стартовые цены — оценка прототипа (strength_tmp + rating_bonus_tmp), не статистика.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { PRICE_DEFAULT, RULESET_B, RULESET_SPEC, startPrice, type ScoringRuleset } from "@df/domain";
import { createDb, type Db } from "./index.js";
import * as s from "./schema/index.js";

const DATA = fileURLToPath(new URL("../../../prototype/data/", import.meta.url));
const load = <T>(f: string): T => JSON.parse(readFileSync(DATA + f, "utf8"));

interface PTeam { id: string; name: string; tag: string; steam_team_id?: number; logo?: string }
interface PPlayer { id: string; nick: string; account_id?: number; photo?: string; rating_bonus_tmp?: number }
interface PRoster { id: string; source: string; groups: Record<string, string[]>;
  teams: Array<{ team: string; status: string; strength_tmp: number; players: Record<string, string> }> }

const POS: Record<string, 1 | 2 | 3 | 4 | 5> = { carry: 1, mid: 2, off: 3, soft: 4, hard: 5 };
const TIERS = [["herald", "Рекрут"], ["guardian", "Страж"], ["crusader", "Рыцарь"], ["archon", "Герой"],
  ["legend", "Легенда"], ["ancient", "Властелин"], ["divine", "Божество"], ["immortal", "Титан"]] as const;

/** Конфиг Классики — числа 02 (всё калибруется, в коде правил чисел нет). */
const CLASSIC_CONFIG = {
  budget: 48, max_per_team: 2, max_per_team_when_two_left: 3,
  captain_mult: 2, triple_captain_mult: 3, chips: ["triple", "wildcard"],
  free_transfers_per_window: 1, free_transfers_max: 2, paid_transfer_penalty: 4,
  price: PRICE_DEFAULT,
  pickem: { medals: { bronze: 0.55, silver: 0.65, gold: 0.72, platinum: 0.8 } },
};
const SEASON_CONFIG = {
  group_size: 30, zone_up: 0.2, zone_down: 0.2, zone_min: 0.1, zone_max: 0.3,
  titan_f1_points: [25, 18, 15, 12, 10, 8, 6, 4, 2, 1], titan_relegation_min_players: 30,
};

async function upsertRuleset(db: Db, r: ScoringRuleset) {
  const [row] = await db.insert(s.scoringRulesets)
    .values({ version: r.version, rules: r.weights, roleCoefs: r.role_multipliers, notes: r.note })
    .onConflictDoUpdate({ target: s.scoringRulesets.version, set: { rules: r.weights, roleCoefs: r.role_multipliers, notes: r.note } })
    .returning({ id: s.scoringRulesets.id });
  return row!.id;
}

/** Найти нашу запись по внешнему ID или создать её и ссылку. */
async function byRef(db: Db, entityType: string, provider: string, externalId: string, create: () => Promise<number>, update?: (id: number) => Promise<unknown>) {
  const [ref] = await db.select({ id: s.externalRefs.entityId }).from(s.externalRefs)
    .where(and(eq(s.externalRefs.provider, provider), eq(s.externalRefs.entityType, entityType), eq(s.externalRefs.externalId, externalId)));
  if (ref) { await update?.(ref.id); return ref.id; }
  const id = await create();
  await db.insert(s.externalRefs).values({ entityType, entityId: id, provider, externalId });
  return id;
}

async function seedHeroes(db: Db) {
  // OpenDota /constants/heroes: код, английское имя, иконка. name_ru пока = английское (временно, перевод — отдельно).
  const res = await fetch("https://api.opendota.com/api/constants/heroes");
  if (!res.ok) { console.warn(`герои: OpenDota HTTP ${res.status}, пропускаю`); return 0; }
  const heroes = Object.values(await res.json() as Record<string, { id: number; name: string; localized_name: string; img: string }>);
  for (const h of heroes) {
    const v = { id: h.id, code: h.name, nameRu: h.localized_name, iconUrl: `https://cdn.cloudflare.steamstatic.com${h.img.split("?")[0]}` };
    await db.insert(s.heroes).values(v).onConflictDoUpdate({ target: s.heroes.id, set: { code: v.code, iconUrl: v.iconUrl } });
  }
  return heroes.length;
}

async function main() {
  const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/dota_fantasy");
  const teamsJ = load<PTeam[]>("teams.json"), playersJ = load<PPlayer[]>("players.json");
  const roster = load<PRoster[]>("rosters.json").find((r) => r.id === "slam9-prelim")!;
  const tours = load<{ tournaments: Array<{ id: string; prize?: string }> }>("tournaments.json").tournaments;

  await db.transaction(async (tx) => {
    // --- справочники
    await tx.insert(s.tenants).values({ slug: "default", name: "Dota Fantasy", isDefault: true }).onConflictDoNothing();
    for (const [i, [code, name]] of TIERS.entries())
      await tx.insert(s.leagueTiers).values({ id: i + 1, code, nameRu: name }).onConflictDoUpdate({ target: s.leagueTiers.id, set: { code, nameRu: name } });
    const [blast] = await tx.insert(s.organizers).values({ name: "BLAST", slug: "blast" })
      .onConflictDoUpdate({ target: s.organizers.slug, set: { name: "BLAST" } }).returning({ id: s.organizers.id });
    const rsSpec = await upsertRuleset(tx, RULESET_SPEC);
    await upsertRuleset(tx, RULESET_B);

    const [season] = await tx.insert(s.seasons).values({ name: "2026/27", startsOn: "2026-08-24", status: "active", config: SEASON_CONFIG })
      .onConflictDoNothing().returning({ id: s.seasons.id });
    const seasonId = season?.id ?? (await tx.select({ id: s.seasons.id }).from(s.seasons).where(eq(s.seasons.name, "2026/27")))[0]!.id;

    // --- каталог: команды по Steam team_id, игроки по account_id
    const teamId = new Map<string, number>();
    for (const t of teamsJ) {
      if (!t.steam_team_id) throw new Error(`нет steam_team_id у ${t.id}`);
      const vals = { name: t.name, tag: t.tag, logoUrl: t.logo ?? null };
      teamId.set(t.id, await byRef(tx, "team", "steam", String(t.steam_team_id),
        async () => (await tx.insert(s.teams).values(vals).returning({ id: s.teams.id }))[0]!.id,
        (id) => tx.update(s.teams).set({ ...vals, updatedAt: new Date() }).where(eq(s.teams.id, id))));
    }
    const playerId = new Map<string, number>(); const skipped: string[] = [];
    for (const p of playersJ) {
      if (!p.account_id) { skipped.push(p.nick); continue; }
      const vals = { nickname: p.nick, steamAccountId: p.account_id, photoUrl: p.photo ?? null,
        photoLicense: p.photo ? "временно: пресс-материалы команд / cybersport.ru, разрешения не получены" : null };
      const [row] = await tx.insert(s.players).values(vals)
        .onConflictDoUpdate({ target: s.players.steamAccountId, set: { nickname: vals.nickname, photoUrl: vals.photoUrl, photoLicense: vals.photoLicense, updatedAt: new Date() } })
        .returning({ id: s.players.id });
      playerId.set(p.id, row!.id);
    }
    const bonus = new Map(playersJ.map((p) => [p.id, p.rating_bonus_tmp ?? 0]));

    // составы команд — по заявкам Slam VIII (действуют с его старта)
    for (const e of roster.teams) for (const [role, pid] of Object.entries(e.players)) {
      const tId = teamId.get(e.team)!, plId = playerId.get(pid)!;
      const open = await tx.select({ id: s.teamRosters.id }).from(s.teamRosters)
        .where(and(eq(s.teamRosters.teamId, tId), eq(s.teamRosters.playerId, plId), sql`${s.teamRosters.validTo} is null`));
      if (!open.length) await tx.insert(s.teamRosters).values({ teamId: tId, playerId: plId, position: POS[role], role: "player", validFrom: "2026-09-29" });
    }

    // --- турниры
    const prizeIX = Number((tours.find((t) => t.id === "blast")?.prize ?? "").replace(/\D/g, "")) || null;
    const defs = [
      { slug: "blast-slam-8", name: "BLAST Slam VIII", league: 19102, status: "live", isLeagueRound: false,
        startsAt: new Date("2026-09-29T00:00:00+03:00"), endsAt: new Date("2026-10-11T23:59:00+03:00"), prize: null,
        provisional: ["start_prices"], note: "полигон пайплайна: пользователей нет, раундом лиги не считается" },
      { slug: "blast-slam-9", name: "BLAST Slam IX", league: 20208, status: "announced", isLeagueRound: true,
        startsAt: new Date("2026-11-20T00:00:00+03:00"), endsAt: new Date("2026-11-29T23:59:00+03:00"), prize: prizeIX,
        provisional: ["teams", "rosters", "start_prices", "stage_times"], note: roster.source },
    ];
    for (const d of defs) {
      const vals = { seasonId, organizerId: blast!.id, slug: d.slug, name: d.name, tier: 1, prizePoolUsd: d.prize,
        startsAt: d.startsAt, endsAt: d.endsAt, status: d.status, isLeagueRound: d.isLeagueRound, skin: "blast",
        scoringRulesetId: rsSpec, config: { ...CLASSIC_CONFIG, provisional: d.provisional, note: d.note } };
      const [tour] = await tx.insert(s.tournaments).values(vals)
        .onConflictDoUpdate({ target: s.tournaments.slug, set: { ...vals, scoringRulesetId: sql`${s.tournaments.scoringRulesetId}` } })
        .returning({ id: s.tournaments.id });
      const tid = tour!.id;
      const [ref] = await tx.select().from(s.externalRefs).where(and(eq(s.externalRefs.provider, "opendota"), eq(s.externalRefs.entityType, "league"), eq(s.externalRefs.externalId, String(d.league))));
      if (!ref) await tx.insert(s.externalRefs).values({ entityType: "league", entityId: tid, provider: "opendota", externalId: String(d.league),
        url: `https://www.opendota.com/leagues/${d.league}` });

      // стадии Slam IX — 02 §2; время первой карты (дедлайн) неизвестно до расписания BLAST. Для Slam VIII стадии соберёт B2 из матчей.
      const groupId = new Map<string, number>();
      if (d.slug === "blast-slam-9") {
        const stages = [["Группы", "gsl"], ["Посев и Last Chance", "single_elim"], ["Плей-офф", "double_elim"], ["Финальный день", "double_elim"]] as const;
        for (const [idx, [name, format]] of stages.entries()) {
          const [st] = await tx.insert(s.stages).values({ tournamentId: tid, idx, name, format, status: "upcoming" })
            .onConflictDoUpdate({ target: [s.stages.tournamentId, s.stages.idx], set: { name, format } }).returning({ id: s.stages.id });
          if (idx === 0) for (const label of Object.keys(roster.groups)) {
            const [g] = await tx.select({ id: s.stageGroups.id }).from(s.stageGroups).where(and(eq(s.stageGroups.stageId, st!.id), eq(s.stageGroups.label, label)));
            groupId.set(label, g?.id ?? (await tx.insert(s.stageGroups).values({ stageId: st!.id, label }).returning({ id: s.stageGroups.id }))[0]!.id);
          }
        }
      }
      for (const e of roster.teams) {
        const tm = teamId.get(e.team)!;
        const label = Object.entries(roster.groups).find(([, ks]) => ks.includes(e.team))?.[0];
        const gid = label ? groupId.get(label) ?? null : null;
        await tx.insert(s.tournamentTeams).values({ tournamentId: tid, teamId: tm, groupId: gid, status: "active" })
          .onConflictDoUpdate({ target: [s.tournamentTeams.tournamentId, s.tournamentTeams.teamId], set: { groupId: gid } });
        for (const [role, pid] of Object.entries(e.players)) {
          const rating = Math.max(60, Math.min(95, e.strength_tmp + (bonus.get(pid) ?? 0)));
          const v = { tournamentId: tid, playerId: playerId.get(pid)!, teamId: tm, position: POS[role]!, isActive: true,
            startRating: rating.toFixed(2), startPrice: startPrice(rating).toFixed(1) };
          await tx.insert(s.tournamentPlayers).values(v)
            .onConflictDoUpdate({ target: [s.tournamentPlayers.tournamentId, s.tournamentPlayers.playerId], set: { teamId: v.teamId, position: v.position, startRating: v.startRating, startPrice: v.startPrice } });
        }
      }
    }
    console.log(`команд ${teamId.size}, игроков ${playerId.size}${skipped.length ? ` (без account_id пропущены: ${skipped.join(", ")})` : ""}`);
  });
  console.log(`героев ${await seedHeroes(db)}`);
  const counts = await db.execute<{ t: string; n: number }>(sql`
    select 'tournament_players' t, count(*)::int n from tournament_players union all select 'team_rosters', count(*)::int from team_rosters
    union all select 'external_refs', count(*)::int from external_refs union all select 'scoring_rulesets', count(*)::int from scoring_rulesets`);
  console.log(counts.rows.map((r) => `${r.t} ${r.n}`).join(", "));
  await pool.end();
}

await main();
