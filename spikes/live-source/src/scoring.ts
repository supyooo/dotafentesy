// Скоринг. Разложен по уровням данных из docs/08-stack.md:
//   live   — во время карты (Steam GetLiveLeagueGames): убийства, смерти, помощь, добивания
//   basic  — конец карты (детали матча): + победа, урон по строениям, лечение союзников
//   parsed — после разбора реплея: + оглушения, поставленные и снятые Observer Ward, стаки
// Версии правил (как scoring_rulesets в docs/09): правила турнира — ссылка на версию; старые версии не меняются.
export interface Ruleset {
  version: string; note: string;
  kill: number; assist: number; death: number; last_hit: number;
  building_damage_per_1000: number; healing_per_1000: number;
  stun_s: number; obs_placed: number; obs_killed: number; camp_stacked: number; win: number;
}

export const RULESETS = {
  /** Таблица docs/02 §5 как есть. На Slam VIII: обзор+контроль = 59% очков саппортов (лимит спеки — треть). */
  spec: { version: "2026.10-spec", note: "docs/02 §5 без изменений",
    kill: 0.3, assist: 0.15, death: -0.3, last_hit: 0.003, building_damage_per_1000: 0.25, healing_per_1000: 0,
    stun_s: 0.05, obs_placed: 0.3, obs_killed: 0.3, camp_stacked: 0.5, win: 3 },
  /** Калибровка на 60 картах Slam VIII (06.10.2026): обзор+контроль саппортов ≤ трети, множители ролей 0.92–1.17,
   *  добавлено лечение союзников (открытый вопрос 02 §5 — единственный вклад саппорта без очков). Черновик — утверждает Georgy. */
  b: { version: "2026.10-b", note: "калибровка Slam VIII: варды/оглушения ниже, помощь выше, смерть мягче, + лечение",
    kill: 0.3, assist: 0.2, death: -0.25, last_hit: 0.003, building_damage_per_1000: 0.25, healing_per_1000: 0.5,
    stun_s: 0.025, obs_placed: 0.1, obs_killed: 0.15, camp_stacked: 0.5, win: 3 },
} satisfies Record<string, Ruleset>;
export type RulesetId = keyof typeof RULESETS;
export const RULESET: Ruleset = RULESETS[(process.env.RULESET as RulesetId) ?? "b"] ?? RULESETS.b;

export interface Stats {
  kills: number; deaths: number; assists: number; last_hits: number;
  won?: boolean | null; building_damage?: number | null; healing?: number | null;
  stun_s?: number | null; obs_placed?: number | null; obs_killed?: number | null; camps_stacked?: number | null;
}
export interface Points { live: number; basic: number; parsed: number; vision_control: number }

const r2 = (x: number) => Math.round(x * 100) / 100;

/** Сырые очки (до множителя роли) нарастающим итогом по уровням: live ⊂ basic ⊂ parsed. */
export function rawPoints(s: Stats, R: Ruleset = RULESET): Points {
  const live = s.kills * R.kill + s.assists * R.assist + s.deaths * R.death + s.last_hits * R.last_hit;
  const basic = live + (s.won ? R.win : 0) + ((s.building_damage ?? 0) / 1000) * R.building_damage_per_1000
    + ((s.healing ?? 0) / 1000) * R.healing_per_1000;
  const vision_control = (s.stun_s ?? 0) * R.stun_s + (s.obs_placed ?? 0) * R.obs_placed + (s.obs_killed ?? 0) * R.obs_killed;
  const parsed = basic + vision_control + (s.camps_stacked ?? 0) * R.camp_stacked;
  return { live: r2(live), basic: r2(basic), parsed: r2(parsed), vision_control: r2(vision_control) };
}
