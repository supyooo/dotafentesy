import { describe, expect, it } from "vitest";
import { expectedMapPoints, priceFromExpected, quantile, seriesPoints, teamWinChance } from "./economy.js";

describe("очки серии как у BLAST (02 §5 п.3)", () => {
  it("среднее за карты + бонус победителю: 2:0 выше, чем проигравший 1:2", () => {
    const pari = seriesPoints([10, 10], true), og = seriesPoints([10.2, 10.3, 10.2], false);
    expect(pari).toBe(15);
    expect(og).toBeCloseTo(10.2, 1);
    expect(pari).toBeGreaterThan(og);
  });
  it("без карт — 0", () => expect(seriesPoints([], true)).toBe(0));
});

describe("цена v1 = рейтинг + сила команды (02 §6)", () => {
  const m = { win: { 1: 14, 2: 14, 3: 14, 4: 14, 5: 14 }, loss: { 1: 6.6, 2: 6.6, 3: 6.6, 4: 6.6, 5: 6.6 }, per_rating: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 } } as const;
  it("одинаковый рейтинг: игрок сильной команды дороже", () => {
    expect(expectedMapPoints(85, 0.7, 5, m)).toBeGreaterThan(expectedMapPoints(85, 0.35, 5, m));
  });
  it("в одной команде дороже тот, у кого рейтинг выше", () => {
    expect(expectedMapPoints(85, 0.35, 5, m)).toBeGreaterThan(expectedMapPoints(78, 0.35, 5, m));
  });
  it("шкала цены 4.5–12.5, шаг 0.5", () => {
    expect(priceFromExpected(5, 6, 14)).toBe(4.5);
    expect(priceFromExpected(20, 6, 14)).toBe(12.5);
    expect(priceFromExpected(10, 6, 14) * 2 % 1).toBe(0);
  });
  it("сила команды подтягивается к 50% при малом числе карт", () => {
    expect(teamWinChance(2, 2)).toBeCloseTo(12 / 22, 6);
    expect(teamWinChance(70, 100)).toBeCloseTo(80 / 120, 6);
  });
  it("перцентиль", () => expect(quantile([1, 2, 3, 4, 5], 0.5)).toBe(3));
});
