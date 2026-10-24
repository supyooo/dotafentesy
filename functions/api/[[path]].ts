// API сайта на Cloudflare Pages Functions (/api/*): вход через Telegram, проверка подписки на канал, сохранение прогресса
// игрока и доли выбора игроков по составам настоящих игроков (решение автора 23.10.2026).
// Личные данные не храним: пользователь в базе — HMAC от Telegram id с секретом сервера (по нему человека не найти);
// Telegram id живёт только в подписанной cookie у самого пользователя — чтобы перепроверять подписку.
// Настройка — docs/10 «Вход и сохранение»: секреты TELEGRAM_BOT_TOKEN и SESSION_SECRET, переменные TG_CHANNEL и TG_BOT
// (wrangler.toml), база D1 «DB» (схема — apps/site-api/schema.sql). Пока что-то не настроено — /api/config отдаёт enabled: false,
// и сайт работает без входа (как раньше).
import { GameError, leaderboard, loadFeed, lock, me, pickLock, picks, swap, tourCfg } from "../../apps/site-api/src/game";
interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> }
interface D1 { prepare(q: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
interface Env { ASSETS?: { fetch: typeof fetch }; DB?: D1; TELEGRAM_BOT_TOKEN?: string; SESSION_SECRET?: string; TG_CHANNEL?: string; TG_BOT?: string; TG_LINK?: string; TG_TITLE?: string }
interface Ctx { request: Request; env: Env; waitUntil(p: Promise<unknown>): void }
interface Sess { u: string; t: number; c: number; s: 0 | 1; a?: 0 | 1 }

const enc = new TextEncoder();
const RECHECK_MS = 10 * 60_000; // подписку перепроверяем не чаще раза в 10 минут
const SESSION_DAYS = 30;
const MAX_STATE = 400_000; // байт на прогресс игрока

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64u = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key as BufferSource,{ name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const enabled = (env: Env) => !!(env.DB && env.TELEGRAM_BOT_TOKEN && env.SESSION_SECRET && env.TG_CHANNEL && env.TG_BOT);
const channelName = (env: Env) => (env.TG_CHANNEL ?? "").replace(/^@/, "");
// канал или группа: @username (публичные) или числовой id (приватные, вида -100…); ссылка для кнопки «Подписаться» —
// TG_LINK (приглашение t.me/+… у приватной), иначе t.me/<username>
const chatId = (env: Env) => (/^-?\d+$/.test(channelName(env)) ? channelName(env) : "@" + channelName(env));
const chatLink = (env: Env) => env.TG_LINK || (/^-?\d+$/.test(channelName(env)) ? null : "https://t.me/" + channelName(env));

// Telegram Login Widget: hash = HMAC-SHA256(строки «ключ=значение» по алфавиту через \n, ключ = SHA256(токен бота))
async function verifyTelegram(d: Record<string, unknown>, token: string) {
  const hash = String(d.hash ?? "");
  const check = Object.keys(d).filter((k) => k !== "hash" && k !== "vid" && d[k] != null).sort().map((k) => `${k}=${d[k]}`).join("\n");
  const sig = hex(await hmac(await crypto.subtle.digest("SHA-256", enc.encode(token)), check));
  return !!hash && same(sig, hash) && Date.now() / 1000 - Number(d.auth_date) < 86_400;
}
// подписка: бот должен быть администратором канала, иначе Telegram не отдаёт участников
async function memberStatus(env: Env, tgId: number): Promise<{ member: boolean; admin: boolean }> {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent(chatId(env))}&user_id=${tgId}`);
  const j = (await r.json()) as { ok: boolean; result?: { status: string; is_member?: boolean }; description?: string };
  if (!j.ok) throw new Error(j.description ?? "getChatMember");
  const s = j.result!.status, admin = s === "creator" || s === "administrator";
  return { member: admin || s === "member" || (s === "restricted" && !!j.result!.is_member), admin };
}

const uidOf = async (env: Env, tgId: number) => hex(await hmac(enc.encode(env.SESSION_SECRET!), "tg:" + tgId)).slice(0, 32);
async function signSess(env: Env, p: Sess) { const body = b64u(JSON.stringify(p)); return body + "." + hex(await hmac(enc.encode(env.SESSION_SECRET!), body)); }
async function readSess(req: Request, env: Env): Promise<Sess | null> {
  const raw = (req.headers.get("cookie") ?? "").split(/;\s*/).find((c) => c.startsWith("df_s="))?.slice(5);
  if (!raw || !env.SESSION_SECRET) return null;
  const [body, sig] = raw.split(".");
  if (!body || !sig || !same(sig, hex(await hmac(enc.encode(env.SESSION_SECRET), body)))) return null;
  try { return JSON.parse(unb64u(body)) as Sess; } catch { return null; }
}
const cookie = (v: string, maxAge: number) => `df_s=${v}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;

// сессия с перепроверкой подписки (если пора); возвращает сессию и, если обновилась, заголовок Set-Cookie
async function session(req: Request, env: Env): Promise<{ s: Sess | null; set?: string; error?: string }> {
  const s = await readSess(req, env);
  if (!s) return { s: null };
  if (s.s && Date.now() - s.c < RECHECK_MS) return { s };
  try {
    const m = await memberStatus(env, s.t), ns: Sess = { ...s, s: m.member ? 1 : 0, a: m.admin ? 1 : 0, c: Date.now() };
    if (ns.s !== s.s && env.DB) await logEvents(env, s.u, null, [{ type: "sub_change", data: { subscribed: !!ns.s } }]);
    return { s: ns, set: cookie(await signSess(env, ns), SESSION_DAYS * 86_400) };
  } catch (e) { return { s, error: (e as Error).message }; }
}

export async function onRequest(ctx: Ctx): Promise<Response> {
  const { request: req, env } = ctx, url = new URL(req.url), route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  if (route === "config") return json({ enabled: enabled(env), bot: env.TG_BOT ?? null, channel: channelName(env) || null, title: env.TG_TITLE ?? null, link: chatLink(env) });
  // настройка: пока канал не задан, но токен есть — чаты, куда добавлен бот (id, название, ссылка), чтобы вписать TG_CHANNEL/TG_LINK.
  // Только чаты самого бота; после настройки (TG_CHANNEL задан) метод выключается
  if (route === "setup-chats" && env.TELEGRAM_BOT_TOKEN && !env.TG_CHANNEL) {
    const tg = (m: string, q = "") => fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${m}${q}`).then((r) => r.json() as Promise<{ ok: boolean; result?: any }>);
    const upd = await tg("getUpdates", "?allowed_updates=" + encodeURIComponent(JSON.stringify(["my_chat_member", "message", "channel_post"])));
    const chats = new Map<number, any>();
    for (const u of upd.result ?? []) { const c = (u.my_chat_member ?? u.message ?? u.channel_post)?.chat; if (c && c.type !== "private") chats.set(c.id, c); }
    const out = [];
    for (const c of chats.values()) { const g = await tg("getChat", "?chat_id=" + c.id); out.push({ id: c.id, type: c.type, title: c.title, username: c.username ?? null, invite_link: g.result?.invite_link ?? null }); }
    return json({ ok: upd.ok, chats: out });
  }
  if (!enabled(env)) return json({ error: "вход не настроен" }, 503);

  if (route === "auth" && req.method === "POST") {
    const d = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!d || !(await verifyTelegram(d, env.TELEGRAM_BOT_TOKEN!))) return json({ error: "подпись Telegram не сошлась" }, 401);
    const tg = Number(d.id);
    let m: { member: boolean; admin: boolean };
    try { m = await memberStatus(env, tg); } catch (e) { return json({ error: "не удалось проверить подписку: " + (e as Error).message }, 502); }
    const member = m.member, s: Sess = { u: await uidOf(env, tg), t: tg, c: Date.now(), s: member ? 1 : 0, a: m.admin ? 1 : 0 };
    // вход связывает посетителя (vid до входа) с игроком (uid) — для воронки «зашёл → вошёл → подписан»
    await logEvents(env, s.u, typeof d.vid === "string" ? d.vid : null, [{ type: "auth", data: { subscribed: member } }]);
    return json({ auth: true, subscribed: member, channel: channelName(env) }, 200, { "set-cookie": cookie(await signSess(env, s), SESSION_DAYS * 86_400) });
  }
  if (route === "logout" && req.method === "POST") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });

  if (route === "events" && req.method === "POST") {
    const text = await req.text();
    if (text.length > 60_000) return json({ error: "много событий" }, 413);
    const body = JSON.parse(text) as { vid?: string; events?: Array<{ type: string; tour?: string; data?: unknown }> };
    const sess = await readSess(req, env);
    const evs = (body.events ?? []).slice(0, 60).filter((e) => EVENT_TYPES.has(e.type) && (sess || PUBLIC_EVENTS.has(e.type)));
    if (evs.length) await logEvents(env, sess?.u ?? null, typeof body.vid === "string" ? body.vid.slice(0, 40) : null, evs);
    return json({ ok: true, n: evs.length });
  }
  const { s, set, error } = await session(req, env);
  const extra: Record<string, string> = set ? { "set-cookie": set } : {};
  if (route === "me") return json({ auth: !!s, subscribed: !!s?.s, admin: !!s?.a, channel: channelName(env), ...(error ? { warning: error } : {}) }, 200, extra);
  if (!s) return json({ error: "нужен вход" }, 401);
  if (!s.s) return json({ error: "нужна подписка на канал", channel: channelName(env) }, 403, extra);
  const db = env.DB!;

  // игра на сервере (apps/site-api/src/game.ts): фиксация, замена стендина, прогнозы, моё состояние, таблица турнира
  if (route.startsWith("game/")) {
    try {
      const body = req.method === "POST" ? ((await req.json().catch(() => ({}))) as Record<string, any>) : {};
      const tour = String(body.tour ?? url.searchParams.get("tour") ?? "");
      if (!/^[a-z0-9_-]{1,40}$/.test(tour)) return json({ error: "tour" }, 400);
      const { cfg, rules } = await tourCfg(env.ASSETS!, url.origin, tour);
      const f = await loadFeed(env.ASSETS!, url.origin, cfg), op = route.slice(5), post = req.method === "POST";
      let out: unknown;
      if (op === "lock" && post) out = await lock(db, f, rules, tour, s.u, body as any);
      else if (op === "swap" && post) out = await swap(db, f, rules, tour, s.u, body as any);
      else if (op === "picks" && post) out = await picks(db, f, rules, tour, s.u, body as any);
      else if (op === "pick-lock" && post) out = await pickLock(db, f, tour, s.u, Number(body.stage));
      else if (op === "me" && !post) out = await me(db, f, rules, tour, s.u);
      else if (op === "leaderboard" && !post) out = await leaderboard(db, f, rules, tour, s.u);
      else return json({ error: "нет такого метода" }, 404);
      // журнал — только принятые действия; прогнозы и так пишутся событием pk с сайта
      if (post && op !== "picks") await logEvents(env, s.u, null, [{ type: "srv_" + op.replace("-", "_"), tour, data: { ...body, result: out } }]);
      return json(out, 200, extra);
    } catch (e) { if (e instanceof GameError) return json({ error: e.message }, e.status, extra); throw e; }
  }
  if (route === "state" && req.method === "GET") {
    const row = await db.prepare("select data, updated from states where uid = ?").bind(s.u).first<{ data: string; updated: number }>();
    return json({ data: row ? JSON.parse(row.data) : null, updated: row?.updated ?? null }, 200, extra);
  }
  if (route === "state" && req.method === "PUT") {
    const text = await req.text();
    if (text.length > MAX_STATE) return json({ error: "прогресс слишком большой" }, 413);
    const body = JSON.parse(text) as { data: Record<string, string>; picks?: { tour: string; acc: number[] } };
    const now = Date.now(), ops = [db.prepare("insert into states (uid, data, updated) values (?, ?, ?) on conflict(uid) do update set data = excluded.data, updated = excluded.updated")
      .bind(s.u, JSON.stringify(body.data ?? {}), now)];
    // текущий состав игрока в турнире — для долей выбора (кто кого взял)
    if (body.picks && /^[a-z0-9_-]{1,40}$/.test(body.picks.tour)) {
      const accs = [...new Set((body.picks.acc ?? []).map(Number).filter((x) => Number.isInteger(x) && x > 0))].slice(0, 5);
      ops.push(db.prepare("delete from picks where uid = ? and tour = ?").bind(s.u, body.picks.tour));
      for (const a of accs) ops.push(db.prepare("insert into picks (uid, tour, acc) values (?, ?, ?)").bind(s.u, body.picks.tour, a));
    }
    await db.batch(ops);
    return json({ ok: true, updated: now }, 200, extra);
  }
  if (route === "picks" && req.method === "GET") {
    const tour = url.searchParams.get("tour") ?? "";
    if (!/^[a-z0-9_-]{1,40}$/.test(tour)) return json({ error: "tour" }, 400);
    const n = (await db.prepare("select count(distinct uid) n from picks where tour = ?").bind(tour).first<{ n: number }>())?.n ?? 0;
    const rows = (await db.prepare("select acc, count(*) c from picks where tour = ? group by acc").bind(tour).all<{ acc: number; c: number }>()).results;
    return json({ tour, n, own: Object.fromEntries(rows.map((r) => [r.acc, n ? r.c / n : 0])) }, 200, extra);
  }
  if (route === "stats" && req.method === "GET") {
    if (!s.a) return json({ error: "только для администраторов группы" }, 403, extra);
    return json(await stats(db, Math.min(90, Math.max(1, Number(url.searchParams.get("days") ?? 14)))), 200, extra);
  }
  return json({ error: "нет такого метода" }, 404);
}

// ---------- журнал событий (обезличенно: uid — игрок после входа, vid — случайный номер браузера; ни имён, ни IP)
const EVENT_TYPES = new Set(["visit", "view", "gate", "gate_check", "tour_open", "pick", "drop", "captain", "tc", "lock", "swap",
  "pk", "pk_lock", "reset", "logout", "auth", "sub_change"]);
const PUBLIC_EVENTS = new Set(["visit", "view", "gate", "gate_check"]);
async function logEvents(env: Env, uid: string | null, vid: string | null, evs: Array<{ type: string; tour?: string; data?: unknown }>) {
  const now = Date.now(), q = "insert into events (at, uid, vid, type, tour, data) values (?, ?, ?, ?, ?, ?)";
  await env.DB!.batch(evs.map((e) => env.DB!.prepare(q).bind(now, uid, vid, e.type, typeof e.tour === "string" ? e.tour.slice(0, 40) : null,
    e.data == null ? null : JSON.stringify(e.data).slice(0, 2000))));
}

// ---------- сводка для администраторов группы (страница «Статистика» на сайте): только агрегаты
async function stats(db: D1, days: number) {
  const since = Date.now() - days * 86_400_000;
  const all = <T>(q: string, ...b: unknown[]) => db.prepare(q).bind(...b).all<T>().then((r) => r.results);
  const one = <T>(q: string, ...b: unknown[]) => db.prepare(q).bind(...b).first<T>();
  const day = "strftime('%Y-%m-%d', at / 1000, 'unixepoch', '+3 hours')"; // дни по Москве
  return {
    days, generated: new Date().toISOString(),
    totals: await one<Record<string, number>>(`select
      (select count(*) from states) players,
      (select count(distinct vid) from events where type = 'visit') visitors,
      (select count(distinct uid) from events where type = 'lock') locked,
      (select count(distinct uid) from events where type = 'pk') predictors,
      (select count(*) from events) events`),
    daily: await all(`select ${day} d, count(distinct case when type = 'visit' then vid end) visitors,
      count(distinct uid) players, count(distinct case when type = 'lock' then uid end) locks,
      count(case when type = 'pk' then 1 end) predictions, count(*) events
      from events where at >= ? group by d order by d`, since),
    funnel: await one<Record<string, number>>(`select
      count(distinct case when type = 'visit' then vid end) visited,
      count(distinct case when type = 'gate' then vid end) saw_login,
      count(distinct case when type = 'auth' then vid end) logged_in,
      count(distinct case when type = 'auth' and json_extract(data, '$.subscribed') then vid end) subscribed
      from events where at >= ?`, since),
    builders: await one<Record<string, number>>(`select count(distinct uid) with_lineup from picks`),
    retention: await one<Record<string, number>>(`select count(*) players, sum(case when n >= 2 then 1 else 0 end) two_plus_days,
      sum(case when n >= 3 then 1 else 0 end) three_plus_days from (select uid, count(distinct ${day}) n from events where uid is not null group by uid)`),
    sources: await all(`select coalesce(json_extract(data, '$.ref'), '(прямой заход)') ref, count(distinct vid) visitors
      from events where type = 'visit' and at >= ? group by ref order by visitors desc limit 15`, since),
    devices: await all(`select case when json_extract(data, '$.mobile') then 'телефон' else 'компьютер' end device, count(distinct vid) visitors
      from events where type = 'visit' and at >= ? group by device`, since),
    views: await all(`select json_extract(data, '$.view') view, count(*) n from events where type = 'view' and at >= ? group by view order by n desc`, since),
    picks: await all(`select tour, acc, count(*) n from picks group by tour, acc order by tour, n desc`),
    captains: await all(`select tour, json_extract(data, '$.captain') acc, count(distinct uid) n from events where type = 'lock' group by tour, acc order by tour, n desc`),
    // прогнозы: последний выбор игрока по каждой серии — кого аудитория считает фаворитом
    predictions: await all(`select tour, q, max(a) a, max(b) b, w, count(*) n from (
        select tour, json_extract(data, '$.q') q, json_extract(data, '$.a') a, json_extract(data, '$.b') b, json_extract(data, '$.w') w,
          row_number() over (partition by uid, tour, json_extract(data, '$.q') order by at desc) rn
        from events where type = 'pk' and json_extract(data, '$.w') is not null)
      where rn = 1 group by tour, q, w order by tour, q, n desc`),
    events_by_type: await all(`select type, count(*) n, count(distinct coalesce(uid, vid)) who from events where at >= ? group by type order by n desc`, since),
  };
}
