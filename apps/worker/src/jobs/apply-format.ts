// Регламент турнира (packages/db/tournaments/<slug>.json) → stages, stage_groups, tournament_teams, series (узлы сетки и переходы).
// Файл готовится руками до старта (по анонсу организатора / Liquipedia) и дополняется по ходу турнира: команды плей-офф,
// итоговые места. Применять можно сколько угодно раз — идемпотентно.
//   До старта: узлы сетки создаются заранее (status scheduled), ingest потом приклеивает к ним карты.
//   После старта: серии, которые ingest уже создал сам, находятся по паре команд и окну стадии и занимают свой узел.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { addRef } from "../refs.js";
import { recomputeSeries } from "./ingest-opendota.js";

export interface FormatStage {
  idx: number; name: string; format: "gsl" | "swiss" | "round_robin" | "double_elim" | "single_elim";
  from: string; to: string; deadline?: string; note?: string; groups?: Record<string, string[]>;
}
export interface FormatSeries {
  key: string; stage: number; group?: string; label: string; side?: "group" | "upper" | "lower" | "final";
  round?: number; bo: 1 | 2 | 3 | 5; teams?: [string | null, string | null]; at?: string; win?: string; lose?: string;
}
/** Турнир целиком из регламента — для турниров, которых нет в сидах (рейтинговые TI, Wallachia… и будущие). */
export interface FormatTournament {
  name: string; opendota_league_id: number; organizer: { slug: string; name: string };
  status: "announced" | "open" | "live" | "finished"; tier?: number; location?: string; prize_usd?: number;
  /** false — турнир только для рейтинга игроков (docs/12), без фэнтези: пул без цен */
  fantasy: boolean; ruleset?: string;
}
export interface TournamentFormat {
  slug: string; source: string; utc_offset: string; tournament?: FormatTournament; stages: FormatStage[]; series: FormatSeries[];
  standings?: Record<string, { place?: number; out_after?: number }>;
}
export interface FormatResult { stages: number; groups: number; matched: number; adopted: number; created: number; unplaced: string[] }

const DIR = new URL("../../../../packages/db/tournaments/", import.meta.url);

export function loadFormat(slug: string, file?: string): TournamentFormat {
  const f = JSON.parse(readFileSync(file ?? fileURLToPath(new URL(`${slug}.json`, DIR)), "utf8")) as TournamentFormat;
  const err: string[] = [], keys = new Set<string>(), idxs = new Set(f.stages.map((st) => st.idx));
  if (f.slug !== slug) err.push(`slug в файле ${f.slug}, ожидался ${slug}`);
  for (const sr of f.series) {
    if (keys.has(sr.key)) err.push(`ключ ${sr.key} повторяется`);
    keys.add(sr.key);
    if (!idxs.has(sr.stage)) err.push(`${sr.key}: нет стадии ${sr.stage}`);
    if (sr.group && !f.stages.find((st) => st.idx === sr.stage)?.groups?.[sr.group]) err.push(`${sr.key}: нет группы ${sr.group}`);
  }
  for (const sr of f.series) for (const k of [sr.win, sr.lose]) if (k && !keys.has(k)) err.push(`${sr.key}: переход в несуществующий ${k}`);
  if (err.length) throw new Error(`регламент ${slug}:\n  ${err.join("\n  ")}`);
  return f;
}

export async function applyFormat(db: Db, f: TournamentFormat): Promise<FormatResult> {
  const at = (d: string, time = "00:00:00") => new Date(`${d}T${time}${f.utc_offset}`);
  if (f.tournament) await upsertTournament(db, f, at);
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, f.slug));
  if (!tour) throw new Error(`турнир ${f.slug} не найден (нет в сидах и нет блока tournament в регламенте)`);

  const tags = new Set<string>([...f.series.flatMap((x) => x.teams ?? []), ...f.stages.flatMap((st) => Object.values(st.groups ?? {}).flat()),
    ...Object.keys(f.standings ?? {})].filter((t): t is string => !!t));
  const teamRows = tags.size ? await db.select({ id: s.teams.id, tag: s.teams.tag }).from(s.teams).where(inArray(s.teams.tag, [...tags])) : [];
  const team = new Map(teamRows.map((r) => [r.tag, r.id]));
  const missing = [...tags].filter((t) => !team.has(t));
  if (missing.length) throw new Error(`нет команд с тегами: ${missing.join(", ")}`);

  return db.transaction(async (tx) => {
    const res: FormatResult = { stages: 0, groups: 0, matched: 0, adopted: 0, created: 0, unplaced: [] };

    // --- стадии и группы
    const stageId = new Map<number, number>(), groupId = new Map<string, number>();
    for (const st of f.stages) {
      const v = { name: st.name, format: st.format, startsAt: at(st.from), endsAt: at(st.to, "23:59:59"), deadlineAt: st.deadline ? new Date(st.deadline) : null };
      const [row] = await tx.insert(s.stages).values({ tournamentId: tour.id, idx: st.idx, status: "upcoming", ...v })
        .onConflictDoUpdate({ target: [s.stages.tournamentId, s.stages.idx], set: v }).returning({ id: s.stages.id });
      stageId.set(st.idx, row!.id); res.stages++;
      for (const [label, members] of Object.entries(st.groups ?? {})) {
        const [g] = await tx.select({ id: s.stageGroups.id }).from(s.stageGroups).where(and(eq(s.stageGroups.stageId, row!.id), eq(s.stageGroups.label, label)));
        const gid = g?.id ?? (await tx.insert(s.stageGroups).values({ stageId: row!.id, label }).returning({ id: s.stageGroups.id }))[0]!.id;
        groupId.set(`${st.idx}:${label}`, gid); res.groups++;
        for (const tag of members)
          await tx.insert(s.tournamentTeams).values({ tournamentId: tour.id, teamId: team.get(tag)!, groupId: gid, status: "active" })
            .onConflictDoUpdate({ target: [s.tournamentTeams.tournamentId, s.tournamentTeams.teamId], set: { groupId: gid } });
      }
    }

    // --- узлы сетки
    // в сыром SQL драйвер отдаёт bigint и timestamptz строками — приводим здесь же: id числом, время — секундами эпохи
    const existing = (await tx.execute<{ id: number; a: number | null; b: number | null; started: number | null; maps: number }>(sql`
      select sr.id::int id, sr.team_a_id::int a, sr.team_b_id::int b, extract(epoch from sr.started_at)::float8 started,
        (select count(*)::int from maps m where m.series_id = sr.id) maps
      from series sr where sr.tournament_id = ${tour.id} order by sr.started_at nulls last, sr.id`)).rows;
    const pair = (a: number | null, b: number | null) => (a && b ? `${Math.min(a, b)}-${Math.max(a, b)}` : null);
    const claimed = new Set<number>(), seriesId = new Map<string, number>();
    const slotNo = new Map<string, number>();

    for (const x of f.series) {
      const st = f.stages.find((y) => y.idx === x.stage)!;
      const [ta, tb] = (x.teams ?? [null, null]).map((t) => (t ? team.get(t)! : null)) as [number | null, number | null];
      // серия, сыгранная этими командами в окне стадии; одна и та же пара в стадии (GSL: стартовый и решающий) — по порядку в файле
      const p = pair(ta, tb), from = at(st.from).getTime() / 1000, to = at(st.to, "23:59:59").getTime() / 1000;
      const cand = p ? existing.find((e) => !claimed.has(e.id) && pair(e.a, e.b) === p && e.maps > 0 && e.started != null && e.started >= from && e.started <= to) : undefined;
      const [node] = await tx.select({ id: s.series.id }).from(s.series)
        .where(and(eq(s.series.tournamentId, tour.id), eq(s.series.bracketKey, x.key)));
      let id = node?.id;
      if (id && cand && cand.id !== id) {
        // узел заводили заранее пустым, а ingest создал серию сам (команды плей-офф тогда были неизвестны) — узел занимает сыгранная
        const own = existing.find((e) => e.id === id);
        if (own && own.maps > 0) throw new Error(`${x.key}: у узла уже есть карты (серия ${id}), а сыгранная серия ${cand.id} — другая`);
        await tx.execute(sql`update series set next_win_series_id = null where next_win_series_id = ${id}`);
        await tx.execute(sql`update series set next_lose_series_id = null where next_lose_series_id = ${id}`);
        await tx.delete(s.externalRefs).where(and(eq(s.externalRefs.entityType, "series"), eq(s.externalRefs.entityId, id)));
        await tx.delete(s.series).where(eq(s.series.id, id));
        id = cand.id; res.adopted++;
      } else if (!id && cand) {
        id = cand.id; res.matched++;
      } else if (!id) {
        const [row] = await tx.insert(s.series).values({ tournamentId: tour.id, stageId: stageId.get(x.stage)!, roundLabel: x.label,
          bracketKey: x.key, bestOf: x.bo, status: "scheduled" }).returning({ id: s.series.id });
        id = row!.id; res.created++;
      } else res.matched++;
      claimed.add(id); seriesId.set(x.key, id);

      const slotKey = `${x.stage}:${x.side ?? "-"}:${x.round ?? 0}:${x.group ?? "-"}`;
      slotNo.set(slotKey, (slotNo.get(slotKey) ?? 0) + 1);
      const teamsKnown = ta && tb;
      await tx.update(s.series).set({
        stageId: stageId.get(x.stage)!, groupId: x.group ? groupId.get(`${x.stage}:${x.group}`)! : null,
        roundLabel: x.label, bracketKey: x.key, bracketSide: x.side ?? null, roundNo: x.round ?? null, slot: slotNo.get(slotKey)!, bestOf: x.bo,
        ...(teamsKnown ? { teamAId: ta, teamBId: tb } : {}), ...(x.at ? { scheduledAt: new Date(x.at) } : {}),
      }).where(eq(s.series.id, id));
    }
    for (const x of f.series)
      await tx.update(s.series).set({ nextWinSeriesId: x.win ? seriesId.get(x.win)! : null, nextLoseSeriesId: x.lose ? seriesId.get(x.lose)! : null })
        .where(eq(s.series.id, seriesId.get(x.key)!));

    // сыгранные серии, которым в регламенте не нашлось узла — их надо разметить руками (дописать узел в файл).
    // Регламент без сетки (рейтинговый турнир: только стадии) — серии раскладываются по стадиям по времени, без узлов.
    if (f.series.length) res.unplaced = (await tx.execute<{ label: string }>(sql`
      select coalesce(ta.tag, '?') || '–' || coalesce(tb.tag, '?') || ' ' || to_char(sr.started_at at time zone 'UTC', 'DD.MM HH24:MI UTC')
        || ' (серия ' || sr.id || ')' as label
      from series sr left join teams ta on ta.id = sr.team_a_id left join teams tb on tb.id = sr.team_b_id
      where sr.tournament_id = ${tour.id} and sr.bracket_key is null order by sr.started_at`)).rows.map((r) => r.label);

    // без сетки серии уже лежат в стадиях по времени карт (ingest), но стадии могли переопределить — переложить по окнам
    if (!f.series.length) await tx.execute(sql`
      update series sr set stage_id = st.id from stages st
      where sr.tournament_id = ${tour.id} and st.tournament_id = ${tour.id}
        and sr.started_at between st.starts_at and st.ends_at and sr.stage_id <> st.id`);

    // счёт — заново из карт (порядок команд в узле мог поменяться); дедлайн стадии = начало первой карты (02 §2),
    // до игр — время первой серии по расписанию или явный deadline из файла
    await recomputeSeries(tx, tour.id);
    await tx.execute(sql`
      update stages st set deadline_at = coalesce(
        (select min(m.started_at) from maps m join series sr on sr.id = m.series_id where sr.stage_id = st.id),
        (select min(sr.scheduled_at) from series sr where sr.stage_id = st.id), st.deadline_at)
      where st.tournament_id = ${tour.id}`);

    // итог: места и вылет по стадиям
    for (const [tag, v] of Object.entries(f.standings ?? {})) {
      const out = v.out_after != null ? stageId.get(v.out_after)! : null;
      await tx.update(s.tournamentTeams).set({ finalPlace: v.place ?? null, eliminatedAfterStageId: out, status: out ? "eliminated" : "active" })
        .where(and(eq(s.tournamentTeams.tournamentId, tour.id), eq(s.tournamentTeams.teamId, team.get(tag)!)));
    }
    return res;
  });
}

/** Турнир из блока tournament регламента: создать или обновить, плюс ссылка на лигу OpenDota (по ней ingest берёт карты).
 *  Конфиг турнира дополняется (fantasy, note), а не затирается — у турниров из сидов там правила Классики. */
async function upsertTournament(db: Db, f: TournamentFormat, at: (d: string, time?: string) => Date) {
  const t = f.tournament!;
  const [org] = await db.insert(s.organizers).values({ name: t.organizer.name, slug: t.organizer.slug })
    .onConflictDoUpdate({ target: s.organizers.slug, set: { name: t.organizer.name } }).returning({ id: s.organizers.id });
  const version = t.ruleset ?? "2026.10-spec";
  const [rs] = await db.select({ id: s.scoringRulesets.id }).from(s.scoringRulesets).where(eq(s.scoringRulesets.version, version));
  if (!rs) throw new Error(`нет правил очков ${version} (pnpm db:seed)`);
  const first = f.stages.reduce((a, b) => (a.from < b.from ? a : b)), last = f.stages.reduce((a, b) => (a.to > b.to ? a : b));
  const cfg = { fantasy: t.fantasy, note: `регламент: ${f.source}` };
  const v = { name: t.name, organizerId: org!.id, tier: t.tier ?? 1, location: t.location ?? null, prizePoolUsd: t.prize_usd ?? null,
    startsAt: at(first.from), endsAt: at(last.to, "23:59:59"), status: t.status };
  const [row] = await db.insert(s.tournaments).values({ slug: f.slug, ...v, isLeagueRound: false, scoringRulesetId: rs.id, config: cfg })
    .onConflictDoUpdate({ target: s.tournaments.slug, set: { ...v, config: sql`${s.tournaments.config} || ${JSON.stringify(cfg)}::jsonb` } })
    .returning({ id: s.tournaments.id });
  await addRef(db, "league", row!.id, "opendota", t.opendota_league_id, `https://www.opendota.com/leagues/${t.opendota_league_id}`);
}
