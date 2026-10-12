// Рейтинг игрока (docs/12). Чистые функции: уровень игры на карте, калибровка шкалы, обновление после стадии.
// Уровень на карте = очки фэнтези без бонуса за победу в минуту, сравнённые с обычными для той же позиции в том же исходе карты.
// Так рейтинг считает ровно то, за что начисляются очки, и не зависит от длины карты и от того, выиграла ли команда.
import { rawPoints, type MapStats, type Position } from "./scoring/points.js";
import type { ScoringRuleset } from "./scoring/ruleset.js";

export interface RatingConfig {
  /** Средний игрок тир-1 */
  mean: number;
  /** Разброс настоящего уровня игроков на шкале (стандартное отклонение); по нему калибруется scale */
  target_sd: number;
  /** Сколько карт сдвигают рейтинг наполовину к уровню игры: доля = карты / (карты + k) */
  k: number;
  /** Ускоренная адаптация: дебютант и игрок на новой позиции в первом турнире */
  k_fast: number;
  /** Старт дебютанта (нет карт тир-1 за полгода до отправной точки) */
  debut: number;
  min: number; max: number;
}

/** k = 20 подобран проверкой прогноза (cli rating-eval): рейтинг до Slam VIII предсказывает игру на нём лучше всего при k 10–20,
 *  а при 20 меньше ошибка и скачки (12.10.2026). */
export const RATING_DEFAULT: RatingConfig = { mean: 80, target_sd: 5, k: 20, k_fast: 10, debut: 75, min: 50, max: 99 };

/** Очки фэнтези без бонуса за победу в минуту (сырые, без множителя роли: сравнение идёт внутри позиции). */
export function pointsPerMinute(s: MapStats, durationS: number, r: ScoringRuleset): number {
  return rawPoints({ ...s, won: null }, r).parsed / Math.max(durationS / 60, 10);
}

export interface PerfRow { position: Position; won: boolean; ppm: number }
export interface Baseline { mean: number; sd: number; n: number }
const key = (p: Position, won: boolean) => `${p}:${won ? "w" : "l"}`;

/** Обычный уровень по позиции и исходу карты: среднее и разброс очков в минуту. */
export function baselines(rows: PerfRow[]): Map<string, Baseline> {
  const acc = new Map<string, number[]>();
  for (const r of rows) acc.set(key(r.position, r.won), [...(acc.get(key(r.position, r.won)) ?? []), r.ppm]);
  const out = new Map<string, Baseline>();
  for (const [k, xs] of acc) {
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;
    out.set(k, { mean, sd, n: xs.length });
  }
  return out;
}

/** Отклонение игры на карте от обычной для позиции и исхода — в стандартных отклонениях. */
export function mapZ(r: PerfRow, b: Map<string, Baseline>): number {
  const x = b.get(key(r.position, r.won));
  return x ? (r.ppm - x.mean) / x.sd : 0;
}

/** Шкала: сколько пунктов рейтинга даёт 1 стандартное отклонение «настоящего» уровня. Отдельная карта шумная,
 *  поэтому разброс средних по игрокам очищается от шума (≈ 1/карты на игрока), и шкала растягивается до target_sd. */
export function calibrateScale(players: Array<{ n: number; meanZ: number }>, targetSd: number): number {
  const ps = players.filter((p) => p.n >= 10);
  if (ps.length < 5) return targetSd;
  const m = ps.reduce((a, p) => a + p.meanZ, 0) / ps.length;
  const varObs = ps.reduce((a, p) => a + (p.meanZ - m) ** 2, 0) / (ps.length - 1);
  const noise = ps.reduce((a, p) => a + 1 / p.n, 0) / ps.length;
  const trueSd = Math.sqrt(Math.max(varObs - noise, 0.01));
  return targetSd / trueSd;
}

/** Уровень игры по набору карт на шкале рейтинга. */
export const levelOf = (zs: number[], scale: number, c: RatingConfig = RATING_DEFAULT) =>
  c.mean + scale * (zs.reduce((a, b) => a + b, 0) / zs.length);

/** Сдвиг рейтинга к уровню игры: доля = карты / (карты + k). Чтобы расти, надо играть выше текущего рейтинга. */
export function updateRating(old: number, level: number, maps: number, k: number, c: RatingConfig = RATING_DEFAULT): number {
  if (maps <= 0) return old;
  const next = old + (maps / (maps + k)) * (level - old);
  return Math.max(c.min, Math.min(c.max, next));
}
