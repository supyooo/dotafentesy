// Экономика 02 §6. Все числа — из конфига турнира (tournaments.config.price), здесь только формулы.
export interface PriceConfig {
  min: number; max: number; step: number;
  /** Стартовая кривая: x = (rating − rating_lo) / (rating_hi − rating_lo) ∈ [0,1], цена = min + (max − min)·x^curve */
  rating_lo: number; rating_hi: number; curve: number;
  /** Изменение после стадии по очкам за карту: первая подходящая строка сверху (from — включительно). */
  change: Array<{ from: number; delta: number }>;
}

export const PRICE_DEFAULT: PriceConfig = {
  min: 4.5, max: 12.5, step: 0.5, rating_lo: 72, rating_hi: 90, curve: 1.3,
  change: [{ from: 14, delta: 1 }, { from: 12, delta: 0.5 }, { from: 8.05, delta: 0 }, { from: 6.05, delta: -0.5 }, { from: -Infinity, delta: -1 }],
};

const snap = (v: number, step: number) => Math.round(v / step) * step;

export function startPrice(rating: number, c: PriceConfig = PRICE_DEFAULT): number {
  const x = Math.max(0, Math.min(1, (rating - c.rating_lo) / (c.rating_hi - c.rating_lo)));
  return snap(c.min + (c.max - c.min) * Math.pow(x, c.curve), c.step);
}

/** Новая цена после стадии; очки за карту — без капитанского множителя. */
export function priceAfterStage(price: number, pointsPerMap: number, c: PriceConfig = PRICE_DEFAULT): { price: number; change: number } {
  const delta = c.change.find((b) => pointsPerMap >= b.from)?.delta ?? 0;
  const next = Math.max(c.min, Math.min(c.max, price + delta));
  return { price: next, change: next - price };
}
