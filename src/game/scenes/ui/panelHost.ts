/** What a HUD panel needs from the running scene. Built by `HUDScene`. */
import type { Player } from "../../entities/Player";
import type { GameContext } from "../../GameContext";
import type { HUDData } from "../HUDScene";
import { runAction, type OpsHost } from "./inventoryOps";

export interface PanelHost {
  player: Player;
  /** Present in the dungeon; absent in the tavern. */
  ctx?: GameContext;
  hud(): HUDData | undefined;
  say(msg: string): void;
}

/** Inventory operations for a host: context hooks when present, direct inventory otherwise. */
export function opsHostFor(host: PanelHost): OpsHost {
  const { player, ctx } = host;
  return {
    inventory: player.inventory,
    hooks: {
      useBelt: ctx?.useBelt ? (i) => ctx.useBelt?.(i) : undefined,
      dropItem: ctx?.dropItem ? (id) => ctx.dropItem?.(id) : undefined,
      equipItem: ctx?.equipItem ? (id) => ctx.equipItem?.(id) : undefined,
      unequipSlot: ctx?.unequipSlot ? (s) => ctx.unequipSlot?.(s) : undefined,
    },
    recompute: () => player.recomputeDerived(),
    refreshHud: () => ctx?.emitHUD(),
    say: (m) => host.say(m),
    heal: (n) => player.heal(n),
  };
}

/** Use belt slot `index` (keys 5 to 8, or a click on the belt): context hook when present, else directly. */
export function activateBeltSlot(host: PanelHost, index: number): void {
  if (host.ctx?.modalOpen) return;
  runAction(opsHostFor(host), { type: "useBelt", index });
}
