// Ручной запуск джоб, пока нет Redis/BullMQ (docs/11): те же функции потом станут процессорами очередей.
//   pnpm --filter @df/worker cli ingest blast-slam-8 [--force] [--request-parse]
//   pnpm --filter @df/worker cli score  blast-slam-8 [--rulesets 2026.10-spec,2026.10-b]
//   pnpm --filter @df/worker cli report blast-slam-8
//   pnpm --filter @df/worker cli format blast-slam-8 [--file путь.json]   регламент: стадии, группы, сетка, итог (packages/db/tournaments/)
//   pnpm --filter @df/worker cli pool   ti-2026      пул по картам (позиции по линии и net worth); у турнира с заявкой — только сверка
//   pnpm --filter @df/worker cli export-pool pari-universe-1   будущий турнир для прототипа: заявка, стартовые рейтинги и цены
import { createDb } from "@df/db";
import { sql } from "drizzle-orm";
import { applyFormat, loadFormat } from "./jobs/apply-format.js";
import { ingestOpenDota } from "./jobs/ingest-opendota.js";
import { buildPool } from "./jobs/pool.js";
import { computeRatings, predictive } from "./jobs/rating.js";
import { exportReplay } from "./jobs/export-replay.js";
import { exportPool } from "./jobs/export-pool.js";
import { RATING_DEFAULT } from "@df/domain";
import { ratingReport, type PoolEntry } from "./jobs/rating-report.js";
import { scoreTournament } from "./jobs/score.js";
import { writeFileSync } from "node:fs";

const [cmd, slug] = process.argv.slice(2);
const flag = (n: string) => process.argv.includes(n);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
if (!cmd || !slug) { console.error("usage: cli <ingest|score|report|format> <tournament-slug>"); process.exit(1); }

const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/dota_fantasy");
try {
  if (cmd === "format") {
    const r = await applyFormat(db, loadFormat(slug, arg("--file")));
    console.log(`стадий ${r.stages}, групп ${r.groups}; узлы сетки: найдено ${r.matched}, занято сыгранной серией ${r.adopted}, создано ${r.created}`);
    if (r.teams.length) console.log(`заведены команды: ${r.teams.join(", ")}`);
    if (r.players) console.log(`заявка: ${r.players} игроков`);
    if (r.unplaced.length) console.log(`серии без узла в регламенте (${r.unplaced.length}):\n  ${r.unplaced.join("\n  ")}`);
    const st = await db.execute(sql`
      select st.idx, st.name, st.format, to_char(st.deadline_at at time zone 'UTC', 'DD.MM HH24:MI') deadline_utc,
        count(distinct sr.id)::int series, count(m.id)::int maps
      from stages st join tournaments t on t.id = st.tournament_id and t.slug = ${slug}
      left join series sr on sr.stage_id = st.id left join maps m on m.series_id = sr.id
      group by st.id order by st.idx`);
    console.table(st.rows);
  } else if (cmd === "rating") {
    // cli rating blast-slam-8 [--anchor ti-2026] [--out путь.md] — рейтинг цепочкой турниров и отчёт по пулу турнира
    const run = await computeRatings(db, { anchor: arg("--anchor") ?? "ti-2026", config: arg("--k") ? { ...RATING_DEFAULT, k: Number(arg("--k")), k_fast: Number(arg("--k")) / 2 } : undefined });
    const pool = (await db.execute<PoolEntry>(sql`
      select tp.player_id::int, tm.tag, tp.position, tp.start_rating::float8 tmp
      from tournament_players tp join teams tm on tm.id = tp.team_id join tournaments t on t.id = tp.tournament_id and t.slug = ${slug}`)).rows;
    const [{ n }] = (await db.execute<{ n: number }>(sql`select count(*)::int n from maps where status = 'finished' and data_tier = 'parsed'`)).rows as [{ n: number }];
    const out = arg("--out") ?? `../../docs/reports/rating-${slug}.md`;
    writeFileSync(out, ratingReport(run, pool, slug, n), "utf8");
    console.log(`шкала: ${run.scale.toFixed(2)}; цепочка: ${run.chain.join(" → ")}; отчёт: ${out}`);
  } else if (cmd === "export-replay") {
    // cli export-replay blast-slam-8 — прошедший турнир для прототипа (prototype/data/replay/<slug>.json)
    const out = arg("--out") ?? `../../prototype/data/replay/${slug}.json`;
    const r = await exportReplay(db, slug, out);
    console.log(`выгружено: ${r.players} игроков, ${r.stages} стадии, ${r.series} серий → ${out}`);
    console.log(`ожидаемые очки за карту: шкала цены ${r.lo.toFixed(2)}…${r.hi.toFixed(2)}`);
    console.table([1, 2, 3, 4, 5].map((p) => ({ позиция: p, победа: r.model.win[p as 1].toFixed(2), поражение: r.model.loss[p as 1].toFixed(2), "за пункт рейтинга": r.model.per_rating[p as 1].toFixed(3) })));
  } else if (cmd === "export-pool") {
    // cli export-pool pari-universe-1 — будущий турнир для прототипа: заявка, стартовые рейтинги и цены (prototype/data/pool/<slug>.json)
    const out = arg("--out") ?? `../../prototype/data/pool/${slug}.json`;
    const r = await exportPool(db, slug, out);
    console.log(`выгружено: ${r.players} игроков, ${r.teams} команд → ${out}; шкала цены ${r.lo.toFixed(2)}…${r.hi.toFixed(2)}`);
    const rows = Object.values(r.doc.players as Record<string, { nick: string; team: string; position: number; rating: number; price: number; source: string }>);
    console.table(rows.map((p) => ({ команда: p.team, поз: p.position, игрок: p.nick, рейтинг: p.rating, цена: p.price, откуда: p.source })));
    console.table(Object.entries(r.doc.teams).map(([t, v]) => ({ команда: t, карт: v.maps, побед: v.wins, сила: v.chance })));
  } else if (cmd === "rating-eval") {
    // cli rating-eval blast-slam-8 — предсказывает ли рейтинг до турнира игру на нём; подбор K (docs/12 §2)
    const tmp = new Map((await db.execute<{ player_id: number; r: number }>(sql`
      select tp.player_id::int, tp.start_rating::float8 r from tournament_players tp join tournaments t on t.id = tp.tournament_id and t.slug = ${slug}
      where tp.start_rating is not null`)).rows.map((x) => [x.player_id, x.r]));
    const out: Array<Record<string, string | number>> = [];
    for (const k of [5, 10, 15, 20, 30, 40, 60]) {
      const run = await computeRatings(db, { stopBefore: slug, config: { ...RATING_DEFAULT, k, k_fast: k / 2 } });
      const before = new Map([...run.players.values()].map((p) => [p.playerId, p.final]));
      const e = predictive(before, run.levelsBySlug.get(slug) ?? new Map());
      out.push({ K: k, игроков: e.n, корреляция: e.corr.toFixed(3), "ср. ошибка": e.mae.toFixed(2) });
    }
    if (tmp.size) {
      const run = await computeRatings(db, { stopBefore: slug });
      const e = predictive(tmp, run.levelsBySlug.get(slug) ?? new Map());
      out.push({ K: "прототип (выдуманный)", игроков: e.n, корреляция: e.corr.toFixed(3), "ср. ошибка": "—" });
    }
    console.table(out);
  } else if (cmd === "pool") {
    const r = await buildPool(db, slug);
    const reg = r.rows.filter((x) => x.registered != null);
    if (reg.length) {
      const bad = reg.filter((x) => x.position !== x.registered);
      console.log(`сверка с заявкой: совпало ${reg.length - bad.length} из ${reg.length}`);
      if (bad.length) console.table(bad.map((x) => ({ игрок: x.nickname, команда: x.team, заявка: x.registered, по_картам: x.position, карт: x.maps, доля: x.share.toFixed(2) })));
    }
    if (r.written) console.log(`пул записан: ${r.written} игроков`);
    const unsure = r.rows.filter((x) => x.share < 0.7);
    if (unsure.length) {
      console.log(`позиция неуверенная (меньше 70% карт на одной позиции) — проверить по Liquipedia:`);
      console.table(unsure.map((x) => ({ игрок: x.nickname, команда: x.team, позиция: x.position, карт: x.maps, доля: x.share.toFixed(2) })));
    }
  } else if (cmd === "ingest") {
    const r = await ingestOpenDota(db, slug, { force: flag("--force"), requestParse: flag("--request-parse"), log: (m) => console.log(m) });
    console.log(`карт ${r.seen}, обновлено ${r.changed}, разобрано ${r.parsed}, заказан разбор ${r.requested}`);
  } else if (cmd === "score") {
    const r = await scoreTournament(db, slug, { rulesets: arg("--rulesets")?.split(",") });
    console.log(`правила ${r.rulesets.join(", ")}: строк очков ${r.rows}`);
  } else if (cmd === "report") {
    const q = await db.execute(sql`
      select rs.version, tp.position pos, count(*)::int maps, round(avg(pmp.raw_points), 2) raw_avg, round(avg(pmp.points), 2) pts_avg
      from player_map_points pmp join tournament_players tp on tp.id = pmp.tournament_player_id
      join tournaments t on t.id = tp.tournament_id and t.slug = ${slug}
      join scoring_rulesets rs on rs.id = pmp.ruleset_id
      group by 1, 2 order by 1, 2`);
    console.table(q.rows);
    const top = await db.execute(sql`
      select p.nickname, tm.tag, tp.position pos, psp.maps_played maps, psp.points, round(psp.points / psp.maps_played, 2) per_map
      from player_stage_points psp join tournament_players tp on tp.id = psp.tournament_player_id
      join players p on p.id = tp.player_id join teams tm on tm.id = tp.team_id
      join tournaments t on t.id = tp.tournament_id and t.slug = ${slug}
      order by psp.points desc limit 10`);
    console.table(top.rows);
  } else throw new Error(`неизвестная команда ${cmd}`);
} finally { await pool.end(); }
