// score-map (docs/11): player_map_stats → player_map_points по версии правил; затем player_stage_points.
// Очки только за завершённые карты; пересчёт идемпотентен (upsert по (map, tournament_player, ruleset)).
// Статистику не трогаем — поменяли правила, пересчитали очки (docs/09 «Статистика отдельно от очков»).
import { eq, inArray, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { mapPoints, pointsBreakdown, rawPoints, type MapStats, type Position, type ScoringRuleset } from "@df/domain";

export interface ScoreOptions { /** Версии правил; по умолчанию — правила турнира. */ rulesets?: string[] }

const rulesetFromRow = (r: typeof s.scoringRulesets.$inferSelect): ScoringRuleset & { id: number } => ({
  id: r.id, version: r.version!, note: r.notes ?? "",
  weights: r.rules as ScoringRuleset["weights"], role_multipliers: r.roleCoefs as ScoringRuleset["role_multipliers"],
});

export async function scoreTournament(db: Db, tournamentSlug: string, opts: ScoreOptions = {}) {
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, tournamentSlug));
  if (!tour) throw new Error(`турнир ${tournamentSlug} не найден`);
  const rows = opts.rulesets?.length
    ? await db.select().from(s.scoringRulesets).where(inArray(s.scoringRulesets.version, opts.rulesets))
    : await db.select().from(s.scoringRulesets).where(eq(s.scoringRulesets.id, tour.scoringRulesetId));
  const rulesets = rows.map(rulesetFromRow);

  // карты турнира × игроки пула (стендины вне пула очков не получают — 02 §3)
  const stats = await db.execute<{
    map_id: number; tp_id: number; position: Position; data_tier: string; won: boolean | null;
    kills: number; deaths: number; assists: number; last_hits: number; building_damage: number | null; hero_healing: number | null;
    stun_s: string | null; obs_placed: number | null; obs_killed: number | null; camps_stacked: number | null;
  }>(sql`
    select pms.map_id, tp.id tp_id, tp.position, pms.data_tier, pms.won, pms.kills, pms.deaths, pms.assists, pms.last_hits,
      pms.building_damage, pms.hero_healing, pms.stun_s, pms.obs_placed, pms.obs_killed, pms.camps_stacked
    from player_map_stats pms
    join maps m on m.id = pms.map_id and m.status = 'finished'
    join series sr on sr.id = m.series_id and sr.tournament_id = ${tour.id}
    join tournament_players tp on tp.tournament_id = ${tour.id} and tp.player_id = pms.player_id`);

  let written = 0;
  for (const r of rulesets) {
    const values = stats.rows.map((x) => {
      const st: MapStats = { kills: x.kills, deaths: x.deaths, assists: x.assists, last_hits: x.last_hits, won: x.won,
        building_damage: x.building_damage, healing: x.hero_healing, stun_s: x.stun_s == null ? null : Number(x.stun_s),
        obs_placed: x.obs_placed, obs_killed: x.obs_killed, camps_stacked: x.camps_stacked };
      const raw = rawPoints(st, r).parsed; // поля, неизвестные на уровне данных, = null → 0
      const pts = mapPoints(st, x.position, r);
      return { mapId: x.map_id, tournamentPlayerId: x.tp_id, rulesetId: r.id, rawPoints: raw.toFixed(2), points: pts.toFixed(2),
        breakdown: pointsBreakdown(st, r), dataTier: x.data_tier, computedAt: new Date() };
    });
    for (let i = 0; i < values.length; i += 500) {
      await db.insert(s.playerMapPoints).values(values.slice(i, i + 500)).onConflictDoUpdate({
        target: [s.playerMapPoints.mapId, s.playerMapPoints.tournamentPlayerId, s.playerMapPoints.rulesetId],
        set: { rawPoints: sql`excluded.raw_points`, points: sql`excluded.points`, breakdown: sql`excluded.breakdown`,
          dataTier: sql`excluded.data_tier`, computedAt: sql`excluded.computed_at` },
      });
    }
    written += values.length;
  }

  // очки за стадию — только по правилам турнира (в player_stage_points нет ruleset_id)
  await db.execute(sql`
    insert into player_stage_points (tournament_player_id, stage_id, points, maps_played)
    select pmp.tournament_player_id, sr.stage_id, sum(pmp.points), count(*)
    from player_map_points pmp
    join maps m on m.id = pmp.map_id
    join series sr on sr.id = m.series_id
    where sr.tournament_id = ${tour.id} and pmp.ruleset_id = ${tour.scoringRulesetId}
    group by 1, 2
    on conflict (tournament_player_id, stage_id) do update set points = excluded.points, maps_played = excluded.maps_played`);
  return { rulesets: rulesets.map((r) => r.version), rows: written };
}
