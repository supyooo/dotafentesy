// Выгрузка прошедшего турнира для прототипа (prototype/data/replay/<slug>.json): прототип проигрывает его по кнопке
// «Сыграть стадию» на реальных данных — без API и хостинга (B6 до появления сервера).
// Внутри: серии и карты по стадиям, статистика и очки игроков (очки серии — как у BLAST), рейтинг (docs/12) и цена v1
// (рейтинг + сила команды, 02 §6) на старте и после каждой стадии.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import {
  expectedMapPoints, mapPoints, priceFromExpected, quantile, seriesPoints, teamWinChance,
  type MapStats, type PointsModel, type Position, type ScoringRuleset,
} from "@df/domain";
import { computeRatings } from "./rating.js";

const DAY = 86_400_000;
const POSITIONS: Position[] = [1, 2, 3, 4, 5];

export async function exportReplay(db: Db, slug: string, out: string) {
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, slug));
  if (!tour) throw new Error(`турнир ${slug} не найден`);
  const [rs] = await db.select().from(s.scoringRulesets).where(eq(s.scoringRulesets.id, tour.scoringRulesetId));
  const ruleset: ScoringRuleset = { version: rs!.version!, note: rs!.notes ?? "", weights: rs!.rules as ScoringRuleset["weights"],
    role_multipliers: rs!.roleCoefs as ScoringRuleset["role_multipliers"] };
  const bonus = Number((tour.config as { series_win_bonus?: number }).series_win_bonus ?? 5);
  const start = tour.startsAt!.getTime();

  // все карты в базе: статистика игрока, позиция на своём турнире, очки за карту по правилам турнира-экспорта
  const all = (await db.execute<{
    map_id: number; started: number; slug: string; stage_idx: number; series_id: number; bracket_key: string | null; round_label: string;
    team_a: number; team_b: number; winner: number | null; best_of: number; duration_s: number; map_winner: number;
    player_id: number; acc: number; nick: string; team_id: number; tag: string; position: number; won: boolean;
    kills: number; deaths: number; assists: number; last_hits: number; gpm: number | null; building_damage: number | null;
    stun_s: string | null; obs_placed: number | null; obs_killed: number | null; camps_stacked: number | null;
  }>(sql`
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
  const stats = (r: (typeof all)[number]): MapStats => ({ kills: r.kills, deaths: r.deaths, assists: r.assists, last_hits: r.last_hits, won: r.won,
    building_damage: r.building_damage, healing: null, stun_s: r.stun_s == null ? null : Number(r.stun_s), obs_placed: r.obs_placed,
    obs_killed: r.obs_killed, camps_stacked: r.camps_stacked });
  const pts = all.map((r) => mapPoints(stats(r), r.position, ruleset));

  // модель ожидаемых очков: средние в победе и поражении по позициям; пункт рейтинга = разброс очков / шкала рейтинга
  const ratings = await computeRatings(db);
  const model: PointsModel = { win: {} as PointsModel["win"], loss: {} as PointsModel["loss"], per_rating: {} as PointsModel["per_rating"] };
  for (const pos of POSITIONS) {
    const w = pts.filter((_, i) => all[i]!.position === pos && all[i]!.won), l = pts.filter((_, i) => all[i]!.position === pos && !all[i]!.won);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = (xs: number[]) => { const m = mean(xs); return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)); };
    model.win[pos] = mean(w); model.loss[pos] = mean(l);
    model.per_rating[pos] = ((sd(w) + sd(l)) / 2) / ratings.scale;
  }

  // турнир-экспорт: игроки пула, их стартовый рейтинг (перед первой стадией) и рейтинг после каждой стадии
  const T = all.map((r, i) => ({ r, pt: pts[i]! })).filter((x) => x.r.slug === slug);
  const stageIdx = [...new Set(T.map((x) => x.r.stage_idx))].sort((a, b) => a - b);
  const pool = (await db.execute<{ player_id: number; acc: number; nick: string; team_id: number; tag: string; position: number }>(sql`
    select tp.player_id::int, p.steam_account_id::float8 acc, p.nickname nick, tp.team_id::int, tm.tag, tp.position
    from tournament_players tp join players p on p.id = tp.player_id join teams tm on tm.id = tp.team_id
    where tp.tournament_id = ${tour.id}`)).rows;
  const elim = new Map((await db.execute<{ team_id: number; idx: number | null }>(sql`
    select tt.team_id::int, st.idx from tournament_teams tt left join stages st on st.id = tt.eliminated_after_stage_id
    where tt.tournament_id = ${tour.id}`)).rows.map((x) => [x.team_id, x.idx]));

  const ratingAfter = (playerId: number, upto: number | null): number => {
    const p = ratings.players.get(playerId); if (!p) return 75;
    let v = p.start.rating;
    for (const ch of ratings.chain) {
      if (ch === slug) break;
      if (p.after[ch] != null) v = p.after[ch]!;
    }
    if (upto == null) return v;
    for (const st of p.steps) if (st.tournament === slug && st.stageIdx <= upto) v = st.rating;
    return v;
  };
  const stageNames = new Map((await db.execute<{ idx: number; name: string }>(sql`select idx, name from stages where tournament_id = ${tour.id}`)).rows.map((x) => [x.idx, x.name]));
  const stageName = (idx: number) => stageNames.get(idx) ?? String(idx);

  // сила команды: карты за полгода до турнира + сыгранные стадии этого турнира (одна запись на команду и карту)
  const teamMaps = new Map<number, Array<{ started: number; slug: string; stage: number; won: boolean }>>();
  const seen = new Set<string>();
  for (const x of all) {
    const k = `${x.map_id}:${x.team_id}`; if (seen.has(k)) continue; seen.add(k);
    teamMaps.set(x.team_id, [...(teamMaps.get(x.team_id) ?? []), { started: x.started, slug: x.slug, stage: x.stage_idx, won: x.won }]);
  }
  const teamChance = (teamId: number, upto: number | null) => {
    let w = 0, n = 0;
    for (const x of teamMaps.get(teamId) ?? []) {
      const before = x.started < start && x.started >= start - 183 * DAY;
      const inT = x.slug === slug && upto != null && x.stage <= upto;
      if (before || inT) { n++; if (x.won) w++; }
    }
    return teamWinChance(w, n);
  };
  const expectedAt = (e: (typeof pool)[number], upto: number | null) =>
    expectedMapPoints(ratingAfter(e.player_id, upto), teamChance(e.team_id, upto), e.position as Position, model);
  const startE = pool.map((e) => expectedAt(e, null));
  const lo = quantile(startE, 0.05), hi = quantile(startE, 0.95);

  const players: Record<string, unknown> = {};
  for (const e of pool) {
    const startPrice = priceFromExpected(expectedAt(e, null), lo, hi);
    const stagesOut: Array<{ pts: number; maps: number; rating: number; price: number }> = [];
    let price = startPrice;
    for (const idx of stageIdx) {
      const mine = T.filter((x) => x.r.player_id === e.player_id && x.r.stage_idx === idx);
      const bySeries = new Map<number, typeof mine>();
      for (const x of mine) bySeries.set(x.r.series_id, [...(bySeries.get(x.r.series_id) ?? []), x]);
      const stagePts = [...bySeries.values()].reduce((a, xs) => a + seriesPoints(xs.map((x) => x.pt), xs[0]!.r.winner === xs[0]!.r.team_id, bonus), 0);
      const out = elim.get(e.team_id);
      const frozen = out != null && out < idx; // команда уже выбыла раньше — цена заморожена
      if (!frozen) price = priceFromExpected(expectedAt(e, idx), lo, hi);
      stagesOut.push({ pts: Math.round(stagePts * 10) / 10, maps: mine.length, rating: Math.round(ratingAfter(e.player_id, idx) * 10) / 10, price });
    }
    players[String(e.acc)] = { nick: e.nick, team: e.tag, position: e.position,
      start: { rating: Math.round(ratingAfter(e.player_id, null) * 10) / 10, price: startPrice }, stages: stagesOut };
  }

  // серии по стадиям с картами (порядок — по времени); группы — по стартовым матчам регламента
  const seriesOut = stageIdx.map((idx) => {
    const ids = [...new Set(T.filter((x) => x.r.stage_idx === idx).map((x) => x.r.series_id))];
    return ids.map((sid) => {
      const rows = T.filter((x) => x.r.series_id === sid), f = rows[0]!.r;
      const tagOf = (id: number) => rows.find((x) => x.r.team_id === id)?.r.tag ?? String(id);
      const mapIds = [...new Set(rows.map((x) => x.r.map_id))];
      const maps = mapIds.map((mid) => {
        const mr = rows.filter((x) => x.r.map_id === mid);
        return { winner: tagOf(mr[0]!.r.map_winner), duration_s: mr[0]!.r.duration_s,
          players: mr.map((x) => [x.r.acc, { k: x.r.kills, d: x.r.deaths, a: x.r.assists, lh: x.r.last_hits, gpm: x.r.gpm ?? 0,
            stun: Math.round(Number(x.r.stun_s ?? 0)), obs: x.r.obs_placed ?? 0, stack: x.r.camps_stacked ?? 0, win: x.r.won ? 1 : 0, pt: x.pt }]) };
      });
      const wins = (tag: string) => maps.filter((m) => m.winner === tag).length;
      return { key: f.bracket_key, label: f.round_label, bo: f.best_of, a: tagOf(f.team_a), b: tagOf(f.team_b),
        wa: wins(tagOf(f.team_a)), wb: wins(tagOf(f.team_b)), maps };
    });
  });
  const groups: Record<string, string[]> = {};
  for (const ser of seriesOut[0] ?? []) {
    const m = /^([A-Z])-O([12])$/.exec(ser.key ?? ""); if (!m) continue;
    const g = (groups[m[1]!] ??= ["", "", "", ""]);
    if (m[2] === "1") { g[0] = ser.a; g[3] = ser.b; } else { g[1] = ser.a; g[2] = ser.b; }
  }

  const doc = {
    tournament: { slug, name: tour.name, starts: tour.startsAt, ends: tour.endsAt },
    generated: new Date().toISOString(),
    rules: `очки: ${ruleset.version} без лечения; очки игрока за серию — среднее за карты + ${bonus} за победу в серии (как у BLAST); ` +
      `рейтинг — docs/12 (K=20); цена v1 — рейтинг + сила команды (02 §6), шкала по 5–95 перцентилю пула на старте`,
    scoring: { version: ruleset.version, weights: ruleset.weights, role_multipliers: ruleset.role_multipliers, series_win_bonus: bonus },
    stages: stageIdx.map((idx, i) => ({ idx, name: stageName(idx), series: seriesOut[i] })),
    groups, players,
    model: { ...model, scale: ratings.scale, lo, hi },
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc), "utf8");
  return { players: pool.length, stages: stageIdx.length, series: seriesOut.flat().length, lo, hi, model };
}
