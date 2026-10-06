import type { DataTier, MapStats } from "@df/domain";
import { getJson, Throttle, type Fetched } from "./http.js";

const BASE = "https://api.opendota.com/api";

export interface ODLeagueMatch { match_id: number; start_time: number; duration: number; radiant_team_id?: number | null; dire_team_id?: number | null; series_id?: number | null }
export interface ODPlayer {
  account_id: number | null; isRadiant: boolean; hero_id: number; name?: string | null; personaname?: string | null;
  kills: number; deaths: number; assists: number; last_hits: number; denies: number;
  gold_per_min?: number | null; xp_per_min?: number | null; net_worth?: number | null;
  hero_damage?: number | null; tower_damage?: number | null; hero_healing?: number | null;
  stuns?: number | null; obs_placed?: number | null; observer_kills?: number | null; camps_stacked?: number | null;
}
export interface ODTeam { team_id: number; name: string; tag: string }
export interface ODMatch {
  match_id: number; leagueid: number; start_time: number; duration: number; radiant_win: boolean; version?: number | null;
  series_id?: number | null; series_type?: number | null;
  radiant_team_id?: number | null; dire_team_id?: number | null; radiant_team?: ODTeam | null; dire_team?: ODTeam | null;
  picks_bans?: Array<{ is_pick: boolean; hero_id: number; team: 0 | 1; order: number }> | null;
  players: ODPlayer[];
}

export class OpenDota {
  constructor(private readonly throttle = new Throttle(1100)) {}
  leagueMatches(leagueId: number): Promise<Fetched<ODLeagueMatch[]>> { return getJson(`${BASE}/leagues/${leagueId}/matches`, this.throttle); }
  match(matchId: number): Promise<Fetched<ODMatch>> { return getJson(`${BASE}/matches/${matchId}`, this.throttle); }
  /** Заказать разбор реплея (5–15 мин). */
  requestParse(matchId: number): Promise<Fetched<unknown>> { return getJson(`${BASE}/request/${matchId}`, this.throttle, { method: "POST" }); }
}

export interface NormPlayer {
  accountId: number; nickname: string; isRadiant: boolean; heroId: number;
  stats: MapStats & { denies: number; gpm: number | null; xpm: number | null; net_worth: number | null; hero_damage: number | null };
}
export interface NormMap {
  dotaMatchId: number; leagueId: number; seriesExtId: number | null; bestOf: number;
  startedAt: Date; endedAt: Date; durationS: number; radiantWin: boolean; tier: DataTier;
  radiant: ODTeam | null; dire: ODTeam | null;
  draft: Array<{ orderNo: number; isRadiant: boolean; heroId: number; isPick: boolean }>;
  players: NormPlayer[];
}

/** OpenDota series_type: 0 — Bo1, 1 — Bo3, 2 — Bo5; null — неизвестно (считаем Bo1). */
const BEST_OF: Record<number, number> = { 0: 1, 1: 3, 2: 5 };

export function normalizeMatch(m: ODMatch): NormMap {
  const parsed = m.version != null;
  const team = (t: ODTeam | null | undefined, id: number | null | undefined) => (t ?? (id ? { team_id: id, name: String(id), tag: "" } : null));
  return {
    dotaMatchId: m.match_id, leagueId: m.leagueid, seriesExtId: m.series_id || null, bestOf: BEST_OF[m.series_type ?? 0] ?? 1,
    startedAt: new Date(m.start_time * 1000), endedAt: new Date((m.start_time + m.duration) * 1000), durationS: m.duration,
    radiantWin: m.radiant_win, tier: parsed ? "parsed" : "basic",
    radiant: team(m.radiant_team, m.radiant_team_id), dire: team(m.dire_team, m.dire_team_id),
    draft: (m.picks_bans ?? []).map((d) => ({ orderNo: d.order, isRadiant: d.team === 0, heroId: d.hero_id, isPick: d.is_pick })),
    players: m.players.filter((p) => p.account_id).map((p) => ({
      accountId: p.account_id!, nickname: p.name || p.personaname || String(p.account_id), isRadiant: p.isRadiant, heroId: p.hero_id,
      stats: {
        kills: p.kills, deaths: p.deaths, assists: p.assists, last_hits: p.last_hits, denies: p.denies,
        gpm: p.gold_per_min ?? null, xpm: p.xp_per_min ?? null, net_worth: p.net_worth ?? null, hero_damage: p.hero_damage ?? null,
        won: p.isRadiant === m.radiant_win, building_damage: p.tower_damage ?? null, healing: p.hero_healing ?? null,
        // поля разбора: до разбора — null (неизвестно), а не 0
        stun_s: parsed ? p.stuns ?? 0 : null, obs_placed: parsed ? p.obs_placed ?? 0 : null,
        obs_killed: parsed ? p.observer_kills ?? 0 : null, camps_stacked: parsed ? p.camps_stacked ?? 0 : null,
      },
    })),
  };
}
