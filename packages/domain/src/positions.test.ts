import { describe, expect, it } from "vitest";
import { inferPositions, modePosition } from "./positions.js";

const team = (...p: Array<[string, number | null, number]>) => p.map(([key, laneRole, netWorth]) => ({ key, laneRole, netWorth }));
const asObj = (m: Map<string, number>) => Object.fromEntries([...m.entries()].sort());

describe("позиции по карте (docs/12 §5)", () => {
  it("обычная раскладка: линии и net worth согласны", () => {
    expect(asObj(inferPositions(team(["carry", 1, 30000], ["mid", 2, 26000], ["off", 3, 20000], ["four", 3, 9000], ["five", 1, 6000]))))
      .toEqual({ carry: 1, five: 5, four: 4, mid: 2, off: 3 });
  });
  it("мидер богаче керри — позиции по линиям, а не по богатству", () => {
    expect(asObj(inferPositions(team(["carry", 1, 22000], ["mid", 2, 31000], ["off", 3, 18000], ["four", 3, 9000], ["five", 1, 7000]))))
      .toEqual({ carry: 1, five: 5, four: 4, mid: 2, off: 3 });
  });
  it("четвёрка роумит через центр: в мидерах она не оказывается — она не ядро", () => {
    expect(asObj(inferPositions(team(["carry", 1, 25000], ["mid", 2, 24000], ["off", 3, 19000], ["four", 2, 10000], ["five", 1, 6000]))))
      .toEqual({ carry: 1, five: 5, four: 4, mid: 2, off: 3 });
  });
  it("линии неизвестны (нет разбора): по net worth, мидер — самое богатое ядро", () => {
    expect(asObj(inferPositions(team(["a", null, 30000], ["b", null, 25000], ["c", null, 20000], ["d", null, 9000], ["e", null, 6000]))))
      .toEqual({ a: 2, b: 1, c: 3, d: 4, e: 5 });
  });
  it("неполная команда — без позиций", () => {
    expect(inferPositions(team(["a", 1, 1], ["b", 2, 1])).size).toBe(0);
  });
  it("позиция на турнире — самая частая по картам", () => {
    expect(modePosition([1, 1, 2, 1])).toEqual({ position: 1, share: 0.75 });
    expect(modePosition([])).toBeNull();
  });
});
