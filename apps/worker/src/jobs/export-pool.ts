// Пул будущего турнира для прототипа (prototype/data/pool/<slug>.json): заявка из регламента (tournament_players),
// стартовый рейтинг игрока (docs/12: цепочка от TI 2026, без истории — дебютант) и цена v1 (рейтинг + сила команды, 02 §6;
// шкала — 5–95 перцентиль ожидаемых очков этого пула). Прототип играет турнир симуляцией от этих стартовых значений.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { expectedMapPoints, priceFromExpected, quantile, RATING_DEFAULT, type Position, type ScoringRuleset } from "@df/domain";
import { fitPointsModel, loadScoredMaps, teamChanceAt, teamMapsIndex } from "./economy-data.js";
import { computeRatings } from "./rating.js";

export async function exportPool(db: Db, slug: string, out: string) {
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, slug));
  if (!tour) throw new Error(`турнир ${slug} не найден`);
  if (!tour.startsAt) throw new Error(`у турнира ${slug} нет даты начала`);
  const [rs] = await db.select().from(s.scoringRulesets).where(eq(s.scoringRulesets.id, tour.scoringRulesetId));
  const ruleset: ScoringRuleset = { version: rs!.version!, note: rs!.notes ?? "", weights: rs!.rules as ScoringRuleset["weights"],
    role_multipliers: rs!.roleCoefs as ScoringRuleset["role_multipliers"] };
  const start = tour.startsAt.getTime();

  const { all, pts } = await loadScoredMaps(db, ruleset);
  const ratings = await computeRatings(db);
  const model = fitPointsModel(all, pts, ratings.scale);
  const teamMaps = teamMapsIndex(all);

  const pool = (await db.execute<{ player_id: number; acc: number; nick: string; team_id: number; tag: string; position: number }>(sql`
    select tp.player_id::int, p.steam_account_id::float8 acc, p.nickname nick, tp.team_id::int, tm.tag, tp.position
    from tournament_players tp join players p on p.id = tp.player_id join teams tm on tm.id = tp.team_id
    where tp.tournament_id = ${tour.id} order by tm.tag, tp.position`)).rows;
  if (!pool.length) throw new Error(`у турнира ${slug} нет заявки (rosters в регламенте → cli format)`);

  // рейтинг на старт: после последнего турнира цепочки, где игрок играл; без карт в базе — дебютант
  const ratingOf = (playerId: number) => {
    const p = ratings.players.get(playerId);
    if (!p) return { rating: RATING_DEFAULT.debut, source: "дебютант: нет карт в базе", maps: 0 };
    const last = [...ratings.chain].reverse().find((c) => p.after[c] != null);
    const maps = p.start.maps + p.steps.reduce((a, st) => a + st.maps, 0);
    return { rating: p.final, source: last ? ratings.names[last] ?? last : p.start.source, maps };
  };
  const teams: Record<string, { chance: number; maps: number; wins: number }> = {};
  for (const e of pool) teams[e.tag] ??= teamChanceAt(teamMaps, e.team_id, start);

  const E = pool.map((e) => expectedMapPoints(ratingOf(e.player_id).rating, teams[e.tag]!.chance, e.position as Position, model));
  const lo = quantile(E, 0.05), hi = quantile(E, 0.95);
  const players: Record<string, unknown> = {};
  pool.forEach((e, i) => {
    const r = ratingOf(e.player_id);
    players[String(e.acc)] = { nick: e.nick, team: e.tag, position: e.position, rating: Math.round(r.rating * 10) / 10,
      price: priceFromExpected(E[i]!, lo, hi), expected: Math.round(E[i]! * 100) / 100, source: r.source, maps: r.maps };
  });

  const doc = {
    tournament: { slug, name: tour.name, starts: tour.startsAt, ends: tour.endsAt },
    generated: new Date().toISOString(),
    rules: `рейтинг — docs/12 (цепочка от TI 2026, K=20; без карт в базе — дебютант ${RATING_DEFAULT.debut}); цена v1 — рейтинг + сила команды ` +
      `(02 §6: доля побед на картах за 183 дня до старта, без карт — 50%), шкала по 5–95 перцентилю ожидаемых очков пула`,
    players,
    teams: Object.fromEntries(Object.entries(teams).map(([k, v]) => [k, { ...v, chance: Math.round(v.chance * 1000) / 1000 }])),
    model: { ...model, scale: ratings.scale, lo, hi },
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(doc, null, 1), "utf8");
  return { players: pool.length, teams: Object.keys(teams).length, lo, hi, doc };
}
