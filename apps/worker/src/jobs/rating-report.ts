// Отчёт по рейтингу для проверки глазами (docs/12 «Проверка — таблица рейтингов глазами Georgy»).
import { RATING_FEATURE_RU, RATING_FEATURES } from "@df/domain";
import type { PlayerRating, RatingRun } from "./rating.js";

export type PoolEntry = { player_id: number; tag: string; position: number; tmp: number | null };

const POS = ["", "керри", "мид", "оффлейн", "саппорт 4", "саппорт 5"];
const f1 = (x: number) => x.toFixed(1);

export function ratingReport(run: RatingRun, pool: PoolEntry[], slug: string, mapsTotal: number): string {
  const rows = pool.map((e) => ({ e, p: run.players.get(e.player_id) })).filter((x) => x.p)
    .sort((a, b) => b.p!.final - a.p!.final);
  const last = run.chain[run.chain.length - 1]!;
  const prev = run.chain.filter((s) => s !== slug);
  const L: string[] = [];
  L.push(`# Рейтинг игроков v1 — пул ${run.names[slug] ?? slug}`, "");
  L.push(`Модель — docs/12. Отправная точка — ${run.names[run.anchor]}; кого не было — последний тир-1 турнир за полгода до него; иначе дебютант 75.`);
  L.push(`Дальше рейтинг обновляется по стадиям: ${run.chain.map((s) => run.names[s] ?? s).join(" → ")}. Карт в расчёте (все загруженные турниры): ${mapsTotal}.`);
  L.push(`Рейтинг v2: оценка карты — показатели игрока против всей его позиции (не внутри исхода) + ${Math.round(run.model.win_share * 100)}% за результат команды;`);
  L.push(`веса показателей по позициям — их связь с победой на всех загруженных картах (таблица внизу). Уровень игры — в границах шкалы 50–99; ограничения сдвига за турнир нет.`);
  L.push(`Шкала: средний игрок тир-1 = 80, разброс настоящего уровня ±5 (1 стандартное отклонение карты = ${f1(run.scale)} пункта до усреднения).`, "");
  L.push(`«Было» — выдуманный рейтинг прототипа (сила команды + надбавка звезде), для сравнения.`, "");

  L.push(`| # | Игрок | Команда | Позиция | Старт: откуда (карт) | Старт | ${prev.map((s) => `После ${run.names[s] ?? s}`).join(" | ")} | После ${run.names[slug] ?? slug} | Δ за ${run.names[slug] ?? slug} | По стадиям | Было |`);
  L.push(`|---|---|---|---|---|---|${prev.map(() => "---|").join("")}---|---|---|---|`);
  rows.forEach(({ e, p }, i) => {
    const before = lastBefore(run, p!, slug);
    const stages = p!.steps.filter((s) => s.tournament === slug).map((s) => f1(s.rating)).join(" → ");
    const cols = prev.map((s) => (p!.after[s] != null ? f1(p!.after[s]!) : "—"));
    const fin = p!.after[slug] ?? p!.final;
    L.push(`| ${i + 1} | ${p!.nickname} | ${e.tag} | ${POS[e.position]} | ${p!.start.source} (${p!.start.maps}) | ${f1(p!.start.rating)} | ${cols.join(" | ")} | **${f1(fin)}** | ${fin - before >= 0 ? "+" : ""}${f1(fin - before)} | ${stages || "—"} | ${e.tmp != null ? f1(e.tmp) : "—"} |`);
  });

  L.push("", "## По позициям", "", "| Позиция | Игроков | Средний | Лучший | Худший |", "|---|---|---|---|---|");
  for (const pos of [1, 2, 3, 4, 5]) {
    const xs = rows.filter((r) => r.e.position === pos).map((r) => ({ n: r.p!.nickname, v: r.p!.after[slug] ?? r.p!.final }));
    if (!xs.length) continue;
    const best = xs.reduce((a, b) => (b.v > a.v ? b : a)), worst = xs.reduce((a, b) => (b.v < a.v ? b : a));
    L.push(`| ${POS[pos]} | ${xs.length} | ${f1(xs.reduce((a, b) => a + b.v, 0) / xs.length)} | ${best.n} ${f1(best.v)} | ${worst.n} ${f1(worst.v)} |`);
  }
  const fast = rows.filter((r) => r.p!.fast.length);
  if (fast.length) {
    L.push("", "## Ускоренная адаптация (дебют или новая позиция)", "");
    for (const r of fast) L.push(`- ${r.p!.nickname} (${r.e.tag}): ${r.p!.fast.join("; ")}`);
  }
  // веса показателей по позициям — из данных: связь с победой на карте (корреляция), доля в оценке карты
  L.push("", "## Веса показателей по позициям (v2)", "",
    `Доля в оценке карты; минус — показатель связан с поражением (штраф). Результат команды — ${Math.round(run.model.win_share * 100)}% у всех позиций.`, "");
  L.push(`| Показатель | ${[1, 2, 3, 4, 5].map((p) => POS[p]).join(" | ")} |`, `|---|${[1, 2, 3, 4, 5].map(() => "---|").join("")}`);
  for (const f of RATING_FEATURES)
    L.push(`| ${RATING_FEATURE_RU[f]} | ${([1, 2, 3, 4, 5] as const).map((p) => `${(run.model.byPos[p].features[f].weight * 100).toFixed(1)}%`).join(" | ")} |`);
  L.push("", `Последний турнир цепочки: ${run.names[last] ?? last}.`, "");
  return L.join("\n");
}

/** Рейтинг перед турниром: после последнего сыгранного турнира цепочки до него, иначе стартовый. */
function lastBefore(run: RatingRun, p: PlayerRating, slug: string): number {
  let v = p.start.rating;
  for (const s of run.chain) { if (s === slug) break; if (p.after[s] != null) v = p.after[s]!; }
  return v;
}
