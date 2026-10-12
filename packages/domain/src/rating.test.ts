import { describe, expect, it } from "vitest";
import { baselines, calibrateScale, clampStep, fitImpactModel, mapImpact, mapZ, pointsPerMinute, RATING_DEFAULT, updateRating, type RatingMapStats } from "./rating.js";
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
  it("v2: веса — по связи с победой; сильная игра в поражении выше слабой; победа добавляет", () => {
    const base: Omit<RatingMapStats, "won" | "kills" | "deaths"> = { position: 1, durationS: 2400, assists: 8, last_hits: 300, gpm: 600, xpm: 650,
      hero_damage: 20000, building_damage: 3000, healing: 0, stun_s: 10, obs_placed: 0, obs_killed: 0, camps_stacked: 1,
      net_worth: 20000, team_kills: 25, team_net_worth: 70000 };
    const rows: RatingMapStats[] = [];
    for (let i = 0; i < 200; i++) {
      const won = i % 2 === 0;
      rows.push({ ...base, won, kills: (won ? 9 : 4) + (i % 5), deaths: (won ? 2 : 6) + (i % 3) });
    }
    const m = fitImpactModel(rows, 0.2);
    expect(m.byPos[1].features.kills.weight).toBeGreaterThan(0);
    expect(m.byPos[1].features.deaths.weight).toBeLessThan(0);
    const strongLoss = mapImpact({ ...base, won: false, kills: 12, deaths: 2 }, m), weakLoss = mapImpact({ ...base, won: false, kills: 3, deaths: 8 }, m);
    expect(strongLoss).toBeGreaterThan(weakLoss);
    expect(mapImpact({ ...base, won: true, kills: 7, deaths: 4 }, m)).toBeGreaterThan(mapImpact({ ...base, won: false, kills: 7, deaths: 4 }, m));
  });
  it("v2: за турнир не больше ±5", () => {
    expect(clampStep(95, 85)).toBe(90);
    expect(clampStep(78, 85)).toBe(80);
    expect(clampStep(87, 85)).toBe(87);
  });
  it("шкала: шум отдельных карт не растягивает рейтинги", () => {
    const players = Array.from({ length: 50 }, (_, i) => ({ n: 20, meanZ: (i - 25) / 50 }));
    const s = calibrateScale(players, 5);
    expect(s).toBeGreaterThan(5);
  });
});
