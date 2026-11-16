/**
 * Texture key manifest for the retro texture set. Phaser-free.
 *
 * LEGACY_TEXTURE_KEYS is the exact list of keys (with pixel sizes) that
 * `scenes/PreloadScene.ts` generates today, so `registerRetroTextures` is a
 * drop-in replacement. A test cross-checks this list against PreloadScene.ts.
 */

export interface TextureSize {
  readonly w: number;
  readonly h: number;
}

const T: TextureSize = { w: 32, h: 32 };
const SPELL: TextureSize = { w: 16, h: 16 };

/** Every key PreloadScene creates, with the size it creates it at. */
export const LEGACY_TEXTURE_SIZES: Readonly<Record<string, TextureSize>> = {
  // dungeon tiles
  floor: T,
  wall: T,
  secret_door: T,
  secret_door_open: T,
  trap_detected: T,
  stairs: T,
  stairs_up: T,
  floor_0: T,
  wall_0: T,
  floor_1: T,
  wall_1: T,
  floor_2: T,
  wall_2: T,
  floor_3: T,
  wall_3: T,
  // tavern
  tavern_floor: T,
  tavern_wall: T,
  npc: T,
  notice_board: T,
  dungeon_portal: T,
  tavern_bar: T,
  tavern_table: T,
  tavern_patron: T,
  tavern_barrel: T,
  // player
  player_fighter: T,
  player_thief: T,
  player_wizard: T,
  player_cleric: T,
  player: T,
  // enemies
  enemy: T,
  enemy_skeleton: T,
  enemy_zombie: T,
  enemy_giant_rat: T,
  enemy_giant_spider: T,
  enemy_troll: T,
  enemy_dark_elf: T,
  enemy_ghost: T,
  enemy_mimic: T,
  enemy_basic: T,
  enemy_fast: T,
  enemy_tank: T,
  // decals
  decal_pillar: T,
  decal_bones: T,
  decal_runes: T,
  decal_hoard: T,
  decal_shrine: T,
  // items
  item_health_potion: T,
  item_weapon: T,
  item_armor: T,
  item_xp_orb: T,
  item_gold: T,
  item_scroll: T,
  item_stat_tome: T,
  // chests
  chest_wooden: T,
  chest_iron: T,
  chest_golden: T,
  chest_open: T,
  // light and fog (soft in the old code, stepped and dithered here)
  fog_brush: { w: 320, h: 320 }, // FOG_RADIUS(5) * TILE_SIZE(32) * 2
  fog_tile: T,
  torch_glow: { w: 256, h: 256 },
  spell_missile: SPELL,
  spell_fireball: SPELL,
  spell_frost: SPELL,
  spell_blink: SPELL,
  spell_heal: SPELL,
};

export const LEGACY_TEXTURE_KEYS: readonly string[] = Object.keys(LEGACY_TEXTURE_SIZES);

/** New mechanism textures (32x32). Tile-like ones are opaque, decals are transparent. */
export const MECH_KEYS: readonly string[] = [
  "mech_plate",
  "mech_plate_down",
  "mech_lever_off",
  "mech_lever_on",
  "mech_pit_open",
  "mech_pit_spikes",
  "mech_portcullis",
  "mech_dart_hole",
  "mech_gas_vent",
  "mech_rune_a",
  "mech_rune_b",
  "mech_rune_c",
  "mech_rune_d",
  "mech_rune_e",
  "mech_rune_f",
  "mech_statue",
  "mech_face",
  "mech_inscription",
  "mech_false_door",
  "mech_door",
  "mech_door_open",
  "mech_teleporter",
  "mech_lure",
  "mech_scorch",
  "mech_stain",
  "mech_bones",
];

/** New item icons (32x32). item_armor and item_scroll already exist as legacy keys. */
export const ITEM_KEYS: readonly string[] = [
  "item_sword",
  "item_axe",
  "item_mace",
  "item_dagger",
  "item_staff",
  "item_bow",
  "item_shield",
  "item_armor",
  "item_helm",
  "item_cloak",
  "item_boots",
  "item_ring",
  "item_amulet",
  "item_potion_red",
  "item_potion_blue",
  "item_scroll",
  "item_torch",
  "item_pole",
  "item_rope",
  "item_spikes",
  "item_holy_water",
  "item_tools",
  "item_ration",
  "item_gem",
  "item_key",
];

/** New monsters, matching the fallback list in docs/OVERHAUL.md. */
export const NEW_ENEMY_KEYS: readonly string[] = [
  "enemy_ghoul",
  "enemy_wight",
  "enemy_wraith",
  "enemy_gargoyle",
  "enemy_ooze",
  "enemy_cultist",
  "enemy_bone_knight",
  "enemy_giant_bat",
  "enemy_hollow_king",
];

/**
 * Large monsters. Their sprites are not 16x16: 24x24 (ogre, cave bear, giant scorpion) and 32x32 (barrow giant,
 * ossuary hulk, cave wyrm), drawn 2x, so the textures are 48 and 64 pixels.
 */
export const LARGE_ENEMY_KEYS: readonly string[] = [
  "enemy_ogre",
  "enemy_cave_bear",
  "enemy_giant_scorpion",
  "enemy_barrow_giant",
  "enemy_ossuary_hulk",
  "enemy_cave_wyrm",
];

/** Hirelings hired at the inn (32x32, 16x16 grid drawn 2x). */
export const HIRELING_KEYS: readonly string[] = ["hireling_torchbearer", "hireling_man_at_arms"];

/** Creatures get a second walk frame under `<key>_f2`. */
export const CREATURE_KEYS: readonly string[] = [
  "player",
  "player_fighter",
  "player_thief",
  "player_wizard",
  "player_cleric",
  "npc",
  "tavern_patron",
  ...HIRELING_KEYS,
  "enemy",
  "enemy_skeleton",
  "enemy_zombie",
  "enemy_giant_rat",
  "enemy_giant_spider",
  "enemy_troll",
  "enemy_dark_elf",
  "enemy_ghost",
  "enemy_mimic",
  "enemy_basic",
  "enemy_fast",
  "enemy_tank",
  ...NEW_ENEMY_KEYS,
  ...LARGE_ENEMY_KEYS,
];

export const WALK_FRAME_KEYS: readonly string[] = CREATURE_KEYS.map((k) => `${k}_f2`);

/** Every texture registerRetroTextures creates (deduplicated). */
export const RETRO_TEXTURE_KEYS: readonly string[] = Array.from(
  new Set([
    ...LEGACY_TEXTURE_KEYS,
    ...MECH_KEYS,
    ...ITEM_KEYS,
    ...NEW_ENEMY_KEYS,
    ...LARGE_ENEMY_KEYS,
    ...HIRELING_KEYS,
    ...WALK_FRAME_KEYS,
  ]),
);

/** Number of FLOOR_THEMES entries the game ships (floor_N / wall_N keys). */
export const THEME_COUNT = 4;
