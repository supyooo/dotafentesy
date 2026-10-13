// Выгрузка прошедшего турнира для прототипа (prototype/data/replay/<slug>.json): прототип проигрывает его по кнопке
// «Сыграть стадию» на реальных данных — без API и хостинга (B6 до появления сервера).
// Внутри: серии и карты по стадиям, статистика и очки игроков (очки серии — как у BLAST), рейтинг (docs/12) и цена v1
// (рейтинг + сила команды, 02 §6) на старте и после каждой стадии.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { expectedMapPoints, priceFromExpected, quantile, seriesPoints, type Position, type ScoringRuleset } from "@df/domain";
import { fitPointsModel, loadScoredMaps, teamChanceAt, teamMapsIndex } from "./economy-data.js";
import { computeRatings } from "./rating.js";

export async function exportReplay(db: Db, slug: string, out: string) {
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, slug));
  if (!tour) throw new Error(`турнир ${slug} не найден`);
  const [rs] = await db.select().from(s.scoringRulesets).where(eq(s.scoringRulesets.id, tour.scoringRulesetId));
  const ruleset: ScoringRuleset = { version: rs!.version!, note: rs!.notes ?? "", weights: rs!.rules as ScoringRuleset["weights"],
    role_multipliers: rs!.roleCoefs as ScoringRuleset["role_multipliers"] };
  const bonus = Number((tour.config as { series_win_bonus?: number }).series_win_bonus ?? 5);
  const start = tour.startsAt!.getTime();

  // все карты в базе с очками по правилам турнира-экспорта; модель ожидаемых очков (02 §6)
  const { all, pts } = await loadScoredMaps(db, ruleset);
  const ratings = await computeRatings(db);
  const model = fitPointsModel(all, pts, ratings.scale);

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

  // сила команды: карты за полгода до турнира + сыгранные стадии этого турнира
  const teamMaps = teamMapsIndex(all);
  const teamChance = (teamId: number, upto: number | null) => teamChanceAt(teamMaps, teamId, start, slug, upto).chance;
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
