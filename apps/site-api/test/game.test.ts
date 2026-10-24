// Проверка серверной игры (src/game.ts) на синтетическом турнире: D1 подменён встроенным SQLite из Node (node:sqlite),
// время — подменой Date.now. Запуск: apps/worker/node_modules/.bin/tsx apps/site-api/test/game.test.ts
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_RULES, GameError, leaderboard, lock, me, pickLock, picks, swap, type D1, type Feed, type Rules } from "../src/game";

const SCHEMA = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
function d1(): D1 {
  const db = new DatabaseSync(":memory:");
  db.exec(SCHEMA);
  const stmt = (q: string, args: unknown[] = []): any => ({
    bind: (...v: unknown[]) => stmt(q, v),
    first: async () => (db.prepare(q).get(...(args as any[])) as any) ?? null,
    all: async () => ({ results: db.prepare(q).all(...(args as any[])) }),
    run: async () => db.prepare(q).run(...(args as any[])),
  });
  return { prepare: (q) => stmt(q), batch: async (s) => { db.exec("begin"); try { for (const x of s) await x.run(); db.exec("commit"); } catch (e) { db.exec("rollback"); throw e; } } };
}
const H = 3_600_000, T0 = Date.parse("2026-11-20T12:00:00Z");
let NOW = T0 - H;
Date.now = () => NOW;
const rules = (o: Partial<Rules> = {}): Rules => ({ ...DEFAULT_RULES, ...o });

// 5 команд по 5 игроков; account_id = (номер команды)(позиция): A1 = 11 … E5 = 55. Цены: A 12, B 9, C 8, D 6, E 5
const TEAMS = ["A", "B", "C", "D", "E"], PRICE: Record<string, number> = { A: 12, B: 9, C: 8, D: 6, E: 5 };
const acc = (t: string, pos: number) => (TEAMS.indexOf(t) + 1) * 10 + pos;
const ser = (key: string, a: string, b: string, at: number) => ({ key, group: null, label: key, bo: 3, a, b, at: new Date(at).toISOString(), start: null as string | null,
  status: "scheduled" as "finished" | "live" | "scheduled", wa: 0, wb: 0, pts: {} as Record<string, number> });
function feed(): Feed {
  const players: Feed["players"] = {};
  for (const t of TEAMS) for (let pos = 1; pos <= 5; pos++)
    players[acc(t, pos)] = { nick: t + pos, team: t, position: pos, start: { price: PRICE[t]! }, stages: [0, 1].map(() => ({ pts: 0, maps: 0, price: PRICE[t]! })) };
  return { generated: "g1", players, standings: { X: TEAMS.map((tag) => ({ tag })) }, stages: [
    { idx: 0, name: "Группы", status: "upcoming", series: [ser("G1", "A", "B", T0), ser("G2", "C", "D", T0 + 3 * H), ser("G3", "E", "A", T0 + 6 * H)] },
    { idx: 1, name: "Плей-офф", status: "upcoming", series: [ser("UB1", "A", "B", T0 + 48 * H), ser("LB1", "C", "D", T0 + 51 * H)] },
  ] };
}
/** серия сыграна: счёт, время старта, очки игроков */
function play(f: Feed, key: string, wa: number, wb: number, start: number, pts: Record<number, number>) {
  const s = f.stages.flatMap((x) => x.series).find((x) => x.key === key)!;
  Object.assign(s, { status: "finished", wa, wb, start: new Date(start).toISOString(), pts: Object.fromEntries(Object.entries(pts).map(([k, v]) => [String(k), v])) });
}
const LU = (c: number, m: number, o: number, s: number, h: number) => ({ carry: c, mid: m, off: o, soft: s, hard: h });
async function rejects(p: Promise<unknown>, re: RegExp) {
  await assert.rejects(p, (e: unknown) => e instanceof GameError && re.test(e.message));
}

test("фиксация до дедлайна: позиции, лимит команды, банк; повтор до дедлайна заменяет состав", async () => {
  const db = d1(), f = feed(), R = rules();
  NOW = T0 - H;
  await rejects(lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("A", 2), acc("A", 1), acc("B", 3), acc("C", 4), acc("D", 5)), captain: acc("A", 2) }), /позиции/);
  await rejects(lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("A", 1), acc("A", 2), acc("A", 3), acc("D", 4), acc("E", 5)), captain: acc("A", 1) }), /не больше 2/);
  await rejects(lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("B", 4), acc("C", 5)), captain: acc("A", 1) }), /банка/); // 50 > 48
  await rejects(lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5)), captain: acc("E", 5) }), /капитан/);
  const ok = await lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5)), captain: acc("A", 1) });
  assert.equal(ok.bank, 1); assert.equal(ok.late, false); assert.equal(ok.penalty, 0);
  const again = await lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("B", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5)), captain: acc("A", 2) });
  assert.equal(again.bank, 4);
  const m = await me(db, f, R, "t", "u1");
  assert.equal(m.stages.length, 1); assert.equal(m.stages[0]!.lineup.carry, acc("B", 1));
});

test("после дедлайна: deny — не принимается; full_stage — один раз, очки за всю стадию; after_lock — с момента фиксации", async () => {
  const f = feed(), lu = LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5));
  play(f, "G1", 2, 0, T0 + 5 * 60_000, { [acc("A", 1)]: 20, [acc("A", 2)]: 15, [acc("B", 3)]: 7 });
  f.stages[0]!.status = "live";
  NOW = T0 + 2 * H;
  await rejects(lock(d1(), f, rules(), "t", "u1", { stage: 0, lineup: lu, captain: acc("A", 1) }), /уже началась/);
  const db = d1(), R = rules({ late_lock: "full_stage" });
  const ok = await lock(db, f, R, "t", "u1", { stage: 0, lineup: lu, captain: acc("A", 1), tc: true });
  assert.equal(ok.late, true);
  await rejects(lock(db, f, R, "t", "u1", { stage: 0, lineup: lu, captain: acc("A", 1) }), /уже зафиксирован/);
  assert.equal((await me(db, f, R, "t", "u1")).total, 20 * 3 + 15 + 7); // тройной капитан
  const db2 = d1(), R2 = rules({ late_lock: "after_lock" });
  await lock(db2, f, R2, "t", "u2", { stage: 0, lineup: lu, captain: acc("A", 1) });
  assert.equal((await me(db2, f, R2, "t", "u2")).total, 0); // G1 началась до фиксации
});

test("замена стендина: только если игрок пропустил карты; очки делятся по времени замены, капитанство переходит", async () => {
  const db = d1(), f = feed(), R = rules();
  NOW = T0 - H;
  await lock(db, f, R, "t", "u1", { stage: 0, lineup: LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5)), captain: acc("A", 1) });
  f.stages[0]!.status = "live";
  play(f, "G1", 2, 1, T0, { [acc("A", 1)]: 0, [acc("A", 2)]: 10 });
  f.players[acc("A", 1)]!.stages[0]!.missed = 3;
  NOW = T0 + 2 * H;
  await rejects(swap(db, f, R, "t", "u1", { stage: 0, out: acc("A", 2), in: acc("E", 2) }), /не заменяли/);
  await rejects(swap(db, f, R, "t", "u1", { stage: 0, out: acc("A", 1), in: acc("A", 3) }), /позиции/);
  const s = await swap(db, f, R, "t", "u1", { stage: 0, out: acc("A", 1), in: acc("E", 1) });
  assert.equal(s.bank, 1 + 12 - 5);
  await rejects(swap(db, f, R, "t", "u1", { stage: 0, out: acc("A", 1), in: acc("D", 1) }), /нет в составе|уже заменяли/);
  play(f, "G3", 2, 0, T0 + 6 * H, { [acc("E", 1)]: 9, [acc("A", 2)]: 4 }); // после замены: E1 — капитан ×2
  const m = await me(db, f, R, "t", "u1");
  assert.equal(m.total, 10 + 9 * 2 + 4); assert.equal(m.stages[0]!.captain, acc("E", 1));
});

test("окно между стадиями: бесплатный трансфер, замена выбывших бесплатна, штраф, перенос бесплатных, банк по новым ценам", async () => {
  const f = feed(), R = rules();
  NOW = T0 - H;
  const lu0 = LU(acc("A", 1), acc("B", 2), acc("B", 3), acc("C", 4), acc("E", 5)); // 12+9+9+8+5 = 43, банк 5
  const db = d1();
  await lock(db, f, R, "t", "u1", { stage: 0, lineup: lu0, captain: acc("A", 1) });
  f.stages[0]!.status = "finished"; // E — 5-е место, выбыла
  for (const t of ["B"]) for (let p = 1; p <= 5; p++) f.players[acc(t, p)]!.stages[0]!.price = 10; // B подорожала
  NOW = T0 + 30 * H;
  await rejects(lock(db, f, R, "t", "u1", { stage: 1, lineup: { ...lu0, hard: acc("E", 4) }, captain: acc("A", 1) }), /позиции/);
  await rejects(lock(db, f, R, "t", "u1", { stage: 1, lineup: { ...lu0, carry: acc("E", 1) }, captain: acc("B", 2) }), /выбыла/);
  // E5 → D5 (выбывший, бесплатно) и B3 → C3 (1 бесплатный): штрафа нет; банк 5 + 5−6 + 10−8 = 6
  const a = await lock(db, f, R, "t", "u1", { stage: 1, lineup: { ...lu0, hard: acc("D", 5), off: acc("C", 3) }, captain: acc("A", 1) });
  assert.deepEqual([a.transfers, a.free, a.penalty, a.bank], [1, 1, 0, 6]);
  // ещё C4 → D4: два платных трансфера при одном бесплатном — штраф 4 (повтор до дедлайна пересчитывает)
  const b = await lock(db, f, R, "t", "u1", { stage: 1, lineup: { ...lu0, hard: acc("D", 5), off: acc("C", 3), soft: acc("D", 4) }, captain: acc("A", 1) });
  assert.deepEqual([b.transfers, b.penalty], [2, 4]);
  // перенос: в окне 1 без трансферов — в окне 2 их два
  const db2 = d1(), f2 = feed();
  f2.stages.push({ idx: 2, name: "Финал", status: "upcoming", series: [ser("GF", "A", "B", T0 + 96 * H)] });
  for (const p of Object.values(f2.players)) p.stages.push({ pts: 0, maps: 0, price: p.start.price });
  NOW = T0 - H;
  const lu = LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5));
  await lock(db2, f2, R, "t", "u2", { stage: 0, lineup: lu, captain: acc("A", 1) });
  f2.stages[0]!.status = "finished"; NOW = T0 + 30 * H;
  await lock(db2, f2, R, "t", "u2", { stage: 1, lineup: lu, captain: acc("A", 1) });
  f2.stages[1]!.status = "finished"; NOW = T0 + 80 * H;
  const c = await lock(db2, f2, R, "t", "u2", { stage: 2, lineup: { ...lu, off: acc("C", 3), soft: acc("D", 4) }, captain: acc("A", 1) });
  assert.deepEqual([c.free, c.transfers, c.penalty], [2, 2, 0]);
});

test("прогнозы: до дедлайна стадии (stage) или до начала серии (series); фиксация прогнозов", async () => {
  const f = feed(), db = d1(), R = rules();
  NOW = T0 - H;
  const all = [{ key: "G1", w: "A", sc: "2:0", a: "A", b: "B" }, { key: "G2", w: "D", sc: "2:1", a: "C", b: "D" }, { key: "G3", w: "Z", a: "E", b: "A" }];
  const r = await picks(db, f, R, "t", "u1", { stage: 0, picks: all });
  assert.deepEqual(r.preds.map((p: any) => p.key).sort(), ["G1", "G2"]); assert.equal(r.bad[0]!.key, "G3");
  NOW = T0 + 60_000; // дедлайн стадии прошёл — закрыто всё
  const r2 = await picks(db, f, R, "t", "u1", { stage: 0, picks: [] });
  assert.equal(r2.closed.length, 3); assert.equal(r2.preds.length, 2);
  // series: G1 закрыта (её время), G2 ещё открыта — пустой прогноз по ней удаляет сохранённый
  const Rs = rules({ pick_close: "series" });
  const r3 = await picks(db, f, Rs, "t", "u1", { stage: 0, picks: [{ key: "G1", w: "B", a: "A", b: "B" }] });
  assert.deepEqual(r3.closed, ["G1"]); assert.deepEqual(r3.preds.map((p: any) => [p.key, p.w]), [["G1", "A"]]);
  await pickLock(db, f, "t", "u1", 0);
  await rejects(picks(db, f, Rs, "t", "u1", { stage: 0, picks: [] }), /зафиксированы/);
  play(f, "G1", 2, 0, T0, {});
  assert.deepEqual((await me(db, f, Rs, "t", "u1")).pred_points, { pts: 2, settled: 1 });
});

test("таблица: по очкам, при равенстве — кто раньше собрал состав; своя строка — «Вы», остальные обезличены", async () => {
  const f = feed(), db = d1(), R = rules();
  NOW = T0 - H;
  const lu = LU(acc("A", 1), acc("A", 2), acc("B", 3), acc("C", 4), acc("D", 5));
  await lock(db, f, R, "t", "u1", { stage: 0, lineup: lu, captain: acc("A", 1) }); // 10×2 + 10 + 5 = 35
  await lock(db, f, R, "t", "u2", { stage: 0, lineup: { ...lu, carry: acc("B", 1) }, captain: acc("B", 3) }); // 10 + 10 + 5×2 = 30
  NOW += 1000;
  await lock(db, f, R, "t", "u3", { stage: 0, lineup: lu, captain: acc("B", 3) }); // 30, но позже
  play(f, "G1", 2, 0, T0, { [acc("A", 1)]: 10, [acc("A", 2)]: 10, [acc("B", 3)]: 5, [acc("B", 1)]: 10 });
  f.stages[0]!.status = "live"; f.generated = "g2";
  const b = await leaderboard(db, f, R, "t", "u2");
  assert.deepEqual(b.top.map((x) => [x.rank, x.total, x.me]), [[1, 35, false], [2, 30, true], [3, 30, false]]);
  assert.equal(b.me!.name, "Вы"); assert.match(b.top[0]!.name, /^Игрок /);
});
