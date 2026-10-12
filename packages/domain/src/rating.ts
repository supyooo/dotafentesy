// Рейтинг игрока (docs/12). Чистые функции: уровень игры на карте, калибровка шкалы, обновление после стадии.
// Уровень на карте = очки фэнтези без бонуса за победу в минуту, сравнённые с обычными для той же позиции в том же исходе карты.
// Так рейтинг считает ровно то, за что начисляются очки, и не зависит от длины карты и от того, выиграла ли команда.
import { rawPoints, type MapStats, type Position } from "./scoring/points.js";
import type { ScoringRuleset } from "./scoring/ruleset.js";

export interface RatingConfig {
  /** v2: доля оценки карты за результат команды (победа/поражение); остальное — личные показатели */
  win_share: number;
  /** v2: рейтинг за один турнир сдвигается не больше чем на столько пунктов; 0 — без ограничения (решение 12.10.2026) */
  max_step: number;
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
export const RATING_DEFAULT: RatingConfig = { win_share: 0.2, max_step: 0, mean: 80, target_sd: 5, k: 20, k_fast: 10, debut: 75, min: 50, max: 99 };

// ---------- v2 (решение 12.10.2026): оценка карты против всей позиции, по широкому набору показателей, веса — по данным
/** Показатели игрока на карте для рейтинга v2 — шире, чем очки фэнтези (рейтинг должен быть реалистичным). */
export interface RatingMapStats {
  position: Position; won: boolean; durationS: number;
  kills: number; deaths: number; assists: number; last_hits: number; gpm: number; xpm: number;
  hero_damage: number; building_damage: number; healing: number; stun_s: number;
  obs_placed: number; obs_killed: number; camps_stacked: number;
  net_worth: number; team_kills: number; team_net_worth: number;
}
export const RATING_FEATURES = ["kills", "deaths", "assists", "last_hits", "gpm", "xpm", "hero_damage", "building_damage", "healing",
  "stun_s", "obs_placed", "obs_killed", "camps_stacked", "kill_participation", "net_worth_share"] as const;
export type RatingFeature = (typeof RATING_FEATURES)[number];
export const RATING_FEATURE_RU: Record<RatingFeature, string> = {
  kills: "убийства", deaths: "смерти", assists: "помощь", last_hits: "добивания", gpm: "GPM", xpm: "XPM", hero_damage: "урон по героям",
  building_damage: "урон по строениям", healing: "лечение", stun_s: "оглушения", obs_placed: "варды", obs_killed: "снятые варды",
  camps_stacked: "стаки", kill_participation: "участие в убийствах", net_worth_share: "доля net worth в команде",
};

/** Показатели на 40 минут (счётчики), GPM/XPM как есть, доли — в долях. */
export function ratingFeatures(s: RatingMapStats): Record<RatingFeature, number> {
  const per = 40 / Math.max(s.durationS / 60, 10);
  return {
    kills: s.kills * per, deaths: s.deaths * per, assists: s.assists * per, last_hits: s.last_hits * per, gpm: s.gpm, xpm: s.xpm,
    hero_damage: s.hero_damage * per, building_damage: s.building_damage * per, healing: s.healing * per, stun_s: s.stun_s * per,
    obs_placed: s.obs_placed * per, obs_killed: s.obs_killed * per, camps_stacked: s.camps_stacked * per,
    kill_participation: s.team_kills > 0 ? (s.kills + s.assists) / s.team_kills : 0,
    net_worth_share: s.team_net_worth > 0 ? s.net_worth / s.team_net_worth : 0.2,
  };
}

export interface ImpactModel {
  win_share: number;
  byPos: Record<Position, { features: Record<RatingFeature, { mean: number; sd: number; corr: number; weight: number }>; mean: number; sd: number; n: number }>;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
const sd = (xs: number[], m = mean(xs)) => Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / Math.max(1, xs.length - 1)) || 1;

/** Веса показателей позиции = связь показателя с победой на карте (корреляция), нормированная так, чтобы
 *  личные показатели давали (1 − win_share) оценки, а результат команды — win_share. Отрицательная связь (смерти) — штраф. */
export function fitImpactModel(rows: RatingMapStats[], winShare = RATING_DEFAULT.win_share): ImpactModel {
  const byPos = {} as ImpactModel["byPos"];
  for (const pos of [1, 2, 3, 4, 5] as Position[]) {
    const rs = rows.filter((r) => r.position === pos), fs = rs.map(ratingFeatures), won = rs.map((r) => (r.won ? 1 : 0));
    const wm = mean(won), wsd = sd(won, wm);
    const features = {} as ImpactModel["byPos"][Position]["features"];
    for (const f of RATING_FEATURES) {
      const xs = fs.map((x) => x[f]), m = mean(xs), s = sd(xs, m);
      const corr = xs.reduce((a, x, i) => a + (x - m) * (won[i]! - wm), 0) / Math.max(1, xs.length - 1) / (s * wsd);
      features[f] = { mean: m, sd: s, corr, weight: 0 };
    }
    const tot = RATING_FEATURES.reduce((a, f) => a + Math.abs(features[f].corr), 0) || 1;
    for (const f of RATING_FEATURES) features[f].weight = (features[f].corr / tot) * (1 - winShare);
    const raw = rs.map((r, i) => impactRaw(fs[i]!, r.won, features, winShare));
    const m = mean(raw);
    byPos[pos] = { features, mean: m, sd: sd(raw, m), n: rs.length };
  }
  return { win_share: winShare, byPos };
}

function impactRaw(x: Record<RatingFeature, number>, won: boolean, features: ImpactModel["byPos"][Position]["features"], winShare: number) {
  let v = winShare * (won ? 1 : -1);
  for (const f of RATING_FEATURES) v += features[f].weight * ((x[f] - features[f].mean) / features[f].sd);
  return v;
}

/** Оценка игры на карте v2 в стандартных отклонениях позиции: личные показатели (против всей позиции) + результат команды. */
export function mapImpact(s: RatingMapStats, m: ImpactModel): number {
  const p = m.byPos[s.position];
  return (impactRaw(ratingFeatures(s), s.won, p.features, m.win_share) - p.mean) / p.sd;
}

/** Ограничение сдвига за турнир: рейтинг остаётся в пределах старт турнира ± max_step. */
export const clampStep = (rating: number, tournamentStart: number, c: RatingConfig = RATING_DEFAULT) =>
  Math.max(tournamentStart - c.max_step, Math.min(tournamentStart + c.max_step, rating));

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
/** Уровень игры по набору карт — на той же шкале, что и рейтинг, и в тех же границах (50–99, решение 12.10.2026). */
export const levelOf = (zs: number[], scale: number, c: RatingConfig = RATING_DEFAULT) =>
  Math.max(c.min, Math.min(c.max, c.mean + scale * (zs.reduce((a, b) => a + b, 0) / zs.length)));

/** Сдвиг рейтинга к уровню игры: доля = карты / (карты + k). Чтобы расти, надо играть выше текущего рейтинга. */
export function updateRating(old: number, level: number, maps: number, k: number, c: RatingConfig = RATING_DEFAULT): number {
  if (maps <= 0) return old;
  const next = old + (maps / (maps + k)) * (level - old);
  return Math.max(c.min, Math.min(c.max, next));
}
