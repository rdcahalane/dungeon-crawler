import type { GameContext } from "../../GameContext";

/**
 * PLACEHOLDER for the input lane (B3: click-to-move, hold-to-attack, hotbar). No-ops today. Keep these
 * public signatures. GameScene calls `create()` once per floor after the camera is set up, and
 * `update(delta)` every frame BEFORE `player.update`, so an input controller can set movement intent that
 * the player reads in the same frame.
 */
export class InputController {
  constructor(protected ctx: GameContext) {}

  create(): void {
    // no-op
  }

  update(delta: number): void {
    void delta; // no-op
  }

  destroy(): void {
    // no-op
  }
}
