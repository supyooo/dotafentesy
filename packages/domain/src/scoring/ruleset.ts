// Версии правил скоринга = строки scoring_rulesets (docs/09). Опубликованная версия не меняется — только новая.
// Числа здесь — сиды; в рантайме правила турнира берутся из БД (CLAUDE.md: все числа правил — в конфиге).
export interface ScoringRuleset {
  version: string;
  note: string;
  weights: {
    kill: number; assist: number; death: number; last_hit: number;
    building_damage_per_1000: number; healing_per_1000: number;
    stun_s: number; obs_placed: number; obs_killed: number; camp_stacked: number; win: number;
  };
  /** Множитель роли: средний игрок позиции ≈ 10 очков за карту (02 §5). */
  role_multipliers: Record<1 | 2 | 3 | 4 | 5, number>;
}

export const RULESET_SPEC: ScoringRuleset = {
  version: "2026.10-spec",
  note: "docs/02 §5 без изменений",
  weights: { kill: 0.3, assist: 0.15, death: -0.3, last_hit: 0.003, building_damage_per_1000: 0.25, healing_per_1000: 0,
    stun_s: 0.05, obs_placed: 0.3, obs_killed: 0.3, camp_stacked: 0.5, win: 3 },
  role_multipliers: { 1: 0.94, 2: 1.10, 3: 1.19, 4: 0.91, 5: 1.08 },
};

/** Черновик калибровки на Slam VIII (docs/07, 06.10.2026) — до решения автора. */
export const RULESET_B: ScoringRuleset = {
  version: "2026.10-b",
  note: "калибровка Slam VIII: варды/оглушения ниже, помощь выше, смерть мягче, + лечение",
  weights: { kill: 0.3, assist: 0.2, death: -0.25, last_hit: 0.003, building_damage_per_1000: 0.25, healing_per_1000: 0.5,
    stun_s: 0.025, obs_placed: 0.1, obs_killed: 0.15, camp_stacked: 0.5, win: 3 },
  role_multipliers: { 1: 0.92, 2: 1.17, 3: 1.10, 4: 1.15, 5: 1.13 },
};
