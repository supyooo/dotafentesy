// Экономика после решений 12.10.2026 (02 §5–6): очки игрока за серию как у BLAST, цена = рейтинг + сила команды.
// Версия цены v1 — для тестов на прошедших турнирах; все числа в конфиге, их подбирают сценариями.
import type { Position } from "./scoring/points.js";

/** Очки игрока за серию: среднее его очков за карты серии + бонус за победу в серии (02 §5 п.3). */
export function seriesPoints(mapPoints: number[], wonSeries: boolean, bonus = 5): number {
  if (!mapPoints.length) return 0;
  return Math.round((mapPoints.reduce((a, b) => a + b, 0) / mapPoints.length + (wonSeries ? bonus : 0)) * 10) / 10;
}

/** Сила команды — шанс выиграть карту: доля побед на картах, подтянутая к 50% (у команды с малым числом карт). */
export function teamWinChance(wins: number, maps: number, priorMaps = 20): number {
  return (wins + priorMaps * 0.5) / (maps + priorMaps);
}

/** Модель ожидаемых очков за карту — из данных: средние в победе и поражении по позициям и сколько даёт пункт рейтинга. */
export interface PointsModel {
  win: Record<Position, number>;
  loss: Record<Position, number>;
  per_rating: Record<Position, number>;
}

/** Ожидаемые очки игрока за карту: поражение + шанс победы × разница + поправка на личный уровень (рейтинг относительно 80). */
export function expectedMapPoints(rating: number, pWin: number, pos: Position, m: PointsModel): number {
  return m.loss[pos] + pWin * (m.win[pos] - m.loss[pos]) + m.per_rating[pos] * (rating - 80);
}

export interface PriceV1Config { min: number; max: number; step: number; curve: number }
export const PRICE_V1: PriceV1Config = { min: 4.5, max: 12.5, step: 0.5, curve: 1.3 };

/** Цена из ожидаемых очков: lo/hi — границы шкалы, фиксируются на старте турнира (5-й и 95-й перцентиль пула),
 *  поэтому после стадий цена движется в абсолютных величинах. Выгнутая кривая: звёзды дороже, середина дешевле. */
export function priceFromExpected(e: number, lo: number, hi: number, c: PriceV1Config = PRICE_V1): number {
  const x = Math.max(0, Math.min(1, (e - lo) / (hi - lo || 1)));
  const v = c.min + (c.max - c.min) * Math.pow(x, c.curve);
  return Math.max(c.min, Math.min(c.max, Math.round(v / c.step) * c.step));
}

export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b), i = (s.length - 1) * q, lo = Math.floor(i), hi = Math.ceil(i);
  return s[lo]! + (s[hi]! - s[lo]!) * (i - lo);
};
