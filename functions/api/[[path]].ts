// API сайта на Cloudflare Pages Functions (/api/*): вход через Telegram, проверка подписки на канал, сохранение прогресса
// игрока и доли выбора игроков по составам настоящих игроков (решение автора 23.10.2026).
// Личные данные не храним: пользователь в базе — HMAC от Telegram id с секретом сервера (по нему человека не найти);
// Telegram id живёт только в подписанной cookie у самого пользователя — чтобы перепроверять подписку.
// Настройка — docs/10 «Вход и сохранение»: секреты TELEGRAM_BOT_TOKEN и SESSION_SECRET, переменные TG_CHANNEL и TG_BOT
// (wrangler.toml), база D1 «DB» (схема — apps/site-api/schema.sql). Пока что-то не настроено — /api/config отдаёт enabled: false,
// и сайт работает без входа (как раньше).
interface D1Stmt { bind(...v: unknown[]): D1Stmt; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; run(): Promise<unknown> }
interface D1 { prepare(q: string): D1Stmt; batch(s: D1Stmt[]): Promise<unknown> }
interface Env { DB?: D1; TELEGRAM_BOT_TOKEN?: string; SESSION_SECRET?: string; TG_CHANNEL?: string; TG_BOT?: string }
interface Ctx { request: Request; env: Env; waitUntil(p: Promise<unknown>): void }
interface Sess { u: string; t: number; c: number; s: 0 | 1 }

const enc = new TextEncoder();
const RECHECK_MS = 10 * 60_000; // подписку перепроверяем не чаще раза в 10 минут
const SESSION_DAYS = 30;
const MAX_STATE = 400_000; // байт на прогресс игрока

const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const b64u = (s: string) => btoa(String.fromCharCode(...enc.encode(s))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64u = (s: string) => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
async function hmac(key: ArrayBuffer | Uint8Array, msg: string) {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(msg));
}
const same = (a: string, b: string) => { if (a.length !== b.length) return false; let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i); return x === 0; };
const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const enabled = (env: Env) => !!(env.DB && env.TELEGRAM_BOT_TOKEN && env.SESSION_SECRET && env.TG_CHANNEL && env.TG_BOT);
const channelName = (env: Env) => (env.TG_CHANNEL ?? "").replace(/^@/, "");

// Telegram Login Widget: hash = HMAC-SHA256(строки «ключ=значение» по алфавиту через \n, ключ = SHA256(токен бота))
async function verifyTelegram(d: Record<string, unknown>, token: string) {
  const hash = String(d.hash ?? "");
  const check = Object.keys(d).filter((k) => k !== "hash" && d[k] != null).sort().map((k) => `${k}=${d[k]}`).join("\n");
  const sig = hex(await hmac(await crypto.subtle.digest("SHA-256", enc.encode(token)), check));
  return !!hash && same(sig, hash) && Date.now() / 1000 - Number(d.auth_date) < 86_400;
}
// подписка: бот должен быть администратором канала, иначе Telegram не отдаёт участников
async function isMember(env: Env, tgId: number) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/getChatMember?chat_id=${encodeURIComponent("@" + channelName(env))}&user_id=${tgId}`);
  const j = (await r.json()) as { ok: boolean; result?: { status: string; is_member?: boolean }; description?: string };
  if (!j.ok) throw new Error(j.description ?? "getChatMember");
  const s = j.result!.status;
  return s === "creator" || s === "administrator" || s === "member" || (s === "restricted" && !!j.result!.is_member);
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
    const ns: Sess = { ...s, s: (await isMember(env, s.t)) ? 1 : 0, c: Date.now() };
    return { s: ns, set: cookie(await signSess(env, ns), SESSION_DAYS * 86_400) };
  } catch (e) { return { s, error: (e as Error).message }; }
}

export async function onRequest(ctx: Ctx): Promise<Response> {
  const { request: req, env } = ctx, url = new URL(req.url), route = url.pathname.replace(/^\/api\/?/, "").replace(/\/$/, "");
  if (route === "config") return json({ enabled: enabled(env), bot: env.TG_BOT ?? null, channel: channelName(env) || null });
  if (!enabled(env)) return json({ error: "вход не настроен" }, 503);

  if (route === "auth" && req.method === "POST") {
    const d = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!d || !(await verifyTelegram(d, env.TELEGRAM_BOT_TOKEN!))) return json({ error: "подпись Telegram не сошлась" }, 401);
    const tg = Number(d.id);
    let member: boolean;
    try { member = await isMember(env, tg); } catch (e) { return json({ error: "не удалось проверить подписку: " + (e as Error).message }, 502); }
    const s: Sess = { u: await uidOf(env, tg), t: tg, c: Date.now(), s: member ? 1 : 0 };
    return json({ auth: true, subscribed: member, channel: channelName(env) }, 200, { "set-cookie": cookie(await signSess(env, s), SESSION_DAYS * 86_400) });
  }
  if (route === "logout" && req.method === "POST") return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });

  const { s, set, error } = await session(req, env);
  const extra: Record<string, string> = set ? { "set-cookie": set } : {};
  if (route === "me") return json({ auth: !!s, subscribed: !!s?.s, channel: channelName(env), ...(error ? { warning: error } : {}) }, 200, extra);
  if (!s) return json({ error: "нужен вход" }, 401);
  if (!s.s) return json({ error: "нужна подписка на канал", channel: channelName(env) }, 403, extra);
  const db = env.DB!;

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
  return json({ error: "нет такого метода" }, 404);
}
