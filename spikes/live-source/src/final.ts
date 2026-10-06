// Часть A спайка (без ключа): итог сыгранных карт лиги из OpenDota → очки по спеке на уровнях live / basic / parsed.
//   npx tsx src/final.ts            — собрать/обновить data/final.json
//   npx tsx src/final.ts --request  — заодно заказать разбор реплея для неразобранных карт (POST /request/{id})
import { DATA, LEAGUE_ID, getJson, loadRoster, sleep, writeJson, POS_NAME, type Pos } from "./common.js";
import { rawPoints, type Stats, type Points } from "./scoring.js";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const OD = "https://api.opendota.com/api";
interface LeagueMatch { match_id: number; start_time: number; duration: number; radiant_team_id?: number; dire_team_id?: number }
interface ODPlayer {
  account_id: number | null; isRadiant: boolean; name?: string | null; personaname?: string | null; hero_id: number;
  kills: number; deaths: number; assists: number; last_hits: number; tower_damage?: number | null; hero_healing?: number | null;
  stuns?: number | null; obs_placed?: number | null; observer_kills?: number | null; camps_stacked?: number | null;
}
interface ODMatch { match_id: number; radiant_win: boolean; duration: number; start_time: number; version?: number | null; players: ODPlayer[] }

export interface FinalRow {
  match_id: number; start_time: number; duration: number; parsed: boolean;
  account_id: number; nick: string; team: string; pos: Pos | null; known: boolean;
  stats: Stats; points: Points;
}

const requestParse = process.argv.includes("--request");
const roster = loadRoster();
const list = await getJson<LeagueMatch[]>(`${OD}/leagues/${LEAGUE_ID}/matches`);
console.log(`Лига ${LEAGUE_ID}: ${list.length} карт в OpenDota`);

const reqFile = join(DATA, "requested.json");
const requested: Record<string, number> = existsSync(reqFile) ? JSON.parse(readFileSync(reqFile, "utf8")) : {};
const rows: FinalRow[] = [];
const unknown = new Map<number, string>();
let parsedMaps = 0;

for (const lm of list.sort((a, b) => a.start_time - b.start_time)) {
  // разобранную карту берём из кэша; неразобранную — перезапрашиваем, вдруг разбор уже готов
  const cacheFile = join(DATA, "raw", "match", `${lm.match_id}.json`);
  const cached: ODMatch | null = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : null;
  const m = cached?.version != null ? cached : await getJson<ODMatch>(`${OD}/matches/${lm.match_id}`, { resource: "match", id: lm.match_id, maxAgeMs: 0 });
  if (cached?.version == null) await sleep(1100); // бесплатный лимит OpenDota ~60 запросов/мин
  const parsed = m.version != null;
  if (parsed) parsedMaps++;
  else if (requestParse && !requested[m.match_id] && Date.now() / 1000 - m.start_time - m.duration > 15 * 60) {
    await fetch(`${OD}/request/${m.match_id}`, { method: "POST" }).catch(() => null);
    requested[m.match_id] = Date.now();
  }
  for (const p of m.players) {
    if (!p.account_id) continue;
    const r = roster.get(p.account_id);
    if (!r) unknown.set(p.account_id, p.name || p.personaname || "?");
    const stats: Stats = {
      kills: p.kills, deaths: p.deaths, assists: p.assists, last_hits: p.last_hits,
      won: p.isRadiant === m.radiant_win, building_damage: p.tower_damage ?? null, healing: p.hero_healing ?? null,
      stun_s: parsed ? p.stuns ?? 0 : null, obs_placed: parsed ? p.obs_placed ?? 0 : null,
      obs_killed: parsed ? p.observer_kills ?? 0 : null, camps_stacked: parsed ? p.camps_stacked ?? 0 : null,
    };
    rows.push({ match_id: m.match_id, start_time: m.start_time, duration: m.duration, parsed,
      account_id: p.account_id, nick: r?.nick ?? (p.name || p.personaname || String(p.account_id)), team: r?.team ?? "?",
      pos: r?.pos ?? null, known: !!r, stats, points: rawPoints(stats) });
  }
}
writeJson(join(DATA, "final.json"), rows);
writeJson(reqFile, requested);
console.log(`Карт: ${list.length}, разобрано: ${parsedMaps}. Строк игрок×карта: ${rows.length}.`);
if (unknown.size) console.log(`Не в пуле (стендины/не сопоставлены): ${[...unknown].map(([id, n]) => `${n} (${id})`).join(", ")}`);
const byPos = new Map<Pos, number>();
rows.filter((r) => r.pos).forEach((r) => byPos.set(r.pos!, (byPos.get(r.pos!) ?? 0) + 1));
console.log("Строк по позициям:", [...byPos].sort().map(([p, n]) => `${POS_NAME[p]} ${n}`).join(", "));
