// Позиция игрока по данным карты (docs/12 §5) — для турниров без нашей заявки (TI, Wallachia…).
// Ядра — трое с наибольшим net worth, саппорты — двое с наименьшим. Мидер — ядро с центральной линии;
// керри и оффлейнер — по лёгкой/сложной линии, саппорты 5/4 — так же. Где линии не разделяют (обмен линиями, лес,
// две одинаковые линии) — по net worth: керри богаче оффлейнера, четвёрка богаче пятёрки.
import type { Position } from "./scoring/points.js";

export interface MapSlot<K> {
  key: K;
  /** OpenDota lane_role после разбора: 1 лёгкая, 2 центр, 3 сложная, 4 лес; null — неизвестно */
  laneRole: number | null;
  netWorth: number;
}

const LANE = { safe: 1, mid: 2, off: 3 } as const;

/** Позиции пятёрки одной команды на одной карте. Для неполной команды (≠ 5) — пустой результат. */
export function inferPositions<K>(team: MapSlot<K>[]): Map<K, Position> {
  const out = new Map<K, Position>();
  if (team.length !== 5) return out;
  const byNw = [...team].sort((a, b) => b.netWorth - a.netWorth);
  const cores = byNw.slice(0, 3), supports = byNw.slice(3);

  const mids = cores.filter((p) => p.laneRole === LANE.mid);
  // один мидер среди ядер — он; иначе центр не помог: мидер — ядро не с лёгкой и не со сложной линии, а если такого нет — самое богатое
  const mid = mids.length === 1 ? mids[0]! : cores.find((p) => p.laneRole !== LANE.safe && p.laneRole !== LANE.off) ?? cores[0]!;
  const [a, b] = cores.filter((p) => p !== mid) as [MapSlot<K>, MapSlot<K>];
  const [carry, off] = split(a, b);
  const [hard, soft] = split(supports[0]!, supports[1]!, true);

  out.set(mid.key, 2); out.set(carry.key, 1); out.set(off.key, 3); out.set(soft.key, 4); out.set(hard.key, 5);
  return out;
}

/** Пара с лёгкой и сложной линии → [лёгкая, сложная]; если линии не различают — по net worth.
 *  Ядра: керри богаче оффлейнера. Саппорты (poorFirst): пятёрка беднее четвёрки. */
function split<K>(x: MapSlot<K>, y: MapSlot<K>, poorFirst = false): [MapSlot<K>, MapSlot<K>] {
  if (x.laneRole === LANE.safe && y.laneRole === LANE.off) return [x, y];
  if (y.laneRole === LANE.safe && x.laneRole === LANE.off) return [y, x];
  const [rich, poor] = x.netWorth >= y.netWorth ? [x, y] : [y, x];
  return poorFirst ? [poor, rich] : [rich, poor];
}

/** Позиция игрока на турнире — самая частая по картам; share — доля карт с этой позицией (уверенность). */
export function modePosition(perMap: Position[]): { position: Position; share: number } | null {
  if (!perMap.length) return null;
  const n = new Map<Position, number>();
  for (const p of perMap) n.set(p, (n.get(p) ?? 0) + 1);
  const [position, count] = [...n.entries()].sort((x, y) => y[1] - x[1] || x[0] - y[0])[0]!;
  return { position, share: count / perMap.length };
}
