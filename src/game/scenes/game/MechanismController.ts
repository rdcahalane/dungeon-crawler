import type { GameContext } from "../../GameContext";

/**
 * PLACEHOLDER for the mechanism lane (B2). All no-ops today. Keep these four public signatures; fill the
 * bodies. GameScene calls them like this:
 *
 * - `create()` once per floor, right after the tilemap is built and before the player spawns. Read
 *   `ctx.dungeon.mechanisms` / `inscriptions` and any saved state in `ctx.persist.mechStateJson`.
 * - `update(delta, playerTx, playerTy)` every frame, after the fog update and before trap checks.
 * - `isBlocked(tx, ty)` is consulted by `ctx.isWalkable`.
 * - `serialize()` is stored into `SerializedFloor.mechStateJson` whenever the floor is saved
 *   (return `undefined` when there is nothing to keep).
 */
export class MechanismController {
  constructor(protected ctx: GameContext) {}

  create(): void {
    // no-op
  }

  update(delta: number, playerTx: number, playerTy: number): void {
    void delta; void playerTx; void playerTy; // no-op
  }

  isBlocked(tx: number, ty: number): boolean {
    void tx; void ty;
    return false;
  }

  serialize(): string | undefined {
    return undefined;
  }

  destroy(): void {
    // no-op
  }
}
