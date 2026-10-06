// Общее для спайка: HTTP с кэшем сырых ответов, ростер (account_id → позиция/команда) из prototype/data.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SPIKE = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const ROOT = resolve(SPIKE, "..", "..");
export const DATA = join(SPIKE, "data");
export const LEAGUE_ID = Number(process.env.LEAGUE_ID ?? 19102); // BLAST Slam VIII
const UA = "dota-fantasy-spike (+https://dota-fantasy.pages.dev)";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function loadEnv(): void {
  const f = join(SPIKE, ".env");
  if (!existsSync(f)) return;
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[1] && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}
export function appendJsonl(path: string, row: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(row) + "\n");
}
export const sha = (s: string) => createHash("sha256").update(s).digest("hex").slice(0, 16);

/** GET JSON с повтором; ответ кладётся в data/raw/<resource>/<id>.json (как raw_payloads в 09-database). */
export async function getJson<T>(url: string, cache?: { resource: string; id: string | number; maxAgeMs?: number }): Promise<T> {
  const file = cache ? join(DATA, "raw", cache.resource, `${cache.id}.json`) : null;
  if (file && existsSync(file) && cache?.maxAgeMs === undefined) return JSON.parse(readFileSync(file, "utf8")) as T;
  let last: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "application/json" } });
      if (res.status === 429) { await sleep(5000 * (attempt + 1)); continue; }
      if (!res.ok) throw new Error(`${res.status} ${res.statusText} ← ${url.replace(/key=[^&]+/, "key=***")}`);
      const body = (await res.json()) as T;
      if (file) writeJson(file, body);
      return body;
    } catch (e) { last = e; await sleep(1500 * (attempt + 1)); }
  }
  throw last;
}

export type Pos = 1 | 2 | 3 | 4 | 5;
export interface RosterEntry { nick: string; team: string; pos: Pos }
const ROLE_POS: Record<string, Pos> = { carry: 1, mid: 2, off: 3, soft: 4, hard: 5 };

/** account_id → игрок пула (позиция из состава турнира в prototype/data/rosters.json). */
export function loadRoster(): Map<number, RosterEntry> {
  const d = (n: string) => JSON.parse(readFileSync(join(ROOT, "prototype", "data", n), "utf8"));
  const players: Array<{ id: string; nick: string; account_id: number | null }> = d("players.json");
  const teams: Array<{ id: string; name: string }> = d("teams.json");
  const rosters: Array<{ teams: Array<{ team: string; players: Record<string, string> }> }> = d("rosters.json");
  const byId = new Map(players.map((p) => [p.id, p]));
  const teamName = new Map(teams.map((t) => [t.id, t.name]));
  const out = new Map<number, RosterEntry>();
  for (const e of rosters[0]!.teams)
    for (const [role, pid] of Object.entries(e.players)) {
      const p = byId.get(pid);
      if (p?.account_id) out.set(p.account_id, { nick: p.nick, team: teamName.get(e.team) ?? e.team, pos: ROLE_POS[role]! });
    }
  return out;
}

export const POS_NAME: Record<Pos, string> = { 1: "керри", 2: "мид", 3: "оффлейн", 4: "саппорт 4", 5: "саппорт 5" };
