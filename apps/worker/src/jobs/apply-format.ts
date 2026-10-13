// Регламент турнира (packages/db/tournaments/<slug>.json) → stages, stage_groups, tournament_teams, series (узлы сетки и переходы).
// Файл готовится руками до старта (по анонсу организатора / Liquipedia) и дополняется по ходу турнира: команды плей-офф,
// итоговые места. Применять можно сколько угодно раз — идемпотентно.
//   До старта: узлы сетки создаются заранее (status scheduled), ingest потом приклеивает к ним карты.
//   После старта: серии, которые ingest уже создал сам, находятся по паре команд и окну стадии и занимают свой узел.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, sql } from "drizzle-orm";
import { schema as s, type Db } from "@df/db";
import { addRef, findRef } from "../refs.js";
import { recomputeSeries } from "./ingest-opendota.js";

export interface FormatStage {
  idx: number; name: string; format: "gsl" | "swiss" | "round_robin" | "double_elim" | "single_elim";
  /** окно стадии; нет даты — организатор её ещё не объявил (окно открыто с этой стороны, сбор карт по нему не раскладывает) */
  from?: string; to?: string; deadline?: string; note?: string; groups?: Record<string, string[]>;
}
export interface FormatSeries {
  key: string; stage: number; group?: string; label: string; side?: "group" | "upper" | "lower" | "final";
  round?: number; bo: 1 | 2 | 3 | 5; teams?: [string | null, string | null]; at?: string; win?: string; lose?: string;
}
/** Турнир целиком из регламента — для турниров, которых нет в сидах (рейтинговые TI, Wallachia… и будущие). */
export interface FormatTournament {
  /** ID лиги в Dota 2 (по нему ingest берёт карты); у анонсированного турнира его может ещё не быть */
  name: string; opendota_league_id?: number; organizer: { slug: string; name: string };
  status: "announced" | "open" | "live" | "finished"; tier?: number; location?: string; prize_usd?: number;
  /** false — турнир только для рейтинга игроков (docs/12), без фэнтези: пул без цен */
  fantasy: boolean; ruleset?: string;
  /** даты турнира, если у стадий их ещё нет (иначе — от первой до последней стадии) */
  starts?: string; ends?: string;
}
/** Команда, которой может не быть в базе (новый состав, ещё без карт): заводится по тегу, ссылка на Steam — для ingest */
export interface FormatTeam { tag: string; name: string; steam_team_id?: number }
/** Игрок заявки: позиция по странице команды / анонсу; аккаунт Steam — по матчам */
export interface FormatRosterPlayer { pos: 1 | 2 | 3 | 4 | 5; nick: string; acc: number }
export interface TournamentFormat {
  slug: string; source: string; utc_offset: string; tournament?: FormatTournament; stages: FormatStage[]; series: FormatSeries[];
  teams?: FormatTeam[];
  /** участники до жеребьёвки (без групп); группы, если известны, — в stages[].groups */
  participants?: string[];
  /** заявки команд (tournament_players); команды нет в списке — состав не объявлен */
  rosters?: Record<string, FormatRosterPlayer[]>;
  standings?: Record<string, { place?: number; out_after?: number }>;
}
export interface FormatResult { stages: number; groups: number; matched: number; adopted: number; created: number; unplaced: string[]; teams: string[]; players: number }

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
  for (const [tag, ps] of Object.entries(f.rosters ?? {})) {
    const pos = ps.map((p) => p.pos);
    if (new Set(pos).size !== pos.length) err.push(`заявка ${tag}: позиции повторяются`);
    if (ps.some((p) => !Number.isInteger(p.acc) || p.acc <= 0)) err.push(`заявка ${tag}: нет аккаунта Steam у игрока`);
  }
  if (!f.stages.some((st) => st.from) && !f.tournament?.starts) err.push("нет даты начала: ни у одной стадии нет from, у турнира нет starts");
  if (err.length) throw new Error(`регламент ${slug}:\n  ${err.join("\n  ")}`);
  return f;
}

export async function applyFormat(db: Db, f: TournamentFormat): Promise<FormatResult> {
  const at = (d: string, time = "00:00:00") => new Date(`${d}T${time}${f.utc_offset}`);
  const atOpt = (d: string | undefined, time?: string) => (d ? at(d, time) : null);
  if (f.tournament) await upsertTournament(db, f, at);
  const [tour] = await db.select().from(s.tournaments).where(eq(s.tournaments.slug, f.slug));
  if (!tour) throw new Error(`турнир ${f.slug} не найден (нет в сидах и нет блока tournament в регламенте)`);
  const createdTeams = await ensureTeams(db, f.teams ?? []);

  const tags = new Set<string>([...f.series.flatMap((x) => x.teams ?? []), ...f.stages.flatMap((st) => Object.values(st.groups ?? {}).flat()),
    ...Object.keys(f.standings ?? {}), ...(f.participants ?? []), ...Object.keys(f.rosters ?? {})].filter((t): t is string => !!t));
  const team = await teamsByTag(db, [...tags]);
  const missing = [...tags].filter((t) => !team.has(t));
  if (missing.length) throw new Error(`нет команд с тегами: ${missing.join(", ")} (новую команду — в блок teams регламента)`);

  return db.transaction(async (tx) => {
    const res: FormatResult = { stages: 0, groups: 0, matched: 0, adopted: 0, created: 0, unplaced: [], teams: createdTeams, players: 0 };

    // --- участники до жеребьёвки (группа, если уже назначена, не трогается)
    for (const tag of f.participants ?? [])
      await tx.insert(s.tournamentTeams).values({ tournamentId: tour.id, teamId: team.get(tag)!, status: "active" }).onConflictDoNothing();

    // --- заявки: игрок по аккаунту Steam (нет в каталоге — заводим), позиция и команда — из файла; кого убрали из заявки — удаляем
    if (f.rosters) {
      const keep: number[] = [];
      for (const [tag, ps] of Object.entries(f.rosters)) for (const p of ps) {
        const [known] = await tx.select({ id: s.players.id }).from(s.players).where(eq(s.players.steamAccountId, p.acc));
        const playerId = known?.id ?? (await tx.insert(s.players).values({ nickname: p.nick, steamAccountId: p.acc }).returning({ id: s.players.id }))[0]!.id;
        await tx.insert(s.tournamentPlayers).values({ tournamentId: tour.id, playerId, teamId: team.get(tag)!, position: p.pos, isActive: true })
          .onConflictDoUpdate({ target: [s.tournamentPlayers.tournamentId, s.tournamentPlayers.playerId], set: { teamId: team.get(tag)!, position: p.pos, isActive: true } });
        keep.push(playerId); res.players++;
      }
      await tx.delete(s.tournamentPlayers).where(and(eq(s.tournamentPlayers.tournamentId, tour.id),
        keep.length ? sql`${s.tournamentPlayers.playerId} not in (${sql.join(keep.map((x) => sql`${x}`), sql`, `)})` : sql`true`));
    }

    // --- стадии и группы
    const stageId = new Map<number, number>(), groupId = new Map<string, number>();
    for (const st of f.stages) {
      const v = { name: st.name, format: st.format, startsAt: atOpt(st.from), endsAt: atOpt(st.to, "23:59:59"), deadlineAt: st.deadline ? new Date(st.deadline) : null };
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
      // окно стадии ещё не объявлено (нет from/to) — сыгранных серий в нём быть не может
      const p = st.from && st.to ? pair(ta, tb) : null;
      const from = st.from ? at(st.from).getTime() / 1000 : 0, to = st.to ? at(st.to, "23:59:59").getTime() / 1000 : 0;
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
  // даты турнира: явные starts/ends, иначе — от первой до последней объявленной даты стадий
  const froms = f.stages.flatMap((st) => (st.from ? [st.from] : [])).sort(), tos = f.stages.flatMap((st) => (st.to ? [st.to] : [])).sort();
  const starts = t.starts ?? froms[0], ends = t.ends ?? tos[tos.length - 1];
  const cfg = { fantasy: t.fantasy, note: `регламент: ${f.source}` };
  const v = { name: t.name, organizerId: org!.id, tier: t.tier ?? 1, location: t.location ?? null, prizePoolUsd: t.prize_usd ?? null,
    startsAt: starts ? at(starts) : null, endsAt: ends ? at(ends, "23:59:59") : null, status: t.status };
  const [row] = await db.insert(s.tournaments).values({ slug: f.slug, ...v, isLeagueRound: false, scoringRulesetId: rs.id, config: cfg })
    .onConflictDoUpdate({ target: s.tournaments.slug, set: { ...v, config: sql`${s.tournaments.config} || ${JSON.stringify(cfg)}::jsonb` } })
    .returning({ id: s.tournaments.id });
  if (t.opendota_league_id)
    await addRef(db, "league", row!.id, "opendota", t.opendota_league_id, `https://www.opendota.com/leagues/${t.opendota_league_id}`);
}

/** Новые команды из блока teams: команда с таким тегом уже есть — не трогаем; есть Steam ID, а команды по нему нет — заводим.
 *  Возвращает теги заведённых команд. */
async function ensureTeams(db: Db, list: FormatTeam[]): Promise<string[]> {
  const out: string[] = [];
  for (const t of list) {
    const bySteam = t.steam_team_id ? await findRef(db, "team", "steam", t.steam_team_id) : null;
    if (bySteam) { await db.update(s.teams).set({ tag: t.tag, name: t.name }).where(eq(s.teams.id, bySteam)); continue; }
    const [byTag] = await db.select({ id: s.teams.id }).from(s.teams).where(eq(s.teams.tag, t.tag));
    if (byTag) { if (t.steam_team_id) await addRef(db, "team", byTag.id, "steam", t.steam_team_id); continue; }
    const [row] = await db.insert(s.teams).values({ name: t.name, tag: t.tag }).returning({ id: s.teams.id });
    if (t.steam_team_id) await addRef(db, "team", row!.id, "steam", t.steam_team_id);
    out.push(t.tag);
  }
  return out;
}

/** Тег → команда. Тег не уникален (у LGD две команды в Steam: старая и с сентября 2026) — берём ту, что играла позже всех. */
async function teamsByTag(db: Db, tags: string[]): Promise<Map<string, number>> {
  if (!tags.length) return new Map();
  const rows = (await db.execute<{ id: number; tag: string }>(sql`
    select t.id::int, t.tag from teams t
    left join player_map_stats pms on pms.team_id = t.id left join maps m on m.id = pms.map_id
    where t.tag in (${sql.join(tags.map((x) => sql`${x}`), sql`, `)})
    group by t.id order by max(m.started_at) nulls first, t.id`)).rows;
  return new Map(rows.map((r) => [r.tag, r.id])); // по порядку: последняя запись тега — самая свежая команда
}
