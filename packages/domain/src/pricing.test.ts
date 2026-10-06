import { describe, expect, it } from "vitest";
import { priceAfterStage, startPrice } from "./pricing.js";

describe("цены 02 §6", () => {
  it("стартовая кривая как в прототипе: 4.5 + 8·x^1.3, шаг 0.5", () => {
    expect(startPrice(60)).toBe(4.5);
    expect(startPrice(90)).toBe(12.5);
    expect(startPrice(81)).toBe(Math.round((4.5 + 8 * Math.pow(0.5, 1.3)) * 2) / 2);
  });
  it("изменение по таблице, границы включительно", () => {
    expect(priceAfterStage(8, 14).change).toBe(1);
    expect(priceAfterStage(8, 12).change).toBe(0.5);
    expect(priceAfterStage(8, 11.9).change).toBe(0);
    expect(priceAfterStage(8, 8.1).change).toBe(0);
    expect(priceAfterStage(8, 8).change).toBe(-0.5);
    expect(priceAfterStage(8, 6.1).change).toBe(-0.5);
    expect(priceAfterStage(8, 6).change).toBe(-1);
  });
  it("границы 4.5 и 12.5", () => {
    expect(priceAfterStage(12.5, 20)).toEqual({ price: 12.5, change: 0 });
    expect(priceAfterStage(5, 0)).toEqual({ price: 4.5, change: -0.5 });
  });
});
