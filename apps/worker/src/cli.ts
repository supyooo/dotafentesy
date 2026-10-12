// Ручной запуск джоб, пока нет Redis/BullMQ (docs/11): те же функции потом станут процессорами очередей.
//   pnpm --filter @df/worker cli ingest blast-slam-8 [--force] [--request-parse]
//   pnpm --filter @df/worker cli score  blast-slam-8 [--rulesets 2026.10-spec,2026.10-b]
//   pnpm --filter @df/worker cli report blast-slam-8
//   pnpm --filter @df/worker cli format blast-slam-8 [--file путь.json]   регламент: стадии, группы, сетка, итог (packages/db/tournaments/)
import { createDb } from "@df/db";
import { sql } from "drizzle-orm";
import { applyFormat, loadFormat } from "./jobs/apply-format.js";
import { ingestOpenDota } from "./jobs/ingest-opendota.js";
import { scoreTournament } from "./jobs/score.js";

const [cmd, slug] = process.argv.slice(2);
const flag = (n: string) => process.argv.includes(n);
const arg = (n: string) => { const i = process.argv.indexOf(n); return i > 0 ? process.argv[i + 1] : undefined; };
if (!cmd || !slug) { console.error("usage: cli <ingest|score|report|format> <tournament-slug>"); process.exit(1); }

const { db, pool } = createDb(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5432/dota_fantasy");
try {
  if (cmd === "format") {
    const r = await applyFormat(db, loadFormat(slug, arg("--file")));
    console.log(`стадий ${r.stages}, групп ${r.groups}; узлы сетки: найдено ${r.matched}, занято сыгранной серией ${r.adopted}, создано ${r.created}`);
    if (r.unplaced.length) console.log(`серии без узла в регламенте (${r.unplaced.length}):\n  ${r.unplaced.join("\n  ")}`);
    const st = await db.execute(sql`
      select st.idx, st.name, st.format, to_char(st.deadline_at at time zone 'UTC', 'DD.MM HH24:MI') deadline_utc,
        count(distinct sr.id)::int series, count(m.id)::int maps
      from stages st join tournaments t on t.id = st.tournament_id and t.slug = ${slug}
      left join series sr on sr.stage_id = st.id left join maps m on m.series_id = sr.id
      group by st.id order by st.idx`);
    console.table(st.rows);
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
