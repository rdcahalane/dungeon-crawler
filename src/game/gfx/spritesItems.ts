/**
 * Item icons, chests, spell glows, stepped light textures. Phaser-free.
 */
import { glowRows, mirror, quad, recolor, solid, stamp, type Rows } from "./spriteTools";

const E8 = "........";
const E16 = "................";

export const ITEM_MAPS: Record<string, Rows> = {};
/** Maps drawn on a different grid than 16x16, keyed to {w,h,scale}. */
export const GLOW_MAPS: Record<string, { w: number; h: number; scale: number; rows: Rows; alpha: Record<string, number> }> = {};

// ── legacy item textures ───────────────────────────────────────────────────

const POTION: Rows = mirror([
  E8,
  "......dd",
  "......dd",
  ".......5",
  ".......5",
  "....5555",
  "...58888",
  "..586888",
  "..586888",
  "..588888",
  "..588888",
  "..588888",
  "...58888",
  "....5555",
  E8,
  E8,
]);
ITEM_MAPS.item_health_potion = POTION;
ITEM_MAPS.item_potion_red = POTION;
ITEM_MAPS.item_potion_blue = recolor(POTION, { "8": "j" });
ITEM_MAPS.item_holy_water = recolor(POTION, { "8": "l", d: "a" });

ITEM_MAPS.item_xp_orb = quad([
  ".....fff",
  "...ffggg",
  "..fgghhh",
  ".fgghhhh",
  ".fghhhbb",
  "fgghhbbb",
  "fgghhbbb",
  "fgghhbbb",
]);
ITEM_MAPS.item_gold = quad([
  ".....999",
  "...99aaa",
  "..9aaaaa",
  ".9aaaaaa",
  ".9aaaaad",
  "9aaaaaad",
  "9aaaaaad",
  "9aaaaaad",
]);

const SWORD: Rows = [
  "..............65",
  ".............65.",
  "............65..",
  "...........65...",
  "..........65....",
  ".........65.....",
  "........65......",
  "...a...65.......",
  "....a.65........",
  ".....a5.........",
  "....d..a........",
  "...d...a........",
  "..d.............",
  ".a..............",
  E16,
  E16,
];
ITEM_MAPS.item_sword = SWORD;
ITEM_MAPS.item_weapon = SWORD;

ITEM_MAPS.item_armor = mirror([
  E8,
  "..554...",
  ".5554444",
  ".5544444",
  "..544444",
  "..544333",
  "..544444",
  "..544444",
  "..544444",
  "...54444",
  "...54444",
  "....4444",
  "....3333",
  E8,
  E8,
  E8,
]);
ITEM_MAPS.item_scroll = mirror([
  E8,
  E8,
  "..eeeeee",
  "..deeeee",
  "...bbbbb",
  "...bdddd",
  "...bbbbb",
  "...bdddd",
  "...bbbbb",
  "...bbb88",
  "...bbb88",
  "...bbbbb",
  "..deeeee",
  "..eeeeee",
  E8,
  E8,
]);
ITEM_MAPS.item_stat_tome = mirror([
  E8,
  E8,
  "..mmmmmm",
  "..mnnnnn",
  "..mnnnna",
  "..mnnnaa",
  "..mnnnna",
  "..mnnnnn",
  "..mnnnnn",
  "..mnnnnn",
  "..mnnnnn",
  "..mvvvvv",
  "..mmmmmm",
  E8,
  E8,
  E8,
]);

// ── new item icons ─────────────────────────────────────────────────────────

ITEM_MAPS.item_axe = [
  E16,
  E16,
  "....65555dd.....",
  "...665555dd.....",
  "..6655555dd.....",
  "..6655555dd.....",
  "..6655555dd.....",
  "...665555dd.....",
  "....65555dd.....",
  ".........dd.....",
  ".........dd.....",
  ".........dd.....",
  ".........dd.....",
  ".........dd.....",
  ".........aa.....",
  E16,
];
ITEM_MAPS.item_mace = mirror([
  E8,
  ".....5.5",
  "....4444",
  "....4544",
  "....4444",
  "....4444",
  ".....5.5",
  ".......d",
  ".......d",
  ".......d",
  ".......d",
  ".......d",
  ".......d",
  ".......d",
  "......dd",
  E8,
]);
ITEM_MAPS.item_dagger = mirror([
  ".......5",
  "......55",
  "......65",
  "......65",
  "......65",
  "......65",
  "......65",
  "......65",
  "......65",
  "....aaaa",
  ".......d",
  ".......d",
  ".......d",
  "......aa",
  E8,
  E8,
]);
ITEM_MAPS.item_staff = mirror([
  E8,
  "......kk",
  ".....kbb",
  ".....kbb",
  "......kk",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  E8,
]);
ITEM_MAPS.item_bow = [
  E16,
  ".........dd6....",
  ".......dd..6....",
  "......d....6....",
  ".....d.....6....",
  "....d......6....",
  "....d......6....",
  "...e.......6....",
  "...e.......6....",
  "....d......6....",
  "....d......6....",
  ".....d.....6....",
  "......d....6....",
  ".......dd..6....",
  ".........dd6....",
  E16,
];
ITEM_MAPS.item_shield = mirror([
  E8,
  "..555555",
  "..544444",
  "..54444a",
  "..54444a",
  "..5aaaaa",
  "..54444a",
  "..54444a",
  "..54444a",
  "...5444a",
  "...5444a",
  "....5444",
  ".....544",
  "......55",
  ".......5",
  E8,
]);
ITEM_MAPS.item_helm = mirror([
  E8,
  E8,
  E8,
  ".....555",
  "...55444",
  "..554444",
  "..544444",
  "..544444",
  "..541111",
  "..544144",
  "..544144",
  "..544.44",
  E8,
  E8,
  E8,
  E8,
]);
ITEM_MAPS.item_cloak = mirror([
  E8,
  E8,
  ".....888",
  "....888a",
  "...88888",
  "..887888",
  "..887888",
  ".8887888",
  ".8887888",
  ".8877888",
  "88877888",
  "88877888",
  "87877878",
  "77777777",
  E8,
  E8,
]);
{
  const boot: Rows = [
    ".ddd...",
    ".ddd...",
    ".edd...",
    ".ddd...",
    ".ddd...",
    ".dddd..",
    ".ddddd.",
    ".dddddd",
    ".dccccc",
    ".cccccc",
  ];
  ITEM_MAPS.item_boots = stamp(stamp(Array(16).fill(E16), 1, 3, boot), 8, 3, boot);
}
ITEM_MAPS.item_ring = mirror([
  E8,
  E8,
  "......kk",
  "......kb",
  "....aaaa",
  "...aa...",
  "..aa....",
  "..a9....",
  "..a9....",
  "..aa....",
  "...aa...",
  "....aaaa",
  ".....999",
  E8,
  E8,
  E8,
]);
ITEM_MAPS.item_amulet = mirror([
  E8,
  ".a......",
  ".a......",
  "..a.....",
  "..a.....",
  "...a....",
  "...a....",
  "....a...",
  "....a...",
  ".....a..",
  "......aa",
  ".....aaa",
  ".....a88",
  ".....a88",
  "......aa",
  E8,
]);
ITEM_MAPS.item_torch = mirror([
  E8,
  ".......a",
  "......a9",
  ".....a99",
  ".....a99",
  "......a9",
  ".......9",
  ".....ccc",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  "......cd",
  E8,
]);
{
  // ten-foot pole: a long diagonal with an iron tip
  const rows: string[][] = Array.from({ length: 16 }, () => Array(16).fill("."));
  for (let r = 0; r < 16; r++) {
    const x = 15 - r;
    rows[r][x] = r < 3 ? "5" : "d";
    if (x - 1 >= 0) rows[r][x - 1] = r < 3 ? "5" : "e";
  }
  ITEM_MAPS.item_pole = rows.map((r) => r.join(""));
}
{
  // coil of rope: concentric rings of two tones
  const rows: string[] = [];
  for (let y = 0; y < 16; y++) {
    let row = "";
    for (let x = 0; x < 16; x++) {
      const d = Math.hypot(x - 7.5, y - 7.5);
      row += d > 7 ? "." : d > 5.4 ? "e" : d > 4.4 ? "d" : d > 3.0 ? "e" : d > 2.2 ? "d" : ".";
    }
    rows.push(row);
  }
  ITEM_MAPS.item_rope = rows;
}
ITEM_MAPS.item_spikes = mirror([
  E8,
  "..444.44",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...5...5",
  "...4...4",
  E8,
  E8,
  E8,
]);
ITEM_MAPS.item_tools = mirror([
  E8,
  E8,
  E8,
  ".....5.5",
  ".....5.5",
  ".....5.5",
  ".....5.5",
  "...ddddd",
  "..dddddd",
  "..eeeeea",
  "..dddddd",
  "..dddddd",
  "..dddddd",
  "...ddddd",
  E8,
  E8,
]);
ITEM_MAPS.item_ration = mirror([
  E8,
  E8,
  E8,
  E8,
  E8,
  "....dddd",
  "..ddeeee",
  ".ddeebee",
  ".deeeeee",
  ".deeeeee",
  ".ddeebee",
  "..dddddd",
  E8,
  E8,
  E8,
  E8,
]);
ITEM_MAPS.item_gem = mirror([
  E8,
  E8,
  E8,
  "....6lll",
  "...6llkk",
  "..6llkkk",
  "..6lkkjj",
  "...lkjjj",
  "...lkjjj",
  "....kjjj",
  "....kjjj",
  ".....jjj",
  "......jj",
  ".......j",
  E8,
  E8,
]);
ITEM_MAPS.item_key = [
  E16,
  E16,
  E16,
  E16,
  E16,
  "..aaaa..........",
  ".aa..aa.........",
  ".a....aaaaaaaaaa",
  ".aa..aa.....d.d.",
  "..aaaa......d.d.",
  E16,
  E16,
  E16,
  E16,
  E16,
  E16,
];

// ── chests ─────────────────────────────────────────────────────────────────

const CHEST: Rows = mirror([
  E8,
  E8,
  E8,
  "...11111",
  "..1dddd1",
  "..1ddddc",
  "..1ddddc",
  "..1ccccc",
  "..1dddda",
  "..1dddda",
  "..1ddddc",
  "..1ddddc",
  "..1ccccc",
  "..111111",
  E8,
  E8,
]);
ITEM_MAPS.chest_wooden = CHEST;
ITEM_MAPS.chest_iron = recolor(CHEST, { d: "4", c: "3", a: "6" });
ITEM_MAPS.chest_golden = recolor(CHEST, { d: "a", c: "9", a: "6" });
ITEM_MAPS.chest_open = mirror([
  E8,
  "..111111",
  "..1ddddd",
  "..1ddddd",
  "..1ccccc",
  "..111111",
  "..100000",
  "..100000",
  "..1ddddd",
  "..1ddddd",
  "..1ccccc",
  "..1ddddd",
  "..1ccccc",
  "..111111",
  E8,
  E8,
]);

ITEM_MAPS.fog_tile = solid(16, 16, "0");

// ── spell glows, 8x8 grid drawn 2x -> 16x16 ────────────────────────────────

const spell = (a: string, b: string, c: string, d: string): Rows =>
  quad([`..${a}${b}`, `.${a}${b}${c}`, `${a}${b}${c}${c}`, `${b}${c}${c}${d}`].map((r) => r.slice(0, 4)));
ITEM_MAPS.spell_missile = spell("k", "l", "6", "6");
ITEM_MAPS.spell_fireball = spell("8", "9", "a", "b");
ITEM_MAPS.spell_frost = spell("j", "k", "l", "6");
ITEM_MAPS.spell_blink = spell("m", "n", "o", "6");
ITEM_MAPS.spell_heal = spell("9", "a", "b", "6");

// ── light: stepped, dithered ───────────────────────────────────────────────

// Fog brush: used as an alpha mask (erase). 40x40 cells drawn 8x -> 320x320.
GLOW_MAPS.fog_brush = {
  w: 40,
  h: 40,
  scale: 8,
  rows: glowRows(40, ["6", "5", "4", "3"], 1),
  alpha: { "6": 1, "5": 0.72, "4": 0.42, "3": 0.16 },
};
// Torch glow: used additively. 32x32 cells drawn 8x -> 256x256.
GLOW_MAPS.torch_glow = {
  w: 32,
  h: 32,
  scale: 8,
  rows: glowRows(32, ["a", "9", "u", "7"], 1),
  alpha: { a: 0.3, "9": 0.2, u: 0.11, "7": 0.05 },
};
