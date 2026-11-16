/**
 * Resolving the effects the tomb engine returns. Phaser-free: everything that needs the scene goes through
 * `EffectHost`, everything about dice, saves and the pack happens here so it can be unit tested.
 */
import { ENEMY_TYPES, type EnemyTypeKey } from "../../constants";
import { roll, savingThrow, type Rng } from "../../rules";
import {
  displayName, equipmentBonuses, hasDef, makeItem, type Inventory, type ItemInstance,
} from "../../items";
import type { ClassKey, SaveCategory } from "../../items";
import type { MechEffect } from "../../world/types";
import { itemDefKey } from "./itemKeys";

export type MechTone = "clue" | "danger" | "info";

export const TONE_COLOR: Record<MechTone, number> = {
  clue: 0xffd166,
  danger: 0xff5a5f,
  info: 0xb0bec5,
};

/** What the effect code needs from the player. `Player` satisfies it structurally. */
export interface EffectPlayer {
  stats: { classKey: ClassKey; level: number; hp: number };
  inventory: Inventory;
  takeDamage(amount: number, bypassArmor?: boolean): void;
  addEffect(key: "POISONED" | "SLOWED", durationMs: number, value?: number): void;
  /** Another lane is adding this; used when present (boolean or `{ success }`). */
  rollSave?: (category: SaveCategory, modifier?: number) => unknown;
}

/** The scene-bound half of effect handling. */
export interface EffectHost {
  player: EffectPlayer;
  rng: Rng;
  say(text: string, tone: MechTone): void;
  /** Float short text above the player. */
  float(text: string, color: number): void;
  /** The player dies of `cause` (hp to zero, death flow, cause on screen). */
  killPlayer(cause: string, flavor: string): void;
  /** Harmful effect fired (legacy `trap_triggered` event). */
  trap(type: string): void;
  setTile(tx: number, ty: number, tile: number): void;
  reveal(id: string): void;
  spawn(monster: string, tx: number, ty: number): void;
  teleport(tx: number, ty: number): void;
  /** Go down `floors` floors (the damage was already dealt). */
  fall(floors: number): void;
  /** Put an item on the floor at a tile (the pack was full). */
  dropItem(item: ItemInstance, tx: number, ty: number): void;
  sfx(key: string): void;
  shake(ms: number): void;
}

export interface ApplyResult {
  died: boolean;
  /** A floor change was started; stop driving the engine. */
  leftFloor: boolean;
}

const DEATH_FLAVOR: Record<SaveCategory, string> = {
  death: "The life goes out of you.",
  petrify: "You are stone.",
  wands: "The magic takes you.",
  breath: "You cannot draw breath.",
  spells: "The spell takes you.",
};

/** A saving throw for the player: `player.rollSave` when another lane provides it, else the rules table. */
export function rollPlayerSave(
  player: EffectPlayer, category: SaveCategory, modifier: number, rng: Rng,
): boolean {
  const own = player.rollSave;
  if (typeof own === "function") {
    try {
      const r = own.call(player, category, modifier);
      if (typeof r === "boolean") return r;
      if (r && typeof r === "object" && "success" in r) return !!(r as { success: unknown }).success;
    } catch {
      // fall through to the rules table
    }
  }
  const gear = equipmentBonuses(player.inventory).saveBonus[category] ?? 0;
  return savingThrow(
    { classKey: player.stats.classKey, level: player.stats.level, category, modifier: modifier + gear },
    rng,
  ).success;
}

/** Monster name from a vault ("skeleton") to a legacy enemy key. Unknown names become skeletons. */
export function enemyKeyFor(monster: string): EnemyTypeKey {
  const up = monster.toUpperCase().replace(/[\s-]+/g, "_");
  return (up in ENEMY_TYPES ? up : "SKELETON") as EnemyTypeKey;
}

function statusFor(key: string): "POISONED" | "SLOWED" | null {
  const k = key.toLowerCase();
  if (k.startsWith("poison")) return "POISONED";
  if (k.startsWith("slow")) return "SLOWED";
  return null;
}

const alive = (p: EffectPlayer): boolean => p.stats.hp > 0;

export function applyMechEffects(effects: MechEffect[], host: EffectHost): ApplyResult {
  const p = host.player;
  const out: ApplyResult = { died: false, leftFloor: false };

  const hurt = (amount: number, cause: string): boolean => {
    if (amount <= 0) return false;
    p.takeDamage(amount, true);
    if (!alive(p)) {
      out.died = true;
      host.say(`Slain by ${cause}.`, "danger");
      return true;
    }
    return false;
  };

  for (const e of effects) {
    if (out.died || out.leftFloor) break;
    switch (e.type) {
      case "message":
        host.say(e.text, e.tone);
        break;

      case "damage": {
        host.trap("mech_damage");
        let amount = roll(host.rng, e.dice[0], e.dice[1], e.bonus ?? 0);
        if (e.save) {
          if (rollPlayerSave(p, e.save, 0, host.rng)) {
            amount = e.saveHalves ? Math.floor(amount / 2) : 0;
            host.say(amount > 0 ? `You half-dodge ${e.cause}.` : `You dodge ${e.cause}.`, "info");
          }
        }
        hurt(amount, e.cause);
        break;
      }

      case "save_or_die": {
        host.trap("mech_save_or_die");
        if (rollPlayerSave(p, e.save, e.modifier ?? 0, host.rng)) {
          host.say("You resist. Your heart is still going, loudly.", "info");
        } else {
          host.killPlayer(e.cause, DEATH_FLAVOR[e.save]);
          out.died = true;
        }
        break;
      }

      case "status": {
        const key = statusFor(e.key);
        if (e.save && rollPlayerSave(p, e.save, 0, host.rng)) {
          host.say("You resist.", "info");
          break;
        }
        if (key === "POISONED") {
          if (equipmentBonuses(p.inventory).resistPoison) { host.say("The poison finds nothing to hold.", "info"); break; }
          host.trap("mech_poison");
          p.addEffect("POISONED", Math.min(e.durationMs, 20000), 1);
          host.say("Poison burns in your blood.", "danger");
        } else if (key === "SLOWED") {
          host.trap("mech_slow");
          p.addEffect("SLOWED", Math.min(e.durationMs, 20000));
          host.say("Your limbs turn heavy.", "danger");
        } else {
          host.trap("mech_curse");
          host.say(`A ${e.key} settles over you.`, "danger");
        }
        break;
      }

      case "set_tile":
        host.setTile(e.tx, e.ty, e.tile);
        break;
      case "reveal":
        host.reveal(e.id);
        break;

      case "spawn":
        host.trap("mech_spawn");
        host.spawn(e.monster, e.tx, e.ty);
        break;

      case "teleport":
        host.teleport(e.tx, e.ty);
        break;

      case "fall": {
        host.trap("mech_fall");
        const amount = roll(host.rng, e.dice[0], e.dice[1]);
        if (hurt(amount, "a fall")) break;
        if (e.floors > 0) {
          out.leftFloor = true;
          host.fall(e.floors);
        }
        break;
      }

      case "grant": {
        const defKey = itemDefKey(e.itemKey);
        if (!hasDef(defKey)) {
          host.say(`Something was here (${e.itemKey}), but it comes apart in your hand.`, "info");
          break;
        }
        const item = makeItem(defKey, host.rng, 1);
        const name = displayName(item, { quantity: false });
        if (p.inventory.add(item).ok) {
          host.float(`+ ${name}`, 0xffd166);
          host.say(`You take the ${name}.`, "info");
        } else {
          host.dropItem(item, e.tx, e.ty);
          host.say(`Your pack is full. The ${name} stays on the floor.`, "info");
        }
        break;
      }

      case "consume": {
        const defKey = itemDefKey(e.itemKey);
        if (hasDef(defKey)) p.inventory.consume(defKey, 1);
        break;
      }

      case "sfx":
        host.sfx(e.key);
        break;
      case "shake":
        host.shake(e.ms);
        break;
    }
  }
  return out;
}
