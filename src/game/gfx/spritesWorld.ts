/**
 * World sprites: dungeon tiles, tavern, decals, mechanisms. 16x16 maps drawn 2x.
 * Palette chars come from palette.ts. Phaser-free.
 */
import { mirror, quad, recolor, stamp, type Rows } from "./spriteTools";

// ── templates (placeholders X Y Z W are recoloured per use) ────────────────

const FLOOR_T: Rows = [
  "XXXXXXXXXXXXXXXX",
  "XZZZZZZZXZZZZZZZ",
  "XYYYYYYYXYYYYYYY",
  "XYYWYYYYXYYYYYYY",
  "XYYYYYYYXYYYYWYY",
  "XYYYYYYYXYYYYYYY",
  "XYYYYYYYXYYYYYYY",
  "XYYYYYYYXYYYYYYY",
  "XXXXXXXXXXXXXXXX",
  "ZZZZXZZZZZZZXZZZ",
  "YYYYXYYYYYYYXYYY",
  "YYWYXYYYYYYYXYYY",
  "YYYYXYYYYYWYXYYY",
  "YYYYXYYYYYYYXYYY",
  "YYYYXYYYYYYYXYYY",
  "YYYYXYYYYYYYXYYY",
];

const WALL_T: Rows = [
  "ZZZZZZZXZZZZZZZX",
  "YYYYYYYXYYYYYYYX",
  "YYYYYYYXYYYYYYYX",
  "WWWWWWWXWWWWWWWX",
  "ZZZXZZZZZZZXZZZZ",
  "YYYXYYYYYYYXYYYY",
  "YYYXYYYYYYYXYYYY",
  "WWWXWWWWWWWXWWWW",
  "ZZZZZZZXZZZZZZZX",
  "YYYYYYYXYYYYYYYX",
  "YYYYYYYXYYYYYYYX",
  "WWWWWWWXWWWWWWWX",
  "ZZZXZZZZZZZXZZZZ",
  "YYYXYYYYYYYXYYYY",
  "YYYXYYYYYYYXYYYY",
  "WWWXWWWWWWWXWWWW",
];

const floor = (x: string, y: string, z: string, w: string) => recolor(FLOOR_T, { X: x, Y: y, Z: z, W: w });
const wall = (x: string, y: string, z: string, w: string) => recolor(WALL_T, { X: x, Y: y, Z: z, W: w });

/** Flat two-colour floor/wall bases used under mechanism markings. */
const BASE_FLOOR = floor("1", "2", "2", "2");
const BASE_WALL: Rows = wall("1", "3", "3", "3");

export const WORLD_MAPS: Record<string, Rows> = {};
const E8 = "........";

// ── dungeon tiles ──────────────────────────────────────────────────────────

WORLD_MAPS.floor = floor("1", "2", "3", "4");
WORLD_MAPS.wall = wall("0", "3", "4", "2");

// themed tiles: 0 Wet Cave, 1 Dry Cave, 2 Dungeon, 3 Deep Dungeon
WORLD_MAPS.floor_0 = floor("1", "i", "3", "p");
WORLD_MAPS.wall_0 = wall("1", "p", "k", "i");
WORLD_MAPS.floor_1 = floor("1", "c", "d", "0");
WORLD_MAPS.wall_1 = wall("1", "d", "e", "c");
WORLD_MAPS.floor_2 = floor("1", "2", "3", "0");
WORLD_MAPS.wall_2 = wall("0", "3", "4", "2");
WORLD_MAPS.floor_3 = floor("0", "1", "2", "m");
WORLD_MAPS.wall_3 = wall("0", "m", "n", "1");

WORLD_MAPS.secret_door = stamp(WORLD_MAPS.wall, 7, 2, ["0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0", "0"]);
WORLD_MAPS.secret_door_open = stamp(WORLD_MAPS.wall, 4, 0, [
  ...Array.from({ length: 13 }, () => "00000000"),
  "22222222",
  "22222222",
  "22222222",
]);

WORLD_MAPS.trap_detected = stamp(floor("1", "2", "2", "2"), 4, 4, [
  "8......8",
  "88....88",
  ".88..88.",
  "..8888..",
  "..8888..",
  ".88..88.",
  "88....88",
  "8......8",
]);

const stairsDown: Rows = [
  "1111111111111111",
  "1444444444444441",
  "1222222222222221",
  "1222222222222221",
  "1444444444444441",
  "1111111111111111",
  "1111111111111111",
  "1444444444444441",
  "1000000000000001",
  "1000000000000001",
  "1444444444444441",
  "1000000000000001",
  "1000000000000001",
  "1000000000000001",
  "1000000000000001",
  "1111111111111111",
];
WORLD_MAPS.stairs = stairsDown;
WORLD_MAPS.stairs_up = [
  "2222222222222222",
  "2666666666666662",
  "2444444444444442",
  "2444444444444442",
  "2666666666666662",
  "2333333333333332",
  "2333333333333332",
  "2666666666666662",
  "2222222222222222",
  "2222222222222222",
  "2666666666666662",
  "2222222222222222",
  "2222222222222222",
  "2222222222222222",
  "2222222222222222",
  "2222222222222222",
];

// ── tavern ─────────────────────────────────────────────────────────────────

WORLD_MAPS.tavern_floor = [
  "eeeeeeeeeeeeeeee",
  "dddddddcdddddddd",
  "dddddddcdddddddd",
  "cccccccccccccccc",
  "eeeeeeeeeeeeeeee",
  "dddcdddddddddddd",
  "dddcdddddddddddd",
  "cccccccccccccccc",
  "eeeeeeeeeeeeeeee",
  "dddddddddddcdddd",
  "dddddddddddcdddd",
  "cccccccccccccccc",
  "eeeeeeeeeeeeeeee",
  "ddddddcddddddddd",
  "ddddddcddddddddd",
  "cccccccccccccccc",
];
WORLD_MAPS.tavern_wall = [
  "1111111111111111",
  "1111111111111111",
  "eeeeeeeeeeeeeeee",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "dddcdddcdddcdddc",
  "cccccccccccccccc",
  "1111111111111111",
];
WORLD_MAPS.notice_board = [
  "................",
  "..cccccccccccc..",
  "..cddddddddddc..",
  "..cd666dd55ddc..",
  "..cd656dd565dc..",
  "..cd666dd555dc..",
  "..cddddddddddc..",
  "..cd55dd666ddc..",
  "..cd565d656ddc..",
  "..cd555d666ddc..",
  "..cddddddddddc..",
  "..cccccccccccc..",
  ".......cc.......",
  ".......cc.......",
  ".......cc.......",
  "......cccc......",
];
WORLD_MAPS.dungeon_portal = quad([
  E8,
  ".....mmm",
  "...mmmnn",
  "..mmnnnn",
  "..mnnnoo",
  ".mnnnooo",
  ".mnnoooo",
  ".mnnooo6",
]);
WORLD_MAPS.tavern_bar = [
  "cccccccccccccccc",
  "eeeeeeeeeeeeeeee",
  "eeeeeeeeeeeeeeee",
  "dddddddddddddddd",
  "dddddd66dddddddd",
  "dddddd66dddddddd",
  "ddddddddddd66ddd",
  "ddddddddddd66ddd",
  "dddddddddddddddd",
  "dddddddddddddddd",
  "dddddddddddddddd",
  "dddddddddddddddd",
  "dddddddddddddddd",
  "cccccccccccccccc",
  "cccccccccccccccc",
  "cccccccccccccccc",
];
WORLD_MAPS.tavern_table = quad([
  ".....ccc",
  "...ccddd",
  "..cddddd",
  ".cdddddd",
  ".cddddee",
  "cdddeeee",
  "cdddeeee",
  "cdddeeee",
]);
WORLD_MAPS.tavern_barrel = mirror([
  E8,
  "....cccc",
  "...ddddd",
  "..444444",
  "..deddcd",
  "..deddcd",
  "..deddcd",
  "..444444",
  "..deddcd",
  "..deddcd",
  "..444444",
  "..deddcd",
  "...ddddd",
  "....cccc",
  E8,
  E8,
]);

// ── decals ─────────────────────────────────────────────────────────────────

WORLD_MAPS.decal_pillar = quad([
  ".....222",
  "...22333",
  "..223344",
  ".2233445",
  ".2334455",
  ".2344555",
  ".2344555",
  ".2344555",
]);
WORLD_MAPS.decal_bones = [
  "................",
  "................",
  "...vvvv.........",
  "..vvvvvv........",
  "..v11v1v...vv...",
  "..vvvvvv..v..v..",
  "...v11v....vv...",
  "....vvv....v....",
  "......v...vv....",
  "..vv...v.v......",
  ".v..v...vv.v....",
  "..vv...vv.v..v..",
  "......v..v...vv.",
  "....vv.v........",
  "................",
  "................",
];
WORLD_MAPS.decal_runes = quad([
  ".....nnn",
  "...nn...",
  "..n....o",
  ".n.....o",
  ".n.....o",
  "n......o",
  "n....ooo",
  "n..ooooo",
]);
WORLD_MAPS.decal_hoard = mirror([
  E8,
  E8,
  E8,
  E8,
  E8,
  ".......b",
  ".....aab",
  "....aaaa",
  "..aabaaa",
  ".aaaa9aa",
  ".aabaaa9",
  "aaaaa999",
  "a9999999",
  E8,
  E8,
  E8,
]);
WORLD_MAPS.decal_shrine = mirror([
  E8,
  E8,
  ".......a",
  "......aa",
  "......a9",
  ".......9",
  "....3333",
  "...44444",
  "....3333",
  "....4444",
  "...33333",
  "..444444",
  "..333333",
  "..444444",
  E8,
  E8,
]);

// ── mechanisms ─────────────────────────────────────────────────────────────
// Tile-like markings (plate, pit, vent, runes, teleporter) are opaque floor tiles.
// Wall-mounted ones (lever, dart hole, face, inscription, doors, portcullis) are opaque wall tiles.
// Statue, lure, scorch, stain, bones are transparent so they sit on any floor.

WORLD_MAPS.mech_plate = stamp(BASE_FLOOR, 3, 3, [
  "3333333333",
  "3444444441",
  "3444444441",
  "3444444441",
  "3444444441",
  "3444444441",
  "3444444441",
  "3444444441",
  "3444444441",
  "1111111111",
]);
WORLD_MAPS.mech_plate_down = stamp(BASE_FLOOR, 3, 3, [
  "1111111111",
  "1222222223",
  "1222222223",
  "1222222223",
  "1222222223",
  "1222222223",
  "1222222223",
  "1222222223",
  "1222222223",
  "3333333333",
]);
WORLD_MAPS.mech_pit_open = stamp(BASE_FLOOR, 2, 2, [
  "11111111111.",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "100000000000",
  "............",
]);
WORLD_MAPS.mech_pit_spikes = stamp(WORLD_MAPS.mech_pit_open, 2, 3, [
  "...5.....5..",
  "..555...555.",
  "...5.....5..",
  ".....5......",
  "....555.....",
  ".5...5...5..",
  "555.....555.",
]);
WORLD_MAPS.mech_gas_vent = stamp(BASE_FLOOR, 3, 3, [
  "1111111111",
  "1000000001",
  "1444444441",
  "1000000001",
  "1444444441",
  "1000000001",
  "1444444441",
  "1000000001",
  "1444444441",
  "1111111111",
]);
WORLD_MAPS.mech_portcullis = [
  "3333333333333333",
  "4000400040004000",
  "4000400040004000",
  "3333333333333333",
  "4000400040004000",
  "4000400040004000",
  "4000400040004000",
  "4000400040004000",
  "4000400040004000",
  "4000400040004000",
  "3333333333333333",
  "4000400040004000",
  "4000400040004000",
  "4000400040004000",
  "4000400040004000",
  "3333333333333333",
];
WORLD_MAPS.mech_dart_hole = stamp(BASE_WALL, 6, 6, ["4444", "4004", "4004", "4444"]);
WORLD_MAPS.mech_lever_off = stamp(BASE_WALL, 5, 3, [
  "444444",
  "441144",
  "441144",
  "441144",
  "448844",
  "448844",
  "441144",
  "444444",
]);
WORLD_MAPS.mech_lever_on = stamp(BASE_WALL, 5, 3, [
  "444444",
  "448844",
  "448844",
  "441144",
  "441144",
  "441144",
  "441144",
  "444444",
]);

const RUNE_GLYPHS: Record<string, Rows> = {
  a: ["...XX...", "...XX...", "..XXXX..", "..XXXX..", ".XX..XX.", ".XX..XX.", "XXXXXXXX", "XXXXXXXX"],
  b: ["..XXXX..", ".XX..XX.", "XX....XX", "XX....XX", "XX....XX", "XX....XX", ".XX..XX.", "..XXXX.."],
  c: ["...XX...", "..XXXX..", ".XXXXXX.", "XXXXXXXX", "XXXXXXXX", ".XXXXXX.", "..XXXX..", "...XX..."],
  d: ["XX....XX", "XXX..XXX", ".XXXXXX.", "..XXXX..", "..XXXX..", ".XXXXXX.", "XXX..XXX", "XX....XX"],
  e: ["XX.XX.XX", "XX.XX.XX", "XX.XX.XX", "XX.XX.XX", "XX.XX.XX", "XX.XX.XX", "XX.XX.XX", "XXXXXXXX"],
  f: [".....XXX", "....XXX.", "...XXX..", "..XXXXXX", "XXXXXX..", "..XXX...", ".XXX....", "XXX....."],
};
const RUNE_COLORS: Record<string, string> = { a: "8", b: "a", c: "g", d: "k", e: "n", f: "9" };
for (const id of Object.keys(RUNE_GLYPHS)) {
  const framed = stamp(BASE_FLOOR, 1, 1, [
    "33333333333333",
    "3............3",
    ...Array.from({ length: 10 }, () => "3............3"),
    "33333333333333",
  ]);
  const withGlyph = stamp(framed, 4, 4, recolor(RUNE_GLYPHS[id], { X: RUNE_COLORS[id] }));
  // drop the inner '.' (transparent patch cells left base floor visible, so nothing to do)
  WORLD_MAPS[`mech_rune_${id}`] = withGlyph;
}

WORLD_MAPS.mech_statue = mirror([
  E8,
  ".....444",
  "....4343",
  "....4444",
  ".....444",
  "...55555",
  "..544444",
  "..544444",
  "..544444",
  "..543434",
  "...44444",
  "...44444",
  "..333333",
  "..444444",
  "..333333",
  "..333333",
]);
WORLD_MAPS.mech_face = mirror([
  "11111111",
  "13333333",
  "13344444",
  "13444444",
  "13440044",
  "13440044",
  "13444444",
  "13444440",
  "13444444",
  "13444000",
  "13444444",
  "13344444",
  "13333444",
  "13333333",
  "13333333",
  "11111111",
]);
WORLD_MAPS.mech_inscription = mirror([
  "11111111",
  "13333333",
  "13333333",
  "13444444",
  "13411414",
  "13444444",
  "13414114",
  "13444444",
  "13411441",
  "13444444",
  "13414141",
  "13444444",
  "13333333",
  "13333333",
  "13333333",
  "11111111",
]);

const DOOR_BODY: Rows = [
  "3333333333333333",
  "33dddddd1ddddd33",
  "33dddddd1ddddd33",
  "331ddddd1ddddd33",
  "331ddddd1ddddd33",
  "33dddddd1ddddd33",
  "33dddddd1ddddd33",
  "33dddddd1dddad33",
  "33dddddd1dddad33",
  "33dddddd1ddddd33",
  "33dddddd1ddddd33",
  "331ddddd1ddddd33",
  "331ddddd1ddddd33",
  "33dddddd1ddddd33",
  "33dddddd1ddddd33",
  "3333333333333333",
];
WORLD_MAPS.mech_door = DOOR_BODY;
// the false door is a hair off: the hinges are painted on the wrong side
WORLD_MAPS.mech_false_door = DOOR_BODY.map((r, i) => ([3, 4, 11, 12].includes(i) ? "33dddddd1dddd133" : r));
WORLD_MAPS.mech_door_open = [
  "3333333333333333",
  "3300000000000033",
  "3300000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33d0000000000033",
  "33dd000000000033",
  "3311000000000033",
  "3333333333333333",
];
WORLD_MAPS.mech_teleporter = stamp(BASE_FLOOR, 2, 2, [
  "....nnnnnn....",
  "..nn......nn..",
  ".n..........n.",
  ".n...oooo...n.",
  "n...oo..oo...n",
  "n...o....o...n",
  "n...o....o...n",
  "n...oo..oo...n",
  ".n...oooo...n.",
  ".n..........n.",
  "..nn......nn..",
  "....nnnnnn....",
]);
WORLD_MAPS.mech_lure = mirror([
  E8,
  E8,
  "..aaaaaa",
  "..abbaaa",
  "..abaaaa",
  "...aaaaa",
  "....aaad",
  ".....aad",
  ".......a",
  ".......a",
  ".......a",
  "....aaaa",
  "...aaaad",
  "...ddddd",
  E8,
  E8,
]);
WORLD_MAPS.mech_scorch = [
  "................",
  "................",
  "................",
  "......11........",
  "....11222.1.....",
  "...1222222211...",
  "..122222211221..",
  "..122222222221..",
  "...1122222221...",
  "..1.1222221.1...",
  "....1122211.....",
  ".....11.1.......",
  "................",
  "................",
  "................",
  "................",
];
WORLD_MAPS.mech_stain = [
  "................",
  "................",
  "................",
  "................",
  ".....77.........",
  "....7777..7.....",
  "...777877777....",
  "..77787777777...",
  "..77777877777...",
  "...777777777....",
  "....7777.77.....",
  ".....77....7....",
  "................",
  "................",
  "................",
  "................",
];
WORLD_MAPS.mech_bones = [
  "................",
  "................",
  "................",
  "....vvvv........",
  "...vvvvvv...v...",
  "...v11v1v..v.v..",
  "...vvvvvv...vv..",
  "....v11v....v...",
  "..v..vvv...v....",
  ".vvv........vv..",
  "..v..vv....v.v..",
  "......vv..v.....",
  "..vv..v....vv...",
  "...vv...........",
  "................",
  "................",
];

