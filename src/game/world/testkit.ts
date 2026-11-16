// Shared helpers for the world tests (not imported by game code).
import { applyEvent, createMechState, isDisarmed } from './mechanisms';
import type { MechEffect, MechEvent, MechState, MechanismSpec, Rng, VaultGoal } from './types';

/** Small deterministic generator (mulberry32). */
export function seeded(seed: number): Rng {
  let a = seed >>> 0;
  return {
    next() {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

export function replay(specs: MechanismSpec[], events: MechEvent[], seed = 7): { state: MechState; effects: MechEffect[] } {
  const state = createMechState(specs);
  const rng = seeded(seed);
  const effects: MechEffect[] = [];
  for (const ev of events) effects.push(...applyEvent(state, ev, rng));
  return { state, effects };
}

export function isHarmful(e: MechEffect): boolean {
  return e.type === 'damage' || e.type === 'save_or_die' || e.type === 'fall' || e.type === 'status' || e.type === 'spawn';
}

export function goalMet(state: MechState, goal: VaultGoal): boolean {
  const r = state.rt[goal.id];
  if (!r) return false;
  if (goal.kind === 'open') return r.on;
  if (goal.kind === 'disarmed') return isDisarmed(state, goal.id);
  return r.revealed;
}
