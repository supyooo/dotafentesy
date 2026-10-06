// Отчёт спайка → spikes/live-source/REPORT.md. Итог (data/final.json) + live-логи (data/live/*.jsonl), если есть.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA, SPIKE, LEAGUE_ID, POS_NAME, type Pos } from "./common.js";
import { RULESET } from "./scoring.js";
import type { FinalRow } from "./final.js";
import type { LiveTick } from "./live.js";

const rows: FinalRow[] = JSON.parse(readFileSync(join(DATA, "final.json"), "utf8"));
const P: Pos[] = [1, 2, 3, 4, 5];
const avg = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
const med = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };
const f1 = (x: number) => x.toFixed(1).replace(".", ","), f2 = (x: number) => x.toFixed(2).replace(".", ","), pct = (x: number) => Math.round(x * 100) + "%";
const R = RULESET;
const parsedRows = rows.filter((r) => r.parsed && r.pos);
const maps = new Set(rows.map((r) => r.match_id)).size, parsedMaps = new Set(parsedRows.map((r) => r.match_id)).size;

// разбивка сырых очков по статьям — средние на карту по позиции
const parts = (r: FinalRow) => {
  const s = r.stats;
  return {
    "Убийства": s.kills * R.kill, "Помощь": s.assists * R.assist, "Смерти": s.deaths * R.death, "Добивания": s.last_hits * R.last_hit,
    "Победа": s.won ? R.win : 0, "Урон по строениям": ((s.building_damage ?? 0) / 1000) * R.building_damage_per_1000,
    "Лечение": ((s.healing ?? 0) / 1000) * R.healing_per_1000,
    "Оглушения": (s.stun_s ?? 0) * R.stun_s, "Варды": (s.obs_placed ?? 0) * R.obs_placed, "Снятые варды": (s.obs_killed ?? 0) * R.obs_killed,
    "Стаки": (s.camps_stacked ?? 0) * R.camp_stacked,
  };
};
const keys = Object.keys(parts(parsedRows[0]!)) as Array<keyof ReturnType<typeof parts>>;
const byPos = (p: Pos) => parsedRows.filter((r) => r.pos === p);
const mult = Object.fromEntries(P.map((p) => [p, 10 / avg(byPos(p).map((r) => r.points.parsed))])) as Record<Pos, number>;

let md = `# Спайк данных — BLAST Slam VIII (league ${LEAGUE_ID})\n\nСобрано ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. `;
md += `Карт в OpenDota: **${maps}**, разобрано: **${parsedMaps}**. Правила: **\`${R.version}\`** — ${R.note}. Очки сырые, до множителя роли.\n\n`;

md += `## 1. Средние сырые очки за карту и предлагаемые множители\nЦель спеки — средний игрок любой позиции = 10 очков за карту → множитель = 10 / среднее.\n\n`;
md += `| Позиция | Карт | Среднее | Медиана | Предлагаемый множитель | Текущий (симуляция) |\n|---|---|---|---|---|---|\n`;
const OLD: Record<Pos, number> = { 1: 1.14, 2: 1.08, 3: 1.07, 4: 1.02, 5: 0.96 };
for (const p of P) { const a = byPos(p).map((r) => r.points.parsed); md += `| ${POS_NAME[p]} | ${a.length} | ${f2(avg(a))} | ${f2(med(a))} | **${f2(mult[p])}** | ${f2(OLD[p])} |\n`; }

md += `\n## 2. Из чего складываются очки (среднее на карту)\n\n| Статья | ${P.map((p) => POS_NAME[p]).join(" | ")} |\n|---|${P.map(() => "---").join("|")}|\n`;
for (const k of keys) md += `| ${k} | ${P.map((p) => f2(avg(byPos(p).map((r) => parts(r)[k])))).join(" | ")} |\n`;

md += `\n## 3. Когда приходят очки — три уровня данных (docs/08)\nДоля от итоговых очков карты (среднее по картам; отрицательные смерти учтены в live).\n\n`;
md += `| Позиция | live (K/D/A, добивания) | конец карты (+победа, строения, лечение) | после разбора (+оглушения, варды, стаки) | обзор и контроль |\n|---|---|---|---|---|\n`;
for (const p of P) {
  const rs = byPos(p), tot = rs.reduce((s, r) => s + r.points.parsed, 0);
  const live = rs.reduce((s, r) => s + r.points.live, 0), basic = rs.reduce((s, r) => s + r.points.basic, 0), vc = rs.reduce((s, r) => s + r.points.vision_control, 0);
  md += `| ${POS_NAME[p]} | ${pct(live / tot)} | ${pct((basic - live) / tot)} | ${pct((tot - basic) / tot)} | ${pct(vc / tot)}${p >= 4 && vc / tot > 1 / 3 ? " ⚠ больше трети" : ""} |\n`;
}
md += `\nСпека (02 §5): у саппорта обзор и контроль — не больше трети очков.\n`;

md += `\n## 4. Экономика: распределение очков за карту после множителя\nПороги изменения цены (02 §6). Доля карт игроков позиции в каждой корзине при предложенных множителях.\n\n`;
const bins: Array<[string, (x: number) => boolean]> = [["≤ 6 (−1.0)", (x) => x <= 6], ["6.1–8 (−0.5)", (x) => x > 6 && x <= 8], ["8.1–11.9 (0)", (x) => x > 8 && x < 12], ["12–13.9 (+0.5)", (x) => x >= 12 && x < 14], ["≥ 14 (+1.0)", (x) => x >= 14]];
md += `| Корзина | ${P.map((p) => POS_NAME[p]).join(" | ")} |\n|---|${P.map(() => "---").join("|")}|\n`;
for (const [name, fn] of bins) md += `| ${name} | ${P.map((p) => { const a = byPos(p).map((r) => r.points.parsed * mult[p]); return pct(a.filter(fn).length / a.length); }).join(" | ")} |\n`;
md += `\nЦена меняется по очкам за карту за всю стадию, а не по одной карте — по стадии разброс будет меньше; это верхняя оценка волатильности.\n`;

// ---------- live
const liveDir = join(DATA, "live");
const files = existsSync(liveDir) ? readdirSync(liveDir).filter((f) => f.endsWith(".jsonl")) : [];
md += `\n## 5. Live: Steam GetLiveLeagueGames\n`;
if (!files.length) md += `\nНет данных: опрос не запускался (нужен ключ Steam Web API, см. README).\n`;
else {
  const ticks: LiveTick[] = files.flatMap((f) => readFileSync(join(liveDir, f), "utf8").trim().split("\n").map((l) => JSON.parse(l) as LiveTick));
  const ok = ticks.filter((t) => t.ok), delays = ok.map((t) => t.stream_delay_s).filter((x): x is number => x != null);
  const matchIds = [...new Set(ok.map((t) => t.match_id).filter((x): x is number => !!x))];
  md += `\nОпросов: ${ticks.length}, успешных: ${ok.length} (${pct(ok.length / Math.max(1, ticks.length))}). Карт увидено: ${matchIds.length}.\n`;
  md += `\`stream_delay_s\`: медиана ${f1(med(delays))} с, мин ${f1(Math.min(...delays))}, макс ${f1(Math.max(...delays))}.\n\n`;
  const fin = new Map(rows.map((r) => [`${r.match_id}:${r.account_id}`, r]));
  const lastTick = new Map<string, LiveTick["players"][number]>();
  for (const t of ok) for (const p of t.players ?? []) lastTick.set(`${t.match_id}:${p.account_id}`, p);
  const diffs: number[] = []; let n = 0;
  for (const [k, p] of lastTick) { const f = fin.get(k); if (!f) continue; n++; diffs.push(Math.abs(p.live_points - f.points.live)); }
  md += `Сравнение последнего live-тика с итогом (уровень live) по ${n} игрокам×картам: средняя разница ${f2(avg(diffs))}, медиана ${f2(med(diffs))}.\n`;
}
writeFileSync(join(SPIKE, "REPORT.md"), md);
console.log(md);
