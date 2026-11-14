/**
 * Maps gameplay events to sound effects and music beds. Phaser-free so the
 * tables can be tested against SFX_KEYS.
 */
import { SFX_KEYS, type MusicBed, type SfxKey } from "./sfxData";

/** Events that always play one effect. */
export const EVENT_SFX: Readonly<Record<string, SfxKey>> = {
  player_swing: "swing",
  player_miss: "miss",
  player_hurt: "hurt",
  enemy_death: "monster_die",
  item_pickup: "pickup",
  gold: "gold",
  chest_open: "door",
  door_secret_found: "secret",
  spell_cast: "spell_cast",
  spell_fizzle: "spell_fizzle",
  heal: "heal",
  level_up: "level_up",
  ui_open: "ui_select",
  ui_close: "ui_back",
  torch_out: "torch_out",
};

/** Trap type to effect; anything unlisted falls back to TRAP_FALLBACK. */
export const TRAP_SFX: Readonly<Record<string, SfxKey>> = {
  dart: "trap_dart",
  pit: "trap_pit",
  gas: "trap_gas",
  crush: "crush",
};
export const TRAP_FALLBACK: SfxKey = "trap_dart";

/** Common mechanism sound names the other lanes may emit, mapped to a real key. */
export const MECH_SFX_ALIASES: Readonly<Record<string, SfxKey>> = {
  lever: "lever",
  plate: "plate",
  door: "door",
  secret: "secret",
  crush: "crush",
  riddle_right: "riddle_right",
  riddle_wrong: "riddle_wrong",
  portcullis: "door",
  pit: "trap_pit",
  gas: "trap_gas",
  dart: "trap_dart",
  click: "plate",
  roar: "boss_roar",
};

export const PLAYER_DEATH_FOLLOWUP_MS = 700;

function isSfxKey(k: string): k is SfxKey {
  return (SFX_KEYS as readonly string[]).includes(k);
}

/** Resolve a `mech_sfx` key: exact effect name first, then the alias table. */
export function mechSfx(key: string): SfxKey | null {
  if (isSfxKey(key)) return key;
  return MECH_SFX_ALIASES[key] ?? null;
}

/** Resolve a trap type string. */
export function trapSfx(type: string): SfxKey {
  return TRAP_SFX[type.toLowerCase()] ?? TRAP_FALLBACK;
}

/** Hit or crit. */
export function hitSfx(crit: boolean): SfxKey {
  return crit ? "crit" : "hit";
}

/** Music bed for a dungeon floor: the tomb from floor 13 down. */
export function bedForFloor(floor: number): MusicBed {
  return floor >= 13 ? "tomb" : "dungeon";
}

/** Every effect key this module can ever return (for tests). */
export function allMappedSfxKeys(): string[] {
  return [
    ...Object.values(EVENT_SFX),
    ...Object.values(TRAP_SFX),
    ...Object.values(MECH_SFX_ALIASES),
    TRAP_FALLBACK,
    "hit",
    "crit",
    "death",
    "game_over",
    "victory",
  ];
}
