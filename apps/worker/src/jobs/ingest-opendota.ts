// ingest-opendota (docs/11): матчи лиги турнира → series / maps / player_map_stats / map_draft + raw_payloads.
// Идемпотентно: разобранную карту повторно не тянем; неразобранную перезапрашиваем, пока OpenDota не разберёт реплей.
import { and, asc, eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { normalizeMatch, OpenDota, type NormMap, type ODTeam } from "@df/sources";
import { saveRaw } from "../raw.js";
import { addRef, findRef } from "../refs.js";

/** Карты одной серии идут подряд; между сериями одних и тех же команд на турнире — дни. */
const SERIES_GAP_S = 4 * 3600;

export interface IngestOptions { force?: boolean; requestParse?: boolean; log?: (m: string) => void }
export interface IngestResult { seen: number; changed: number; parsed: number; requested: number }

export async function ingestOpenDota(db: Db, tournamentSlug: string, opts: IngestOptions = {}, od = new OpenDota()): Promise<IngestResult> {
  const log = opts.log ?? (() => {});
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, tournamentSlug));
  if (!tour) throw new Error(`турнир ${tournamentSlug} не найден`);
  const [league] = await db.select({ ext: s.externalRefs.externalId }).from(s.externalRefs)
    .where(and(eq(s.externalRefs.entityType, "league"), eq(s.externalRefs.provider, "opendota"), eq(s.externalRefs.entityId, tour.id)));
  if (!league) throw new Error(`у турнира ${tournamentSlug} нет ссылки на лигу OpenDota`);
  const leagueId = Number(league.ext);

  const [run] = await db.insert(s.ingestRuns).values({ job: "ingest-opendota", provider: "opendota", startedAt: new Date(), status: "partial" })
    .returning({ id: s.ingestRuns.id });
  const res: IngestResult = { seen: 0, changed: 0, parsed: 0, requested: 0 };
  try {
    const list = await od.leagueMatches(leagueId);
    await saveRaw(db, "opendota", "league_matches", String(leagueId), list);
    const stageId = await defaultStage(db, tour.id);
    for (const lm of list.body.sort((a, b) => a.start_time - b.start_time)) {
      res.seen++;
      const [have] = await db.select({ tier: s.maps.dataTier }).from(s.maps).where(eq(s.maps.dotaMatchId, lm.match_id));
      if (have?.tier === "parsed" && !opts.force) { res.parsed++; continue; }
      const f = await od.match(lm.match_id);
      await saveRaw(db, "opendota", "match", String(lm.match_id), f);
      const m = normalizeMatch(f.body);
      await db.transaction((tx) => upsertMap(tx, tour.id, stageId, m));
      res.changed++;
      if (m.tier === "parsed") res.parsed++;
      else if (opts.requestParse && Date.now() - m.endedAt.getTime() > 15 * 60_000) {
        await od.requestParse(m.dotaMatchId).catch(() => null); res.requested++;
      }
      log(`${m.dotaMatchId} ${m.radiant?.tag || "?"}–${m.dire?.tag || "?"} ${m.tier}`);
    }
    await recomputeSeries(db, tour.id);
    await db.update(s.ingestRuns).set({ status: "ok", finishedAt: new Date(), itemsSeen: res.seen, itemsChanged: res.changed }).where(eq(s.ingestRuns.id, run!.id));
    return res;
  } catch (e) {
    await db.update(s.ingestRuns).set({ status: "failed", finishedAt: new Date(), itemsSeen: res.seen, itemsChanged: res.changed, error: String(e) })
      .where(eq(s.ingestRuns.id, run!.id));
    throw e;
  }
}

/** Турнир без размеченных стадий (Slam VIII — полигон): одна стадия на все карты. Разметку стадий даст Liquipedia/админка. */
async function defaultStage(db: Db, tournamentId: number): Promise<number> {
  const [st] = await db.select({ id: s.stages.id }).from(s.stages).where(eq(s.stages.tournamentId, tournamentId)).orderBy(asc(s.stages.idx)).limit(1);
  if (st) return st.id;
  const [n] = await db.insert(s.stages).values({ tournamentId, idx: 0, name: "Все карты (стадии не размечены)", format: "single_elim", status: "open" })
    .returning({ id: s.stages.id });
  return n!.id;
}

async function teamId(db: Db, t: ODTeam | null): Promise<number | null> {
  if (!t) return null;
  const known = await findRef(db, "team", "steam", t.team_id);
  if (known) return known;
  const [row] = await db.insert(s.teams).values({ name: t.name, tag: t.tag || t.name.slice(0, 4).toUpperCase() }).returning({ id: s.teams.id });
  await addRef(db, "team", row!.id, "steam", t.team_id);
  return row!.id;
}

async function playerId(db: Db, accountId: number, nickname: string): Promise<number> {
  const [p] = await db.select({ id: s.players.id }).from(s.players).where(eq(s.players.steamAccountId, accountId));
  if (p) return p.id;
  // не из пула (стендин и т.п.): заводим в каталог по account_id, ник — из матча
  const [n] = await db.insert(s.players).values({ nickname, steamAccountId: accountId }).returning({ id: s.players.id });
  return n!.id;
}

async function upsertMap(db: Db, tournamentId: number, stageId: number, m: NormMap) {
  const radiantId = await teamId(db, m.radiant), direId = await teamId(db, m.dire);
  const winnerId = m.radiantWin ? radiantId : direId;

  // серия: по series_id OpenDota. У части карт его нет (на Slam VIII — 2 из 60), и Bo3 разваливается на куски,
  // поэтому без ссылки ищем серию тех же двух команд в пределах SERIES_GAP от этой карты и приклеиваем к ней.
  let seriesId = m.seriesExtId ? await findRef(db, "series", "opendota", m.seriesExtId) : null;
  if (!seriesId && radiantId && direId) {
    const [near] = await db.execute<{ id: number }>(sql`
      select sr.id from series sr
      where sr.tournament_id = ${tournamentId}
        and least(sr.team_a_id, sr.team_b_id) = ${Math.min(radiantId, direId)} and greatest(sr.team_a_id, sr.team_b_id) = ${Math.max(radiantId, direId)}
        and exists (select 1 from maps mp where mp.series_id = sr.id and abs(extract(epoch from mp.started_at - ${m.startedAt.toISOString()}::timestamptz)) < ${SERIES_GAP_S})
      order by sr.id limit 1`).then((r) => r.rows);
    if (near) {
      seriesId = near.id;
      if (m.seriesExtId) { // у карты есть настоящий series_id — он же даёт формат серии
        await addRef(db, "series", seriesId, "opendota", m.seriesExtId);
        await db.update(s.series).set({ bestOf: m.bestOf }).where(eq(s.series.id, seriesId));
      }
    }
  }
  if (!seriesId) {
    const [sr] = await db.insert(s.series).values({ tournamentId, stageId, roundLabel: "—", bestOf: m.bestOf,
      teamAId: radiantId, teamBId: direId, status: "live", startedAt: m.startedAt }).returning({ id: s.series.id });
    seriesId = sr!.id;
    await addRef(db, "series", seriesId, "opendota", m.seriesExtId ?? `match:${m.dotaMatchId}`);
  }

  const [existing] = await db.select({ id: s.maps.id }).from(s.maps).where(eq(s.maps.dotaMatchId, m.dotaMatchId));
  const mapVals = { radiantTeamId: radiantId, direTeamId: direId, winnerTeamId: winnerId, durationS: m.durationS,
    startedAt: m.startedAt, endedAt: m.endedAt, status: "finished", dataTier: m.tier, parsedAt: m.tier === "parsed" ? new Date() : null };
  let mapId: number;
  if (existing) {
    mapId = existing.id;
    await db.update(s.maps).set(mapVals).where(eq(s.maps.id, mapId));
  } else {
    const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(s.maps).where(eq(s.maps.seriesId, seriesId))) as [{ n: number }];
    const [row] = await db.insert(s.maps).values({ seriesId, mapNo: n + 1, dotaMatchId: m.dotaMatchId, ...mapVals }).returning({ id: s.maps.id });
    mapId = row!.id;
    await addRef(db, "map", mapId, "opendota", m.dotaMatchId, `https://www.opendota.com/matches/${m.dotaMatchId}`);
  }

  for (const d of m.draft) {
    const tId = d.isRadiant ? radiantId : direId;
    if (!tId) continue;
    await db.insert(s.mapDraft).values({ mapId, orderNo: d.orderNo, teamId: tId, heroId: d.heroId, isPick: d.isPick })
      .onConflictDoUpdate({ target: [s.mapDraft.mapId, s.mapDraft.orderNo], set: { teamId: tId, heroId: d.heroId, isPick: d.isPick } });
  }

  for (const p of m.players) {
    const tId = p.isRadiant ? radiantId : direId;
    if (!tId) continue;
    const pid = await playerId(db, p.accountId, p.nickname);
    const st = p.stats;
    const v = {
      teamId: tId, heroId: p.heroId, isRadiant: p.isRadiant, won: st.won ?? null,
      kills: st.kills, deaths: st.deaths, assists: st.assists, lastHits: st.last_hits, denies: st.denies,
      gpm: st.gpm, xpm: st.xpm, netWorth: st.net_worth, heroDamage: st.hero_damage,
      buildingDamage: st.building_damage ?? null, heroHealing: st.healing ?? null,
      obsPlaced: st.obs_placed ?? null, obsKilled: st.obs_killed ?? null,
      stunS: st.stun_s == null ? null : st.stun_s.toFixed(1), campsStacked: st.camps_stacked ?? null,
      dataTier: m.tier, updatedAt: new Date(),
    };
    await db.insert(s.playerMapStats).values({ mapId, playerId: pid, ...v })
      .onConflictDoUpdate({ target: [s.playerMapStats.mapId, s.playerMapStats.playerId], set: v });
  }
}

/** Счёт и победитель серий — из карт (set-based). Серия завершена, когда кто-то набрал большинство при её best_of. */
export async function recomputeSeries(db: Db, tournamentId: number) {
  await db.execute(sql`
    update series sr set
      score_a = x.a, score_b = x.b,
      winner_team_id = case when x.a * 2 > sr.best_of then sr.team_a_id when x.b * 2 > sr.best_of then sr.team_b_id end,
      status = case when x.a * 2 > sr.best_of or x.b * 2 > sr.best_of then 'finished' else sr.status end,
      started_at = x.started, finished_at = case when x.a * 2 > sr.best_of or x.b * 2 > sr.best_of then x.ended end
    from (
      select m.series_id,
        count(*) filter (where m.winner_team_id = s2.team_a_id)::smallint a,
        count(*) filter (where m.winner_team_id = s2.team_b_id)::smallint b,
        min(m.started_at) started, max(m.ended_at) ended
      from maps m join series s2 on s2.id = m.series_id
      where s2.tournament_id = ${tournamentId} and m.status = 'finished'
      group by m.series_id
    ) x
    where sr.id = x.series_id`);
}
