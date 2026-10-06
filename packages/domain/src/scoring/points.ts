import type { ScoringRuleset } from "./ruleset.js";

export type Position = 1 | 2 | 3 | 4 | 5;
/** Уровни данных docs/08: live (во время карты) ⊂ basic (конец карты) ⊂ parsed (после разбора реплея). */
export type DataTier = "live" | "basic" | "parsed";

/** Статистика игрока за карту. null — на этом уровне данных поле ещё неизвестно. */
export interface MapStats {
  kills: number; deaths: number; assists: number; last_hits: number;
  won?: boolean | null; building_damage?: number | null; healing?: number | null;
  stun_s?: number | null; obs_placed?: number | null; obs_killed?: number | null; camps_stacked?: number | null;
}

export interface MapPoints {
  /** Сырые очки нарастающим итогом по уровням. */
  live: number; basic: number; parsed: number;
  /** Обзор и контроль (оглушения + варды) — для проверки «не больше трети у саппорта». */
  vision_control: number;
}

const round2 = (x: number) => Math.round(x * 100) / 100;

export function rawPoints(s: MapStats, r: ScoringRuleset): MapPoints {
  const w = r.weights;
  const live = s.kills * w.kill + s.assists * w.assist + s.deaths * w.death + s.last_hits * w.last_hit;
  const basic = live + (s.won ? w.win : 0)
    + ((s.building_damage ?? 0) / 1000) * w.building_damage_per_1000
    + ((s.healing ?? 0) / 1000) * w.healing_per_1000;
  const vision_control = (s.stun_s ?? 0) * w.stun_s + (s.obs_placed ?? 0) * w.obs_placed + (s.obs_killed ?? 0) * w.obs_killed;
  const parsed = basic + vision_control + (s.camps_stacked ?? 0) * w.camp_stacked;
  return { live: round2(live), basic: round2(basic), parsed: round2(parsed), vision_control: round2(vision_control) };
}

/** Очки за карту после множителя роли, округление до 0.1 (02 §5 «Порядок расчёта»). Капитан — на уровне состава. */
export function mapPoints(s: MapStats, pos: Position, r: ScoringRuleset, tier: DataTier = "parsed"): number {
  return Math.round(rawPoints(s, r)[tier] * r.role_multipliers[pos] * 10) / 10;
}

/** Очки по строкам таблицы 02 §5 — для «итога карты» (player_map_points.breakdown). Ключи = ключи weights. */
export function pointsBreakdown(s: MapStats, r: ScoringRuleset): Partial<Record<keyof ScoringRuleset["weights"], number>> {
  const w = r.weights;
  const lines = {
    kill: s.kills * w.kill, assist: s.assists * w.assist, death: s.deaths * w.death, last_hit: s.last_hits * w.last_hit,
    win: s.won ? w.win : 0,
    building_damage_per_1000: ((s.building_damage ?? 0) / 1000) * w.building_damage_per_1000,
    healing_per_1000: ((s.healing ?? 0) / 1000) * w.healing_per_1000,
    stun_s: (s.stun_s ?? 0) * w.stun_s, obs_placed: (s.obs_placed ?? 0) * w.obs_placed,
    obs_killed: (s.obs_killed ?? 0) * w.obs_killed, camp_stacked: (s.camps_stacked ?? 0) * w.camp_stacked,
  };
  return Object.fromEntries(Object.entries(lines).filter(([, v]) => v !== 0).map(([k, v]) => [k, round2(v)]));
}
