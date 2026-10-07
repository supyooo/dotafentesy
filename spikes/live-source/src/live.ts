// Часть B спайка: опрос Steam GetLiveLeagueGames по лиге, пока идут карты. Каждый тик — строка в data/live/<YYYY-MM-DD>.jsonl
// (сводка по игрокам + stream_delay_s), полный ответ — не чаще раза в минуту на карту в data/raw/live/ (как в 09-database).
//   STEAM_API_KEY в spikes/live-source/.env (файл в .gitignore) → npx tsx src/live.ts [--interval 7]
import { join } from "node:path";
import { DATA, LEAGUE_ID, appendJsonl, getJson, loadEnv, loadRoster, sleep, writeJson } from "./common.js";
import { rawPoints } from "./scoring.js";

interface SteamLivePlayer { account_id: number; kills: number; death: number; assists: number; last_hits: number; denies: number; net_worth?: number; gold_per_min?: number; xp_per_min?: number; level?: number; hero_id: number }
interface SteamLiveGame {
  match_id: number; league_id: number; stream_delay_s?: number; radiant_series_wins?: number; dire_series_wins?: number;
  scoreboard?: { duration: number; radiant?: { score: number; players?: SteamLivePlayer[] }; dire?: { score: number; players?: SteamLivePlayer[] } };
}
export interface LiveTick {
  at: string; ok: boolean; error?: string; match_id?: number; stream_delay_s?: number | null; duration?: number;
  players: Array<{ account_id: number; pos: number | null; k: number; d: number; a: number; lh: number; nw?: number; live_points: number }>;
}

loadEnv();
const key = process.env.STEAM_API_KEY?.trim(); // секрет могли вставить с переносом строки
if (!key) { console.error("Нет STEAM_API_KEY: создай spikes/live-source/.env со строкой STEAM_API_KEY=… (ключ: steamcommunity.com/dev/apikey)"); process.exit(1); }
const ia = process.argv.indexOf("--interval"), interval = (ia > 0 ? Number(process.argv[ia + 1]) : 7) * 1000;
const roster = loadRoster();
const lastRaw = new Map<number, number>();
const url = `https://api.steampowered.com/IDOTA2Match_570/GetLiveLeagueGames/v1/?key=${key}&league_id=${LEAGUE_ID}`;
console.log(`Опрос лиги ${LEAGUE_ID} каждые ${interval / 1000} с. Ctrl+C — остановить.`);

for (;;) {
  const at = new Date().toISOString(), day = join(DATA, "live", `${at.slice(0, 10)}.jsonl`);
  try {
    const body = await getJson<{ result?: { games?: SteamLiveGame[] } }>(url);
    const games = (body.result?.games ?? []).filter((g) => g.league_id === LEAGUE_ID);
    if (!games.length) appendJsonl(day, { at, ok: true, players: [] } satisfies LiveTick);
    for (const g of games) {
      const sb = g.scoreboard, ps = [...(sb?.radiant?.players ?? []), ...(sb?.dire?.players ?? [])];
      const players = ps.map((p) => ({ account_id: p.account_id, pos: roster.get(p.account_id)?.pos ?? null, k: p.kills, d: p.death, a: p.assists, lh: p.last_hits, nw: p.net_worth,
        live_points: rawPoints({ kills: p.kills, deaths: p.death, assists: p.assists, last_hits: p.last_hits }).live }));
      appendJsonl(day, { at, ok: true, match_id: g.match_id, stream_delay_s: g.stream_delay_s ?? null, duration: sb?.duration, players } satisfies LiveTick);
      if (Date.now() - (lastRaw.get(g.match_id) ?? 0) > 60_000) { writeJson(join(DATA, "raw", "live", `${g.match_id}-${Date.now()}.json`), g); lastRaw.set(g.match_id, Date.now()); }
    }
    console.log(`${at.slice(11, 19)} карт в эфире: ${games.length}${games.map((g) => ` · ${g.match_id} ${Math.round((g.scoreboard?.duration ?? 0) / 60)}' delay ${g.stream_delay_s ?? "?"}s`).join("")}`);
  } catch (e) {
    appendJsonl(day, { at, ok: false, error: String(e).replace(/key=[^&\s]+/, "key=***"), players: [] } satisfies LiveTick);
    console.log(`${at.slice(11, 19)} ошибка: ${String(e).replace(/key=[^&\s]+/, "key=***")}`);
  }
  await sleep(interval);
}
