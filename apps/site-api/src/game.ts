// Игра на сервере (Cloudflare Pages Functions + D1): фиксации составов, замены стендинов, прогнозы и таблица турнира.
// Источник правды для призовых турниров (решение автора 24.10.2026: BLAST Slam IX — с призами): сервер сам проверяет
// дедлайны, позиции, банк, лимит команд и трансферы и считает очки по живым данным — выгрузке live-feed (очки игроков
// по сериям, время старта серий, цены по стадиям). Браузер только показывает. Правила — docs/02 и docs/04;
// числа и режимы — в настройках турнира (tournaments.json → rules), по умолчанию — как в спеке.
export interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> }
export interface D1 { prepare(q: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }

interface FeedSeries { key: string; group: string | null; label: string; bo: number; a: string | null; b: string | null; at: string | null; start: string | null;
  status: "finished" | "live" | "scheduled"; wa: number; wb: number; pts: Record<string, number> }
interface FeedStage { idx: number; name: string; status: "finished" | "live" | "upcoming"; series: FeedSeries[] }
interface FeedPlayer { nick: string; team: string; position: number; start: { price: number }; stages: Array<{ pts: number; maps: number; missed?: number; price?: number }> }
export interface Feed {
  generated: string; stages: FeedStage[]; players: Record<string, FeedPlayer>;
  standings?: Record<string, Array<{ tag: string }>>; substitutions?: Array<{ out: number }>; live_now?: Array<{ a: string | null; b: string | null }>;
}
interface TourCfg { id: string; live?: string; live_remote?: string; rules?: Partial<Rules> }
/** правила турнира. late_lock — фиксация после старта стадии: deny — не принимать (спека, призовые турниры),
 *  full_stage — принять, очки за всю стадию (тест PARI), after_lock — принять, очки с момента фиксации.
 *  pick_close — когда закрываются прогнозы: stage — в дедлайн стадии (спека, docs/04), series — каждая серия в своё время (тест PARI) */
export interface Rules { budget: number; max_team: number; max_team_final: number; free_transfers: number; free_max: number; transfer_cost: number;
  captain: number; triple: number; late_lock: "deny" | "full_stage" | "after_lock"; pick_close: "stage" | "series" }
export const DEFAULT_RULES: Rules = { budget: 48, max_team: 2, max_team_final: 3, free_transfers: 1, free_max: 2, transfer_cost: 4, captain: 2, triple: 3,
  late_lock: "deny", pick_close: "stage" };
const ROLES = ["carry", "mid", "off", "soft", "hard"] as const;
type Role = (typeof ROLES)[number];
type Lineup = Record<Role, number>;

export class GameError extends Error { constructor(msg: string, public status = 409) { super(msg); } }
const r1 = (x: number) => Math.round(x * 10) / 10;
const EPS = 1e-9;

// ---------- данные турнира: настройки (tournaments.json) и живая выгрузка (ветка live-feed, иначе копия сайта);
// кэш в памяти воркера — 60 с (выгрузка обновляется раз в 3 минуты)
const MEM = new Map<string, { exp: number; v: unknown }>();
async function cached<T>(key: string, ttl: number, load: () => Promise<T | null>): Promise<T | null> {
  const m = MEM.get(key);
  if (m && m.exp > Date.now()) return m.v as T;
  const v = await load();
  if (v) MEM.set(key, { exp: Date.now() + ttl * 1000, v });
  return v;
}
/** таблица турнира пересчитывается сразу после фиксации или замены (в этом воркере) */
const dropBoard = (tour: string) => { for (const k of MEM.keys()) if (k.startsWith("lb:" + tour + ":")) MEM.delete(k); };
export async function tourCfg(assets: { fetch: typeof fetch }, origin: string, tour: string): Promise<{ cfg: TourCfg; rules: Rules }> {
  const d = await cached("tours", 60, async () => (await assets.fetch(new Request(origin + "/data/tournaments.json"))).json() as Promise<{ tournaments: TourCfg[] }>);
  const cfg = d?.tournaments.find((t) => t.id === tour);
  if (!cfg || !cfg.live) throw new GameError("турнир не идёт на живых данных", 404);
  return { cfg, rules: { ...DEFAULT_RULES, ...(cfg.rules ?? {}) } };
}
export async function loadFeed(assets: { fetch: typeof fetch }, origin: string, cfg: TourCfg): Promise<Feed> {
  const f = await cached("feed:" + cfg.id, 60, async () => {
    const got = await Promise.all([
      cfg.live_remote ? fetch(cfg.live_remote + "?t=" + Math.floor(Date.now() / 60000)).then((r) => (r.ok ? r.json() : null)).catch(() => null) : null,
      assets.fetch(new Request(origin + "/data/" + cfg.live)).then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]) as Array<Feed | null>;
    return got.filter((x): x is Feed => !!x && !!x.stages).sort((a, b) => String(b.generated).localeCompare(String(a.generated)))[0] ?? null;
  });
  if (!f) throw new GameError("нет живых данных турнира", 503);
  return f;
}

// ---------- стадии, дедлайны, выбывшие, цены
/** текущая стадия — первая незавершённая (окно состава на неё); null — турнир закончился */
const currentStage = (f: Feed) => { const i = f.stages.findIndex((s) => s.status !== "finished"); return i < 0 ? null : i; };
/** дедлайн стадии — плановое время первой серии */
function stageDeadline(f: Feed, k: number) {
  const ts = f.stages[k]?.series.map((s) => (s.at ? Date.parse(s.at) : NaN)).filter((x) => !Number.isNaN(x)) ?? [];
  return ts.length ? Math.min(...ts) : null;
}
/** стадия началась: наступил дедлайн или уже есть сыгранные/идущие серии */
const stageStarted = (f: Feed, k: number, now: number) => { const dl = stageDeadline(f, k); return (dl != null && now >= dl) || f.stages[k]!.status !== "upcoming"; };
const seriesStart = (s: FeedSeries) => (s.start ? Date.parse(s.start) : s.at ? Date.parse(s.at) : null);
/** серия закрыта для прогноза: началась (есть карты или идёт в эфире) или наступило её плановое время */
function seriesClosed(f: Feed, s: FeedSeries, now: number) {
  if (s.status !== "scheduled") return true;
  if (s.at && now >= Date.parse(s.at)) return true;
  return !!f.live_now?.some((g) => (g.a === s.a && g.b === s.b) || (g.a === s.b && g.b === s.a));
}
/** кто остаётся в турнире после стадии k: группы — 1–4 места; сетка — без проигравших нижней сетки и гранд-финала */
function aliveAfter(f: Feed, k: number): Set<string> {
  const all = new Set(Object.values(f.players).map((p) => p.team));
  if (k < 0) return all;
  const st = f.stages[k]!;
  if (k === 0) return st.status !== "finished" ? all : new Set(Object.values(f.standings ?? {}).flatMap((rows) => rows.slice(0, 4).map((r) => r.tag)));
  const prev = aliveAfter(f, k - 1);
  for (const s of st.series) if (s.status === "finished" && /^(LB|GF)/.test(s.key)) prev.delete(s.wa > s.wb ? s.b! : s.a!);
  return prev;
}
/** цена игрока в окне перед стадией k (02 §6: пересчёт после каждой стадии; во время стадии не меняется) */
function priceAt(f: Feed, acc: number, k: number) {
  const p = f.players[String(acc)];
  if (!p) return 0;
  return k > 0 ? (p.stages[k - 1]?.price ?? p.start.price) : p.start.price;
}

// ---------- проверка состава (02 §1): позиции, без повторов, лимит команды (когда остались 2 команды — max_team_final);
// новые игроки — только из оставшихся команд (оставленный игрок выбывшей команды можно держать, он приносит 0)
function checkLineup(f: Feed, rules: Rules, k: number, lu: Lineup, kept: Set<number>) {
  const alive = aliveAfter(f, k - 1), seen = new Set<number>(), teams: Record<string, number> = {};
  const limit = alive.size <= 2 ? rules.max_team_final : rules.max_team;
  ROLES.forEach((role, i) => {
    const acc = Number(lu[role]), p = f.players[String(acc)];
    if (!p) throw new GameError(`нет такого игрока в турнире (${role})`, 400);
    if (p.position !== i + 1) throw new GameError(`${p.nick} играет на позиции ${p.position}, а не ${i + 1}`, 400);
    if (seen.has(acc)) throw new GameError(`${p.nick} дважды в составе`, 400);
    if (!kept.has(acc) && !alive.has(p.team)) throw new GameError(`${p.nick}: команда ${p.team} выбыла`, 400);
    seen.add(acc); teams[p.team] = (teams[p.team] ?? 0) + 1;
  });
  for (const [t, n] of Object.entries(teams)) if (n > limit) throw new GameError(`не больше ${limit} игроков из ${t}`, 400);
}

interface LineupRow { uid: string; stage: number; lineup_lock: string; lineup: string; captain_lock: number; captain: number; tc: number; penalty: number; locked_at: number }
interface ChangeRow { uid: string; stage: number; role: string; out_acc: number; in_acc: number; at: number }
interface StageMeta { stage: number; transfers: number; free: number; penalty: number; bank: number }

/** трансферы окна перед стадией k (02 §3): разница с составом на начало окна; замена игрока выбывшей команды не считается */
function moves(f: Feed, k: number, base: Lineup | null, lu: Lineup) {
  if (!base) return { changed: [] as Role[], counted: 0 };
  const alive = aliveAfter(f, k - 1), changed = ROLES.filter((r) => base[r] !== lu[r]);
  return { changed, counted: changed.filter((r) => alive.has(f.players[String(base[r])]?.team ?? "")).length };
}
/** проход по составам игрока по стадиям < until: бесплатные трансферы (в каждом окне 1…N +free_transfers, копятся до free_max),
 *  штраф, банк (продажа и покупка по цене окна, замены стендинов — по цене стадии). Возвращает состояние окна until */
function walk(f: Feed, rules: Rules, rows: LineupRow[], changes: ChangeRow[], until: number) {
  const meta = new Map<number, StageMeta>();
  let bank = rules.budget, base: Lineup | null = null, free = 0;
  for (let k = 0; k <= until; k++) {
    if (k > 0) free = Math.min(rules.free_max, free + rules.free_transfers);
    if (k === until) break;
    const r = rows.find((x) => x.stage === k);
    if (!r) continue;
    const lu = JSON.parse(r.lineup_lock) as Lineup, mv = moves(f, k, base, lu), used = Math.min(free, mv.counted), free0 = free;
    free -= used;
    if (!base) bank = rules.budget - ROLES.reduce((s, role) => s + priceAt(f, lu[role], k), 0);
    else for (const role of mv.changed) bank += priceAt(f, base[role], k) - priceAt(f, lu[role], k);
    for (const c of changes.filter((x) => x.stage === k).sort((x, y) => x.at - y.at)) bank += priceAt(f, c.out_acc, k) - priceAt(f, c.in_acc, k);
    bank = r1(bank);
    meta.set(k, { stage: k, transfers: mv.counted, free: free0, penalty: r.penalty, bank });
    base = JSON.parse(r.lineup) as Lineup;
  }
  return { meta, bank, base, free };
}
const userRows = async (db: D1, tour: string, uid: string) => ({
  rows: (await db.prepare("select * from lineups where uid = ? and tour = ? order by stage").bind(uid, tour).all<LineupRow>()).results,
  changes: (await db.prepare("select * from lineup_changes where uid = ? and tour = ? order by at").bind(uid, tour).all<ChangeRow>()).results,
});

// ---------- фиксация состава на текущую стадию. До дедлайна фиксацию можно повторить (состав меняется свободно, 02 §2);
// после дедлайна — по правилу late_lock и только один раз
export async function lock(db: D1, f: Feed, rules: Rules, tour: string, uid: string, body: { stage: number; lineup: Lineup; captain: number; tc?: boolean }) {
  const k = currentStage(f), now = Date.now();
  if (k == null) throw new GameError("турнир закончился");
  if (Number(body.stage) !== k) throw new GameError("окно этой стадии закрыто — обнови страницу");
  const late = stageStarted(f, k, now);
  if (late && rules.late_lock === "deny") throw new GameError("стадия уже началась — состав на неё не принимается; следующее окно — после стадии");
  const { rows, changes } = await userRows(db, tour, uid);
  if (late && rows.some((r) => r.stage === k)) throw new GameError("состав на эту стадию уже зафиксирован");
  const lu = Object.fromEntries(ROLES.map((r) => [r, Number(body.lineup?.[r])])) as Lineup, cap = Number(body.captain);
  const w = walk(f, rules, rows.filter((r) => r.stage < k), changes.filter((c) => c.stage < k), k);
  checkLineup(f, rules, k, lu, new Set(w.base ? Object.values(w.base) : []));
  if (!Object.values(lu).includes(cap)) throw new GameError("капитан должен быть в составе", 400);
  if (body.tc && rows.some((r) => r.tc && r.stage !== k)) throw new GameError("тройной капитан уже использован");
  const mv = moves(f, k, w.base, lu), penalty = Math.max(0, mv.counted - w.free) * rules.transfer_cost;
  const bank = r1(w.base ? w.bank + mv.changed.reduce((s, role) => s + priceAt(f, w.base![role], k) - priceAt(f, lu[role], k), 0)
    : rules.budget - ROLES.reduce((s, role) => s + priceAt(f, lu[role], k), 0));
  if (bank < -EPS) throw new GameError(`не хватает банка: ${bank}`, 400);
  const vals = [uid, tour, k, JSON.stringify(lu), JSON.stringify(lu), cap, cap, body.tc ? 1 : 0, penalty, now, late ? 1 : 0];
  const ins = "insert into lineups (uid, tour, stage, lineup_lock, lineup, captain_lock, captain, tc, penalty, locked_at, late) values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";
  try {
    await db.prepare(late ? ins : ins + ` on conflict(uid, tour, stage) do update set lineup_lock = excluded.lineup_lock, lineup = excluded.lineup,
      captain_lock = excluded.captain_lock, captain = excluded.captain, tc = excluded.tc, penalty = excluded.penalty, locked_at = excluded.locked_at, late = 0`).bind(...vals).run();
  } catch (e) {
    if (/UNIQUE|constraint/i.test(String((e as Error).message))) throw new GameError("состав на эту стадию уже зафиксирован");
    throw e;
  }
  dropBoard(tour);
  return { stage: k, penalty, transfers: mv.counted, free: w.free, bank, late, locked_at: now };
}

// ---------- замена стендина (02 §5, решение автора 23.10): игрока зафиксированного состава заменили на карту стадии
// или замену объявили — один раз бесплатно на игрока той же позиции (банк и лимит команд — как обычно);
// новый приносит очки серий, начавшихся после замены, капитанство переходит к нему
export async function swap(db: D1, f: Feed, rules: Rules, tour: string, uid: string, body: { stage: number; out: number; in: number }) {
  const k = currentStage(f), now = Date.now(), out = Number(body.out), inn = Number(body.in);
  if (k == null || Number(body.stage) !== k) throw new GameError("замена возможна только в идущей стадии");
  const { rows, changes } = await userRows(db, tour, uid), row = rows.find((r) => r.stage === k);
  if (!row) throw new GameError("состав на эту стадию не зафиксирован");
  const lu = JSON.parse(row.lineup) as Lineup, role = ROLES.find((r) => lu[r] === out);
  if (!role) throw new GameError("этого игрока нет в составе", 400);
  if (changes.some((c) => c.stage === k && c.out_acc === out)) throw new GameError("этого игрока уже заменяли");
  const st = f.players[String(out)]?.stages[k], announced = f.substitutions?.some((s) => Number(s.out) === out);
  if (!(st?.missed || announced)) throw new GameError("игрока не заменяли на карты — бесплатная замена недоступна");
  const next = { ...lu, [role]: inn } as Lineup;
  checkLineup(f, rules, k, next, new Set(Object.values(lu)));
  const w = walk(f, rules, rows, changes, k + 1), bank = r1((w.meta.get(k)?.bank ?? 0) + priceAt(f, out, k) - priceAt(f, inn, k));
  if (bank < -EPS) throw new GameError(`не хватает банка: ${bank}`, 400);
  const captain = row.captain === out ? inn : row.captain;
  await db.batch([
    db.prepare("insert into lineup_changes (uid, tour, stage, role, out_acc, in_acc, at) values (?, ?, ?, ?, ?, ?, ?)").bind(uid, tour, k, role, out, inn, now),
    db.prepare("update lineups set lineup = ?, captain = ? where uid = ? and tour = ? and stage = ?").bind(JSON.stringify(next), captain, uid, tour, k),
  ]);
  dropBoard(tour);
  return { stage: k, role, bank, at: now };
}

// ---------- прогнозы (docs/04): сайт присылает все прогнозы текущей стадии разом; сервер сохраняет только открытые серии
// (pick_close: в дедлайн стадии или каждая серия до своего начала), пустой прогноз по открытой серии удаляет сохранённый.
// Дальние матчи — пара из своих же прогнозов (a, b); точный счёт засчитывается, только если угадана и пара
type PredIn = { key: string; w?: string | null; sc?: string | null; a?: string | null; b?: string | null };
export async function picks(db: D1, f: Feed, rules: Rules, tour: string, uid: string, body: { stage: number; picks?: PredIn[] }) {
  const k = currentStage(f), now = Date.now();
  if (k == null || Number(body.stage) !== k) throw new GameError("прогнозы этой стадии закрыты — обнови страницу");
  if (await db.prepare("select 1 from pred_locks where uid = ? and tour = ? and stage = ?").bind(uid, tour, k).first()) throw new GameError("прогнозы на эту стадию зафиксированы");
  const st = f.stages[k]!, teams = new Set(Object.values(f.players).map((p) => p.team));
  const shut = rules.pick_close === "stage" && stageStarted(f, k, now);
  const input = new Map((body.picks ?? []).slice(0, 64).map((p) => [String(p.key), p]));
  const ops: D1Stmt[] = [], closed: string[] = [], bad: Array<{ key: string; error: string }> = [];
  for (const s of st.series) {
    const p = input.get(s.key);
    if (shut || seriesClosed(f, s, now)) { closed.push(s.key); continue; }
    if (!p || !p.w) { ops.push(db.prepare("delete from predictions where uid = ? and tour = ? and key = ?").bind(uid, tour, s.key)); continue; }
    const a = p.a ?? s.a, b = p.b ?? s.b, okSc = s.bo === 5 ? ["3:0", "3:1", "3:2"] : ["2:0", "2:1"];
    const err = !a || !b || a === b || !teams.has(a) || !teams.has(b) ? "пара команд" : p.w !== a && p.w !== b ? "победитель — одна из команд пары"
      : p.sc != null && !okSc.includes(p.sc) ? "неверный счёт" : null;
    if (err) { bad.push({ key: s.key, error: err }); continue; }
    ops.push(db.prepare(`insert into predictions (uid, tour, key, w, sc, a, b, at) values (?, ?, ?, ?, ?, ?, ?, ?)
      on conflict(uid, tour, key) do update set w = excluded.w, sc = excluded.sc, a = excluded.a, b = excluded.b, at = excluded.at
      where predictions.w is not excluded.w or predictions.sc is not excluded.sc or predictions.a is not excluded.a or predictions.b is not excluded.b`)
      .bind(uid, tour, s.key, p.w, p.sc ?? null, a, b, now));
  }
  if (ops.length) await db.batch(ops);
  const keys = new Set(st.series.map((s) => s.key));
  const preds = (await db.prepare("select key, w, sc, a, b, at from predictions where uid = ? and tour = ?").bind(uid, tour).all<{ key: string }>()).results.filter((p) => keys.has(p.key));
  return { stage: k, preds, closed, bad };
}
export async function pickLock(db: D1, f: Feed, tour: string, uid: string, stage: number) {
  if (currentStage(f) !== stage) throw new GameError("прогнозы этой стадии закрыты — обнови страницу");
  await db.prepare("insert or ignore into pred_locks (uid, tour, stage, at) values (?, ?, ?, ?)").bind(uid, tour, stage, Date.now()).run();
  return { stage };
}

// ---------- очки: по отрезкам владения игроком (фиксация → замены), капитан ×2 (тройной ×3), минус штраф за трансферы
function stageScore(f: Feed, rules: Rules, row: LineupRow, changes: ChangeRow[]) {
  const st = f.stages[row.stage];
  if (!st) return 0;
  const from0 = rules.late_lock === "after_lock" ? row.locked_at : null, lu0 = JSON.parse(row.lineup_lock) as Lineup;
  let total = 0;
  for (const role of ROLES) {
    // отрезки: исходный игрок с фиксации до первой замены, дальше — каждый следующий; капитанство переходит к замене
    const segs: Array<{ acc: number; from: number | null; to: number | null }> = [{ acc: lu0[role], from: from0, to: null }];
    for (const c of changes.filter((x) => x.role === role).sort((x, y) => x.at - y.at)) { segs[segs.length - 1]!.to = c.at; segs.push({ acc: c.in_acc, from: c.at, to: null }); }
    const mul = lu0[role] === row.captain_lock ? (row.tc ? rules.triple : rules.captain) : 1;
    for (const g of segs) for (const s of st.series) {
      const t = seriesStart(s), p = s.pts?.[String(g.acc)];
      if (p == null || t == null || (g.from != null && t < g.from) || (g.to != null && t >= g.to)) continue;
      total += p * mul;
    }
  }
  return r1(total - row.penalty);
}
/** баллы прогнозов (docs/04): +1 победитель места сетки, +1 точный счёт, если угадана и пара */
function predPoints(f: Feed, preds: Array<{ key: string; w: string; sc: string | null; a: string; b: string }>) {
  const byKey = new Map(f.stages.flatMap((st) => st.series.map((s) => [s.key, s] as const)));
  let pts = 0, settled = 0;
  for (const p of preds) {
    const s = byKey.get(p.key);
    if (!s || s.status !== "finished") continue;
    settled++;
    const win = s.wa > s.wb ? s.a : s.b, sc = `${Math.max(s.wa, s.wb)}:${Math.min(s.wa, s.wb)}`;
    if (p.w !== win) continue;
    pts++;
    if (p.sc === sc && [s.a, s.b].every((t) => t === p.a || t === p.b)) pts++;
  }
  return { pts, settled };
}

// ---------- моё состояние на сервере (сайт сверяет с ним свой прогресс): составы по стадиям с очками, трансферами и банком,
// окно текущей стадии (бесплатные трансферы, банк, состав на начало окна), прогнозы
export async function me(db: D1, f: Feed, rules: Rules, tour: string, uid: string) {
  const { rows, changes } = await userRows(db, tour, uid);
  const preds = (await db.prepare("select key, w, sc, a, b, at from predictions where uid = ? and tour = ?").bind(uid, tour).all<{ key: string; w: string; sc: string | null; a: string; b: string; at: number }>()).results;
  const locks = (await db.prepare("select stage, at from pred_locks where uid = ? and tour = ?").bind(uid, tour).all<{ stage: number; at: number }>()).results;
  const cur = currentStage(f), all = walk(f, rules, rows, changes, f.stages.length);
  const stages = rows.map((r) => ({ stage: r.stage, lineup: JSON.parse(r.lineup), lineup_lock: JSON.parse(r.lineup_lock), captain: r.captain, captain_lock: r.captain_lock,
    tc: !!r.tc, locked_at: r.locked_at, ...all.meta.get(r.stage), pts: stageScore(f, rules, r, changes.filter((c) => c.stage === r.stage)) }));
  let window = null;
  if (cur != null) {
    const w = walk(f, rules, rows.filter((r) => r.stage < cur), changes.filter((c) => c.stage < cur), cur);
    window = { stage: cur, free: w.free, bank: w.base ? w.bank : rules.budget, base: w.base, deadline: stageDeadline(f, cur), started: stageStarted(f, cur, Date.now()) };
  }
  return { tour, generated: f.generated, current: cur, rules, window, stages, total: r1(stages.reduce((a, s) => a + s.pts, 0)), changes,
    predictions: preds, pred_locks: locks, pred_points: predPoints(f, preds) };
}

// ---------- таблица турнира (02 §7): все, кто фиксировал состав. Равенство: меньше платных трансферов → больше очков
// в последней начавшейся стадии → раньше собран первый состав. Имя — обезличенное («Игрок 7F3A»), своя строка — «Вы».
// Расчёт кэшируется на 30 с
export async function leaderboard(db: D1, f: Feed, rules: Rules, tour: string, uid: string | null) {
  const ranked = (await cached("lb:" + tour + ":" + f.generated, 30, async () => {
    const rows = (await db.prepare("select * from lineups where tour = ?").bind(tour).all<LineupRow>()).results;
    const changes = (await db.prepare("select * from lineup_changes where tour = ?").bind(tour).all<ChangeRow>()).results;
    const last = f.stages.reduce((a, s, i) => (s.status !== "upcoming" ? i : a), 0);
    const users = new Map<string, { per: number[]; total: number; paid: number; first: number }>();
    for (const r of rows) {
      const u = users.get(r.uid) ?? { per: new Array(f.stages.length).fill(0), total: 0, paid: 0, first: Infinity };
      const s = stageScore(f, rules, r, changes.filter((c) => c.uid === r.uid && c.stage === r.stage));
      u.per[r.stage] = s; u.total = r1(u.total + s); u.paid += Math.round(r.penalty / rules.transfer_cost); u.first = Math.min(u.first, r.locked_at);
      users.set(r.uid, u);
    }
    return [...users.entries()].map(([id, u]) => ({ id, ...u }))
      .sort((a, b) => b.total - a.total || a.paid - b.paid || (b.per[last] ?? 0) - (a.per[last] ?? 0) || a.first - b.first)
      .map((x, i) => ({ rank: i + 1, id: x.id, per: x.per, total: x.total, paid: x.paid }));
  }))!;
  const row = (x: (typeof ranked)[number]) => ({ rank: x.rank, name: x.id === uid ? "Вы" : "Игрок " + x.id.slice(0, 4).toUpperCase(), me: x.id === uid, per: x.per, total: x.total, paid: x.paid });
  const mine = ranked.find((x) => x.id === uid);
  return { tour, n: ranked.length, generated: f.generated, stages: f.stages.map((s) => ({ name: s.name, status: s.status })),
    top: ranked.slice(0, 50).map(row), me: mine ? row(mine) : null };
}
