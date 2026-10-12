// Рейтинг игроков цепочкой турниров (docs/12): отправная точка — TI 2026; кого не было на TI — последний тир-1 турнир
// за полгода до TI; иначе дебютант. Дальше рейтинг обновляется по стадиям турниров после TI.
// Пока только расчёт и отчёт на проверку Georgy: в базу рейтинги не пишутся, пока модель не принята.
import { sql } from "drizzle-orm";
import { type Db } from "@df/db";
import {
  baselines, calibrateScale, levelOf, mapZ, pointsPerMinute, RATING_DEFAULT, RULESET_SPEC, updateRating,
  type Position, type RatingConfig,
} from "@df/domain";

const DAY = 86_400_000;

export interface RatingStep { tournament: string; stage: string | null; stageIdx: number; maps: number; level: number; rating: number }
export interface PlayerRating {
  playerId: number; nickname: string;
  start: { source: string; maps: number; rating: number; position: Position | null };
  steps: RatingStep[];
  /** рейтинг после каждого турнира цепочки (slug → рейтинг; нет ключа — не играл) */
  after: Record<string, number>;
  final: number; fast: string[];
}
export interface RatingRun { scale: number; anchor: string; chain: string[]; players: Map<number, PlayerRating>; names: Record<string, string> }

interface Row {
  map_id: number; started: number; duration_s: number; slug: string; t_start: number; stage_idx: number; stage_name: string;
  player_id: number; position: Position; won: boolean; z: number;
}

export interface RatingOptions { anchor?: string; config?: RatingConfig; /** остановить цепочку перед этим турниром (проверка прогноза) */ stopBefore?: string }

export async function computeRatings(db: Db, opts: RatingOptions = {}): Promise<RatingRun & { levelsBySlug: Map<string, Map<number, { maps: number; level: number }>> }> {
  const anchor = opts.anchor ?? "ti-2026", c = opts.config ?? RATING_DEFAULT;
  const raw = (await db.execute<{
    map_id: number; started: string; duration_s: number; slug: string; t_start: string; stage_idx: number; stage_name: string; t_name: string;
    player_id: number; position: number; won: boolean; kills: number; deaths: number; assists: number; last_hits: number;
    building_damage: number | null; stun_s: string | null; obs_placed: number | null; obs_killed: number | null; camps_stacked: number | null;
  }>(sql`
    select pms.map_id::int, extract(epoch from m.started_at)::float8 * 1000 as started, m.duration_s, t.slug, t.name t_name,
      extract(epoch from t.starts_at)::float8 * 1000 as t_start, st.idx stage_idx, st.name stage_name,
      pms.player_id::int, tp.position, pms.won, pms.kills, pms.deaths, pms.assists, pms.last_hits, pms.building_damage,
      pms.stun_s, pms.obs_placed, pms.obs_killed, pms.camps_stacked
    from player_map_stats pms
    join maps m on m.id = pms.map_id and m.status = 'finished' and m.data_tier = 'parsed'
    join series sr on sr.id = m.series_id join stages st on st.id = sr.stage_id join tournaments t on t.id = sr.tournament_id
    join tournament_players tp on tp.tournament_id = t.id and tp.player_id = pms.player_id
    where pms.won is not null`)).rows;
  const names: Record<string, string> = {};
  for (const r of raw) names[r.slug] = r.t_name;

  // уровень на карте: очки в минуту против обычных для позиции и исхода (по всем загруженным картам)
  const perf = raw.map((r) => ({
    position: r.position as Position, won: r.won,
    ppm: pointsPerMinute({ kills: r.kills, deaths: r.deaths, assists: r.assists, last_hits: r.last_hits, building_damage: r.building_damage,
      stun_s: r.stun_s == null ? null : Number(r.stun_s), obs_placed: r.obs_placed, obs_killed: r.obs_killed, camps_stacked: r.camps_stacked },
    r.duration_s, RULESET_SPEC),
  }));
  const base = baselines(perf);
  const rows: Row[] = raw.map((r, i) => ({ ...r, started: Number(r.started), t_start: Number(r.t_start), position: r.position as Position, z: mapZ(perf[i]!, base) }));

  const byPlayer = new Map<number, Row[]>();
  for (const r of rows) byPlayer.set(r.player_id, [...(byPlayer.get(r.player_id) ?? []), r]);
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const scale = calibrateScale([...byPlayer.values()].map((rs) => ({ n: rs.length, meanZ: mean(rs.map((r) => r.z)) })), c.target_sd);

  const anchorRows = rows.filter((r) => r.slug === anchor);
  if (!anchorRows.length) throw new Error(`нет карт отправного турнира ${anchor}`);
  const anchorStart = Math.min(...anchorRows.map((r) => r.t_start)), anchorEnd = Math.max(...anchorRows.map((r) => r.started));
  const fullChain = [...new Set(rows.filter((r) => r.t_start > anchorEnd).sort((a, b) => a.t_start - b.t_start).map((r) => r.slug))];
  const chain = opts.stopBefore && fullChain.includes(opts.stopBefore) ? fullChain.slice(0, fullChain.indexOf(opts.stopBefore)) : fullChain;

  // уровень каждого игрока на каждом турнире целиком — для проверки прогноза
  const levelsBySlug = new Map<string, Map<number, { maps: number; level: number }>>();
  for (const r of rows) {
    const m = levelsBySlug.get(r.slug) ?? new Map<number, { maps: number; level: number }>();
    const e = m.get(r.player_id) ?? { maps: 0, level: 0 };
    e.level += r.z; e.maps++; m.set(r.player_id, e); levelsBySlug.set(r.slug, m);
  }
  for (const m of levelsBySlug.values()) for (const e of m.values()) e.level = c.mean + scale * (e.level / e.maps);

  const nicks = new Map((await db.execute<{ id: number; nick: string }>(sql`select id::int, nickname nick from players`)).rows.map((r) => [r.id, r.nick]));
  const players = new Map<number, PlayerRating>();
  for (const [playerId, rs] of byPlayer) {
    const level = (xs: Row[]) => levelOf(xs.map((r) => r.z), scale, c);
    // отправная точка
    let startRows = rs.filter((r) => r.slug === anchor), source = names[anchor] ?? anchor;
    if (!startRows.length) {
      const pre = rs.filter((r) => r.t_start < anchorStart && r.t_start >= anchorStart - 183 * DAY);
      const latest = pre.reduce<Row | null>((a, r) => (!a || r.t_start > a.t_start ? r : a), null);
      if (latest) { startRows = pre.filter((r) => r.slug === latest.slug); source = names[latest.slug] ?? latest.slug; }
    }
    const debut = !startRows.length;
    let rating = debut ? c.debut : updateRating(c.mean, level(startRows), startRows.length, c.k, c);
    let lastPos: Position | null = debut ? null : startRows[0]!.position;
    const p: PlayerRating = { playerId, nickname: nicks.get(playerId) ?? String(playerId),
      start: { source: debut ? "дебютант" : source, maps: startRows.length, rating, position: lastPos }, steps: [], after: {}, final: rating, fast: [] };

    let firstPlayed = true;
    for (const slug of chain) {
      const tr = rs.filter((r) => r.slug === slug);
      if (!tr.length) continue;
      const pos = tr[0]!.position;
      const fast = (debut && firstPlayed) || (lastPos != null && pos !== lastPos);
      if (fast) p.fast.push(`${names[slug] ?? slug}: ${debut && firstPlayed ? "дебют" : `позиция ${lastPos}→${pos}`}`);
      const stages = [...new Set(tr.map((r) => r.stage_idx))].sort((a, b) => a - b);
      for (const idx of stages) {
        const sr = tr.filter((r) => r.stage_idx === idx);
        const lv = level(sr);
        rating = updateRating(rating, lv, sr.length, fast ? c.k_fast : c.k, c);
        p.steps.push({ tournament: slug, stage: sr[0]!.stage_name, stageIdx: idx, maps: sr.length, level: lv, rating });
      }
      p.after[slug] = rating; lastPos = pos; firstPlayed = false;
    }
    p.final = rating;
    players.set(playerId, p);
  }
  return { scale, anchor, chain, players, names, levelsBySlug };
}

/** Насколько рейтинг до турнира предсказывает уровень игры на нём: корреляция по игрокам с ≥ minMaps карт. */
export function predictive(ratingBefore: Map<number, number>, actual: Map<number, { maps: number; level: number }>, minMaps = 6) {
  const pairs = [...actual.entries()].filter(([id, a]) => a.maps >= minMaps && ratingBefore.has(id)).map(([id, a]) => [ratingBefore.get(id)!, a.level] as const);
  const n = pairs.length;
  if (n < 5) return { n, corr: NaN, mae: NaN };
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n, my = pairs.reduce((s, p) => s + p[1], 0) / n;
  const cov = pairs.reduce((s, p) => s + (p[0] - mx) * (p[1] - my), 0);
  const vx = pairs.reduce((s, p) => s + (p[0] - mx) ** 2, 0), vy = pairs.reduce((s, p) => s + (p[1] - my) ** 2, 0);
  return { n, corr: cov / Math.sqrt(vx * vy), mae: pairs.reduce((s, p) => s + Math.abs(p[0] - p[1]), 0) / n };
}
