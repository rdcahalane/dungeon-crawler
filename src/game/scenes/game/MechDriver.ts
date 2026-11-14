/**
 * The Phaser-free adapter between the tomb engine and the game: events go in, the engine's effects are resolved
 * on the host (`applyMechEffects`). The scene controller and the replay tests both drive it.
 */
import { applyEvent } from "../../world/mechanisms";
import type { MechEffect, MechEvent, MechState, Rng } from "../../world/types";
import { applyMechEffects, type ApplyResult, type EffectHost } from "./MechEffects";

export interface DriverHost extends EffectHost {
  /** A secret door was found (legacy `door_secret_found` event). */
  secretFound(): void;
}

export class MechDriver {
  private knownSecret = new Set<string>();
  private secretIds: string[];
  /** Set once a floor change starts: further events are ignored. */
  done = false;

  constructor(readonly state: MechState, private host: DriverHost, private rng: Rng) {
    this.secretIds = state.specs.filter((s) => s.kind === "secret_door").map((s) => s.id);
    for (const id of this.secretIds) if (state.rt[id]?.revealed) this.knownSecret.add(id);
  }

  /** Apply one event. Returns the engine's effects (already resolved on the host). */
  send(ev: MechEvent, opts: { quiet?: boolean } = {}): MechEffect[] {
    if (this.done) return [];
    const effects = applyEvent(this.state, ev, this.rng);
    // `quiet` keeps the engine's messages off the status line (the caller shows them in a dialog instead).
    const shown = opts.quiet ? effects.filter((e) => e.type !== "message") : effects;
    if (shown.length > 0) {
      const r: ApplyResult = applyMechEffects(shown, this.host);
      if (r.leftFloor) this.done = true;
    }
    this.checkSecrets();
    return effects;
  }

  private checkSecrets(): void {
    for (const id of this.secretIds) {
      if (this.knownSecret.has(id)) continue;
      if (this.state.rt[id]?.revealed) {
        this.knownSecret.add(id);
        this.host.secretFound();
      }
    }
  }
}
