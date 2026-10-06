import { describe, expect, it } from "vitest";
import { RULESET_B, RULESET_SPEC, mapPoints, rawPoints, type MapStats } from "../index.js";

const carry: MapStats = { kills: 10, deaths: 2, assists: 8, last_hits: 400, won: true, building_damage: 8000, healing: 0,
  stun_s: 10, obs_placed: 0, obs_killed: 1, camps_stacked: 2 };

describe("rawPoints — таблица 02 §5", () => {
  it("live: только K/D/A и добивания", () => {
    // 10·0,3 + 8·0,15 − 2·0,3 + 400·0,003 = 3 + 1,2 − 0,6 + 1,2
    expect(rawPoints(carry, RULESET_SPEC).live).toBe(4.8);
  });
  it("basic = live + победа + строения", () => {
    expect(rawPoints(carry, RULESET_SPEC).basic).toBe(4.8 + 3 + 2);
  });
  it("parsed = basic + оглушения + варды + стаки", () => {
    // 9,8 + 10·0,05 + 1·0,3 + 2·0,5
    expect(rawPoints(carry, RULESET_SPEC).parsed).toBe(11.6);
    expect(rawPoints(carry, RULESET_SPEC).vision_control).toBe(0.8);
  });
  it("неизвестные на уровне поля (null) не дают очков", () => {
    const live: MapStats = { kills: 1, deaths: 0, assists: 0, last_hits: 0, won: null, stun_s: null };
    const p = rawPoints(live, RULESET_SPEC);
    expect(p.parsed).toBe(p.live);
  });
});

describe("2026.10-b", () => {
  it("лечение: +0,5 за 1000 на уровне конца карты", () => {
    const sup: MapStats = { kills: 0, deaths: 0, assists: 0, last_hits: 0, won: false, healing: 4000 };
    expect(rawPoints(sup, RULESET_B).basic).toBe(2);
    expect(rawPoints(sup, RULESET_B).live).toBe(0);
  });
  it("множитель роли, округление до 0.1", () => {
    expect(mapPoints(carry, 1, RULESET_B)).toBe(Math.round(rawPoints(carry, RULESET_B).parsed * 0.92 * 10) / 10);
  });
});

describe("примеры из 02 §5 (старые множители 1.14 / 0.96)", () => {
  const old = { ...RULESET_SPEC, role_multipliers: { 1: 1.14, 2: 1.08, 3: 1.07, 4: 1.02, 5: 0.96 } as const };
  it("5-я позиция, поражение: 10.78 сырых × 0.96 = 10.3", () => {
    const s: MapStats = { kills: 2, deaths: 6, assists: 18, last_hits: 60, won: false, building_damage: 0,
      stun_s: 40, obs_placed: 12, obs_killed: 5, camps_stacked: 4 };
    expect(rawPoints(s, old).parsed).toBe(10.78);
    expect(mapPoints(s, 5, old)).toBe(10.3);
  });
  it("керри, победа: 10.1 сырых × 1.14 = 11.5", () => {
    const s: MapStats = { kills: 8, deaths: 2, assists: 10, last_hits: 600, won: true, building_damage: 6000,
      stun_s: 10, obs_placed: 0, obs_killed: 0, camps_stacked: 0 };
    expect(rawPoints(s, old).parsed).toBe(10.1);
    expect(mapPoints(s, 1, old)).toBe(11.5);
  });
});
