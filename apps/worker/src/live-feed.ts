// Живые данные идущего турнира для прототипа — без базы, чтобы запускаться и здесь, и в GitHub Actions (.github/workflows/live-feed.yml).
//   pnpm --filter @df/worker live-feed pari-universe-1 [--out путь.json] [--cache путь.json]
// OpenDota: карты лиги → статистика игроков → очки по правилам (@df/domain, как в score/export-replay) → серии по узлам регламента.
// Формат — как у выгрузки replay (prototype/data/replay), плюс статусы серий и стадий: прототип показывает сыгранное, без «Сыграть стадию».
// Очки — только за завершённые карты; до разбора реплея — уровень basic (без оглушений, вардов и стаков), после разбора пересчитываются.
// Рейтинг и цена в живом режиме — стартовые из пула (cli export-pool); пересчёт после стадии — в базе (B-план), сюда пока не идёт.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { mapPoints, RULESET_SPEC, seriesPoints, type Position } from "@df/domain";
import { normalizeMatch, OpenDota, type NormMap } from "@df/sources";

const ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const args = process.argv.slice(2);
const slug = args[0];
const arg = (n: string) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
if (!slug) { console.error("usage: live-feed <tournament-slug> [--out file] [--cache file]"); process.exit(1); }
const OUT = arg("--out") ?? `${ROOT}prototype/data/live/${slug}.json`;
const CACHE = arg("--cache") ?? `${ROOT}.cache/live-${slug}.json`;
const BONUS = 5; // бонус за победу в серии (02 §5 п.3), как series_win_bonus в конфиге турнира
const PARSE_AFTER_MS = 10 * 60_000; // разбор реплея заказываем, если карта закончилась больше 10 минут назад

interface RegSeries { key: string; stage: number; group?: string; label: string; bo: number; teams?: [string | null, string | null]; at?: string }
interface Reg {
  slug: string; tournament?: { name: string; opendota_league_id?: number };
  stages: Array<{ idx: number; name: string; format: string; from?: string; to?: string; groups?: Record<string, string[]> }>;
  series: RegSeries[]; teams?: Array<{ tag: string; name: string; steam_team_id?: number }>; utc_offset: string;
}
interface PoolPlayer { nick: string; team: string; position: Position; rating: number; price: number }
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, "utf8")) as T;

const reg = readJson<Reg>(`${ROOT}packages/db/tournaments/${slug}.json`);
const pool = readJson<{ tournament: { name: string; starts: string; ends: string }; players: Record<string, PoolPlayer> }>(`${ROOT}prototype/data/pool/${slug}.json`);
const protoTeams = readJson<Array<{ name: string; tag: string; steam_team_id?: number }>>(`${ROOT}prototype/data/teams.json`);
const leagueId = reg.tournament?.opendota_league_id;
if (!leagueId) throw new Error(`${slug}: в регламенте нет opendota_league_id`);

// команды: Steam team id → тег; названия — из регламента, иначе из прототипа
const tagBySteam = new Map<number, string>();
for (const t of protoTeams) if (t.steam_team_id) tagBySteam.set(t.steam_team_id, t.tag);
for (const t of reg.teams ?? []) if (t.steam_team_id) tagBySteam.set(t.steam_team_id, t.tag);
const teamName = (tag: string) => reg.teams?.find((t) => t.tag === tag)?.name ?? protoTeams.find((t) => t.tag === tag)?.name ?? tag;

// кэш нормализованных карт: разобранные не запрашиваем повторно
type Cached = NormMap & { parseRequested?: number };
const cache: Record<string, Cached> = existsSync(CACHE) ? readJson(CACHE) : {};
const od = new OpenDota();
const list = (await od.leagueMatches(leagueId)).body;
let fetched = 0, requested = 0;
for (const lm of list) {
  const c = cache[lm.match_id];
  if (c?.tier === "parsed") continue;
  const m: Cached = normalizeMatch((await od.match(lm.match_id)).body);
  fetched++;
  // разбор заказываем раз в 30 минут на карту, пока он не появится
  if (m.tier !== "parsed" && Date.now() - m.endedAt.getTime() > PARSE_AFTER_MS && !(c?.parseRequested && Date.now() - c.parseRequested < 30 * 60_000)) {
    await od.requestParse(lm.match_id).then(() => { requested++; m.parseRequested = Date.now(); }).catch(() => {});
  } else if (c?.parseRequested) m.parseRequested = c.parseRequested;
  cache[lm.match_id] = m;
}
mkdirSync(dirname(CACHE), { recursive: true });
writeFileSync(CACHE, JSON.stringify(cache), "utf8");

// карты → серии (series_id OpenDota; без него — пара команд и день)
const tagOf = (t: NormMap["radiant"]) => (t ? tagBySteam.get(t.team_id) ?? null : null);
const maps = Object.values(cache).map((m) => ({ ...m, startedAt: new Date(m.startedAt), endedAt: new Date(m.endedAt) }))
  .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime());
const unknownTeams = new Set<string>();
const groupsBy = new Map<string, typeof maps>();
for (const m of maps) {
  const ra = tagOf(m.radiant), di = tagOf(m.dire);
  if (!ra || !di) { unknownTeams.add(`${m.radiant?.name ?? "?"} / ${m.dire?.name ?? "?"} (карта ${m.dotaMatchId})`); continue; }
  const pair = [ra, di].sort().join("-");
  const k = m.seriesExtId ? `s${m.seriesExtId}` : `${pair}@${m.startedAt.toISOString().slice(0, 10)}`;
  groupsBy.set(k, [...(groupsBy.get(k) ?? []), m]);
}

// серии → узлы регламента: у группы — по паре команд; у сетки — по ближайшему времени в окне стадии
const day = (iso: string) => new Date(`${iso}T00:00:00${reg.utc_offset}`).getTime();
const stageOf = (t: number) => reg.stages.find((st) => st.from && st.to && t >= day(st.from) && t < day(st.to) + 86_400_000)?.idx ?? null;
const claimed = new Map<string, typeof maps>();
const unplaced: string[] = [];
for (const [k, ms] of [...groupsBy.entries()].sort((a, b) => a[1][0]!.startedAt.getTime() - b[1][0]!.startedAt.getTime())) {
  const t0 = ms[0]!.startedAt.getTime(), st = stageOf(t0);
  const pair = [tagOf(ms[0]!.radiant)!, tagOf(ms[0]!.dire)!].sort().join("-");
  const free = reg.series.filter((x) => x.stage === st && !claimed.has(x.key));
  const byPair = free.find((x) => x.teams?.every(Boolean) && [...x.teams].sort().join("-") === pair);
  const byTime = free.filter((x) => !x.teams?.every(Boolean) && x.at)
    .sort((a, b) => Math.abs(Date.parse(a.at!) - t0) - Math.abs(Date.parse(b.at!) - t0))[0];
  const node = byPair ?? byTime;
  if (node) claimed.set(node.key, ms); else unplaced.push(`${k} ${pair} ${ms[0]!.startedAt.toISOString()}`);
}

// очки: игрок пула → позиция в заявке; карта → очки по правилам; серия → среднее за карты + бонус за победу (02 §5)
const r1 = (x: number) => Math.round(x * 10) / 10;
const stagePts = new Map<string, number[]>(); // acc → очки по стадиям
const stageMaps = new Map<string, number[]>();
const NS = reg.stages.length;
const seriesOut = reg.series.map((node) => {
  const ms = claimed.get(node.key) ?? [];
  const actual = ms.length ? [tagOf(ms[0]!.radiant)!, tagOf(ms[0]!.dire)!] : null;
  const [a, b] = node.teams?.every(Boolean) ? (node.teams as [string, string]) : actual ?? [node.teams?.[0] ?? null, node.teams?.[1] ?? null];
  const winOf = (m: (typeof maps)[number]) => (m.radiantWin ? tagOf(m.radiant) : tagOf(m.dire));
  const wa = ms.filter((m) => winOf(m) === a).length, wb = ms.filter((m) => winOf(m) === b).length;
  const need = Math.ceil(node.bo / 2 + 0.01);
  const finished = wa >= need || wb >= need;
  const winner = finished ? (wa > wb ? a : b) : null;
  const status = finished ? "finished" : ms.length ? "live" : "scheduled";
  const per = new Map<string, number[]>();
  const mapsOut = ms.map((m) => ({
    id: m.dotaMatchId, start: m.startedAt.toISOString(), winner: winOf(m), duration_s: m.durationS, tier: m.tier,
    players: m.players.filter((p) => pool.players[String(p.accountId)]).map((p) => {
      const pp = pool.players[String(p.accountId)]!;
      const pt = mapPoints(p.stats, pp.position, RULESET_SPEC, m.tier === "parsed" ? "parsed" : "basic");
      per.set(String(p.accountId), [...(per.get(String(p.accountId)) ?? []), pt]);
      return [p.accountId, { k: p.stats.kills, d: p.stats.deaths, a: p.stats.assists, lh: p.stats.last_hits, gpm: p.stats.gpm ?? 0,
        stun: Math.round(Number(p.stats.stun_s ?? 0)), obs: p.stats.obs_placed ?? 0, stack: p.stats.camps_stacked ?? 0, win: p.stats.won ? 1 : 0, pt }];
    }),
  }));
  const pts: Record<string, number> = {};
  for (const [acc, list] of per) {
    pts[acc] = seriesPoints(list, winner != null && pool.players[acc]!.team === winner, BONUS);
    const sp = stagePts.get(acc) ?? new Array(NS).fill(0), sm = stageMaps.get(acc) ?? new Array(NS).fill(0);
    sp[node.stage] = r1(sp[node.stage] + pts[acc]!); sm[node.stage] += list.length;
    stagePts.set(acc, sp); stageMaps.set(acc, sm);
  }
  return { key: node.key, stage: node.stage, group: node.group ?? null, label: node.label, bo: node.bo, a, b, at: node.at ?? null,
    start: ms[0]?.startedAt.toISOString() ?? null, status, wa, wb, maps: mapsOut, pts };
});

const now = Date.now();
const stages = reg.stages.map((st) => {
  const ser = seriesOut.filter((x) => x.stage === st.idx);
  const status = ser.length && ser.every((x) => x.status === "finished") ? "finished"
    : ser.some((x) => x.status !== "scheduled") || (st.from && now >= day(st.from)) ? "live" : "upcoming";
  return { idx: st.idx, name: st.name, format: st.format, from: st.from ?? null, to: st.to ?? null, status,
    series: ser.map(({ stage: _s, ...rest }) => rest) };
});

// таблица групп: очко за выигранную карту (регламент PARI), дальше — серии
const groups = reg.stages[0]?.groups ?? {};
const standings = Object.fromEntries(Object.entries(groups).map(([g, tags]) => {
  const rows = tags.map((tag) => {
    const mine = seriesOut.filter((x) => x.group === g && (x.a === tag || x.b === tag));
    const mw = mine.reduce((s, x) => s + (x.a === tag ? x.wa : x.wb), 0), ml = mine.reduce((s, x) => s + (x.a === tag ? x.wb : x.wa), 0);
    const fin = mine.filter((x) => x.status === "finished");
    const sw = fin.filter((x) => (x.a === tag ? x.wa > x.wb : x.wb > x.wa)).length;
    return { tag, maps_won: mw, maps_lost: ml, series_won: sw, series_lost: fin.length - sw, played: fin.length };
  }).sort((p, q) => q.maps_won - p.maps_won || p.maps_lost - q.maps_lost);
  return [g, rows];
}));

const players = Object.fromEntries(Object.entries(pool.players).map(([acc, p]) => [acc, {
  nick: p.nick, team: p.team, position: p.position, start: { rating: p.rating, price: p.price },
  stages: (stagePts.get(acc) ?? new Array(NS).fill(0)).map((pts, i) => ({ pts, maps: stageMaps.get(acc)?.[i] ?? 0, rating: p.rating, price: p.price })),
}]));

const doc = {
  tournament: { slug, name: reg.tournament?.name ?? slug, starts: pool.tournament.starts, ends: pool.tournament.ends, league_id: leagueId },
  live: true,
  rules: `очки: ${RULESET_SPEC.version} без лечения; за серию — среднее за карты + ${BONUS} за победу в серии; до разбора реплея — без оглушений, вардов и стаков. ` +
    `Рейтинг и цена — стартовые (пул), в живом режиме не пересчитываются`,
  scoring: { version: RULESET_SPEC.version, weights: RULESET_SPEC.weights, role_multipliers: RULESET_SPEC.role_multipliers, series_win_bonus: BONUS },
  stages, groups, standings,
  teams: Object.fromEntries([...new Set(Object.values(pool.players).map((p) => p.team))].map((t) => [t, teamName(t)])),
  players,
  pending_parse: maps.filter((m) => m.tier !== "parsed").map((m) => m.dotaMatchId),
};

// пишем, только если данные изменились: generated — время последнего изменения данных, а не запуска
const prev = existsSync(OUT) ? readJson<typeof doc & { generated?: string }>(OUT) : null;
const same = prev && JSON.stringify({ ...prev, generated: undefined }) === JSON.stringify({ ...doc, generated: undefined });
if (!same) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify({ ...doc, generated: new Date().toISOString() }), "utf8");
}
const done = seriesOut.filter((x) => x.status === "finished").length, live = seriesOut.filter((x) => x.status === "live").length;
console.log(`${same ? "без изменений" : "обновлено"}: карт ${maps.length} (запрошено ${fetched}, разбор заказан ${requested}, ждут разбора ${doc.pending_parse.length}); ` +
  `серий сыграно ${done}, идёт ${live}; стадии: ${stages.map((s) => `${s.name} — ${s.status}`).join(", ")}`);
if (unknownTeams.size) console.log(`команды без тега (нет steam_team_id): ${[...unknownTeams].join("; ")}`);
if (unplaced.length) console.log(`серии без узла регламента: ${unplaced.join("; ")}`);
// для CI: 1 — данные изменились (коммитить), 0 — нет
if (process.env.GITHUB_OUTPUT) writeFileSync(process.env.GITHUB_OUTPUT, `changed=${same ? 0 : 1}\n`, { flag: "a" });
