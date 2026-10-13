// Общие данные экономики для выгрузок прототипа (export-replay, export-pool): все сыгранные карты с очками,
// модель ожидаемых очков (02 §6) и сила команды по картам за полгода.
import { sql } from "drizzle-orm";
import { type Db } from "@df/db";
import { mapPoints, teamWinChance, type MapStats, type PointsModel, type Position, type ScoringRuleset } from "@df/domain";

export const DAY = 86_400_000;
export const POSITIONS: Position[] = [1, 2, 3, 4, 5];

// type, а не interface: execute<T> требует T extends Record<string, unknown>
export type MapRow = {
  map_id: number; started: number; slug: string; stage_idx: number; series_id: number; bracket_key: string | null; round_label: string;
  team_a: number; team_b: number; winner: number | null; best_of: number; duration_s: number; map_winner: number;
  player_id: number; acc: number; nick: string; team_id: number; tag: string; position: Position; won: boolean;
  kills: number; deaths: number; assists: number; last_hits: number; gpm: number | null; building_damage: number | null;
  stun_s: string | null; obs_placed: number | null; obs_killed: number | null; camps_stacked: number | null;
};

/** Все карты в базе: статистика игрока, его позиция на своём турнире и очки за карту по правилам ruleset. */
export async function loadScoredMaps(db: Db, ruleset: ScoringRuleset): Promise<{ all: MapRow[]; pts: number[] }> {
  const all = (await db.execute<MapRow>(sql`
    select m.id::int map_id, extract(epoch from m.started_at)::float8 * 1000 started, t.slug, st.idx stage_idx, sr.id::int series_id,
      sr.bracket_key, sr.round_label, sr.team_a_id::int team_a, sr.team_b_id::int team_b, sr.winner_team_id::int winner, sr.best_of,
      m.duration_s, m.winner_team_id::int map_winner,
      p.id::int player_id, p.steam_account_id::float8 acc, p.nickname nick, pms.team_id::int, tm.tag, tp.position, pms.won,
      pms.kills, pms.deaths, pms.assists, pms.last_hits, pms.gpm, pms.building_damage, pms.stun_s, pms.obs_placed, pms.obs_killed, pms.camps_stacked
    from player_map_stats pms join maps m on m.id = pms.map_id and m.status = 'finished'
    join series sr on sr.id = m.series_id join stages st on st.id = sr.stage_id join tournaments t on t.id = sr.tournament_id
    join tournament_players tp on tp.tournament_id = t.id and tp.player_id = pms.player_id
    join players p on p.id = pms.player_id join teams tm on tm.id = pms.team_id
    where pms.won is not null
    order by m.started_at, m.id`)).rows.map((r) => ({ ...r, started: Number(r.started), position: r.position as Position }));
  const stats = (r: MapRow): MapStats => ({ kills: r.kills, deaths: r.deaths, assists: r.assists, last_hits: r.last_hits, won: r.won,
    building_damage: r.building_damage, healing: null, stun_s: r.stun_s == null ? null : Number(r.stun_s), obs_placed: r.obs_placed,
    obs_killed: r.obs_killed, camps_stacked: r.camps_stacked });
  return { all, pts: all.map((r) => mapPoints(stats(r), r.position, ruleset)) };
}

/** Модель ожидаемых очков: средние в победе и поражении по позициям; пункт рейтинга = разброс очков / шкала рейтинга. */
export function fitPointsModel(all: MapRow[], pts: number[], ratingScale: number): PointsModel {
  const model: PointsModel = { win: {} as PointsModel["win"], loss: {} as PointsModel["loss"], per_rating: {} as PointsModel["per_rating"] };
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
  for (const pos of POSITIONS) {
    const w = pts.filter((_, i) => all[i]!.position === pos && all[i]!.won), l = pts.filter((_, i) => all[i]!.position === pos && !all[i]!.won);
    model.win[pos] = mean(w); model.loss[pos] = mean(l);
    model.per_rating[pos] = ((sd(w) + sd(l)) / 2) / ratingScale;
  }
  return model;
}

export type TeamMaps = Map<number, Array<{ started: number; slug: string; stage: number; won: boolean }>>;

/** Карты каждой команды (одна запись на команду и карту). */
export function teamMapsIndex(all: MapRow[]): TeamMaps {
  const teamMaps: TeamMaps = new Map(), seen = new Set<string>();
  for (const x of all) {
    const k = `${x.map_id}:${x.team_id}`; if (seen.has(k)) continue; seen.add(k);
    teamMaps.set(x.team_id, [...(teamMaps.get(x.team_id) ?? []), { started: x.started, slug: x.slug, stage: x.stage_idx, won: x.won }]);
  }
  return teamMaps;
}

/** Сила команды (02 §6): доля побед на картах за полгода до старта турнира + сыгранные стадии этого турнира до upto включительно. */
export function teamChanceAt(teamMaps: TeamMaps, teamId: number, start: number, slug?: string, upto?: number | null) {
  let w = 0, n = 0;
  for (const x of teamMaps.get(teamId) ?? []) {
    const before = x.started < start && x.started >= start - 183 * DAY;
    const inT = slug != null && x.slug === slug && upto != null && x.stage <= upto;
    if (before || inT) { n++; if (x.won) w++; }
  }
  return { chance: teamWinChance(w, n), maps: n, wins: w };
}
