import { describe, expect, it } from "vitest";
import { baselines, calibrateScale, mapZ, pointsPerMinute, RATING_DEFAULT, updateRating } from "./rating.js";
import { RULESET_SPEC } from "./scoring/ruleset.js";

describe("рейтинг (docs/12)", () => {
  it("примеры из docs/12: высокому рейтингу труднее расти", () => {
    expect(updateRating(90, 87, 6, 10)).toBeCloseTo(88.875, 3);
    expect(updateRating(76, 86, 6, 10)).toBeCloseTo(79.75, 3);
    expect(updateRating(76, 86, 15, 10)).toBeCloseTo(82, 3);
  });
  it("без карт рейтинг не меняется, границы 50–99", () => {
    expect(updateRating(80, 99, 0, 10)).toBe(80);
    expect(updateRating(98, 140, 100, 10)).toBe(RATING_DEFAULT.max);
  });
  it("очки в минуту без бонуса за победу: длинная карта не раздувает уровень", () => {
    const s = { kills: 10, deaths: 2, assists: 10, last_hits: 400, won: true };
    expect(pointsPerMinute(s, 40 * 60, RULESET_SPEC)).toBeCloseTo(pointsPerMinute({ ...s, won: false }, 40 * 60, RULESET_SPEC), 6);
    const double = { kills: 20, deaths: 4, assists: 20, last_hits: 800 };
    expect(pointsPerMinute(double, 80 * 60, RULESET_SPEC)).toBeCloseTo(pointsPerMinute(s, 40 * 60, RULESET_SPEC), 6);
  });
  it("сравнение внутри позиции и исхода: проигравший с цифрами выше обычных для проигравших — плюс", () => {
    const rows = [
      { position: 5 as const, won: false, ppm: 0.1 }, { position: 5 as const, won: false, ppm: 0.2 }, { position: 5 as const, won: false, ppm: 0.3 },
      { position: 5 as const, won: true, ppm: 0.4 }, { position: 5 as const, won: true, ppm: 0.5 }, { position: 5 as const, won: true, ppm: 0.6 },
    ];
    const b = baselines(rows);
    expect(mapZ({ position: 5, won: false, ppm: 0.35 }, b)).toBeGreaterThan(0);
    expect(mapZ({ position: 5, won: true, ppm: 0.35 }, b)).toBeLessThan(0);
  });
  it("шкала: шум отдельных карт не растягивает рейтинги", () => {
    const players = Array.from({ length: 50 }, (_, i) => ({ n: 20, meanZ: (i - 25) / 50 }));
    const s = calibrateScale(players, 5);
    expect(s).toBeGreaterThan(5);
  });
});
