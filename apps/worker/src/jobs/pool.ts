// Пул игроков турнира по картам (docs/12 §5): позиция — самая частая по картам (линия + net worth, domain/positions).
// Турнир только для рейтинга (config.fantasy = false): пул пишется в tournament_players без цен.
// Турнир с нашей заявкой (Slam): пул не трогаем, только сверяем найденные позиции с заявкой — проверка способа.
import { eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { inferPositions, modePosition, type Position } from "@df/domain";

export interface PoolRow { playerId: number; nickname: string; team: string; maps: number; position: Position; share: number; registered: Position | null }
export interface PoolResult { written: number; rows: PoolRow[] }

export async function buildPool(db: Db, slug: string): Promise<PoolResult> {
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, slug));
  if (!tour) throw new Error(`турнир ${slug} не найден`);
  const ratingOnly = (tour.config as { fantasy?: boolean }).fantasy === false;

  const rows = (await db.execute<{ map_id: number; player_id: number; team_id: number; nw: number | null; lane: number | null }>(sql`
    select pms.map_id::int, pms.player_id::int, pms.team_id::int, pms.net_worth nw, (pms.extra ->> 'lane_role')::int lane
    from player_map_stats pms join maps m on m.id = pms.map_id and m.status = 'finished'
    join series sr on sr.id = m.series_id and sr.tournament_id = ${tour.id}`)).rows;

  // позиции по каждой карте: пятёрка одной команды на одной карте
  const byTeamMap = new Map<string, typeof rows>();
  for (const r of rows) { const k = `${r.map_id}:${r.team_id}`; byTeamMap.set(k, [...(byTeamMap.get(k) ?? []), r]); }
  const perPlayer = new Map<number, { positions: Position[]; teams: Map<number, number> }>();
  for (const five of byTeamMap.values()) {
    const pos = inferPositions(five.map((r) => ({ key: r.player_id, laneRole: r.lane, netWorth: r.nw ?? 0 })));
    for (const r of five) {
      const p = pos.get(r.player_id); if (!p) continue;
      const e = perPlayer.get(r.player_id) ?? { positions: [] as Position[], teams: new Map<number, number>() };
      e.positions.push(p); e.teams.set(r.team_id, (e.teams.get(r.team_id) ?? 0) + 1);
      perPlayer.set(r.player_id, e);
    }
  }

  const names = new Map((await db.execute<{ id: number; nick: string }>(sql`select id::int, nickname nick from players`)).rows.map((r) => [r.id, r.nick]));
  const tags = new Map((await db.execute<{ id: number; tag: string }>(sql`select id::int, tag from teams`)).rows.map((r) => [r.id, r.tag]));
  const registered = new Map((await db.execute<{ player_id: number; position: number }>(sql`
    select player_id::int, position from tournament_players where tournament_id = ${tour.id}`)).rows.map((r) => [r.player_id, r.position as Position]));

  const out: PoolRow[] = [];
  for (const [playerId, e] of perPlayer) {
    const m = modePosition(e.positions)!;
    const teamId = [...e.teams.entries()].sort((a, b) => b[1] - a[1])[0]![0];
    out.push({ playerId, nickname: names.get(playerId) ?? String(playerId), team: tags.get(teamId) ?? String(teamId), maps: e.positions.length,
      position: m.position, share: m.share, registered: registered.get(playerId) ?? null });
    if (ratingOnly)
      await db.insert(s.tournamentPlayers).values({ tournamentId: tour.id, playerId, teamId, position: m.position, isActive: true, startPrice: null })
        .onConflictDoUpdate({ target: [s.tournamentPlayers.tournamentId, s.tournamentPlayers.playerId], set: { teamId, position: m.position } });
  }
  out.sort((a, b) => a.team.localeCompare(b.team) || a.position - b.position);
  return { written: ratingOnly ? out.length : 0, rows: out };
}
