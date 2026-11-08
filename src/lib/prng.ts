// Seeded PRNG (mulberry32). No global state: the caller owns the 32-bit state.

export type RngState = number;

export interface RandomInt {
  value: number;
  state: RngState;
}

export function normalizeSeed(seed: number): number {
  return Math.trunc(seed) >>> 0;
}

/** Derives an independent stream state from a seed and a salt. */
export function deriveState(seed: number, salt: number): RngState {
  let h = normalizeSeed(seed) ^ Math.imul(salt + 1, 0x9e3779b1);
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/** Returns a uniform integer in [0, bound) and the advanced state. */
export function randomInt(state: RngState, bound: number): RandomInt {
  const nextState = (state + 0x6d2b79f5) | 0;
  let t = Math.imul(nextState ^ (nextState >>> 15), 1 | nextState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  const uint = (t ^ (t >>> 14)) >>> 0;
  return { value: Math.floor((uint / 4294967296) * bound), state: nextState >>> 0 };
}

/** Mutable convenience wrapper, for players that keep a private stream. */
export class Prng {
  private state: RngState;

  constructor(seed: number, salt = 0) {
    this.state = deriveState(seed, salt);
  }

  int(bound: number): number {
    const result = randomInt(this.state, bound);
    this.state = result.state;
    return result.value;
  }

  shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = this.int(i + 1);
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }
}
