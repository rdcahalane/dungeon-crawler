// The fixed final level: "The Tomb of the Hollow King".
//
// A 64x48 map made of twelve 16x16 chambers in a snake: the bottom row runs west to east, the middle row
// east to west, the top row west to east. Every chamber is one set piece, drawn as ASCII with marker letters
// (see builder.ts) so mechanism positions come from the map itself. The chambers are chained: each exit is
// closed by the puzzle in front of it. Three pieces of the Hollow King's key (Crown, Seal, Tooth) are won in
// chambers 4, 5 and 9; the door into the boss chamber (12) only opens when all three are seated.
//
//   10 Dry Saint  -> 11 False Tomb -> 12 Boss
//   ^
//    9 Narrowing <- 8 Two Doors <- 7 Hall of Pads <- 6 Breathless <- 5 Anvil Door
//                                                                      ^
//    1 Road of Lies -> 2 Wire Gallery -> 3 Weighing Gate -> 4 Rune Ring

import { E, marks, pos, tileKindOf, type Marks } from './builder';
import { mk, translateEvent, translateSpec } from './mechanisms';
import type { MechEvent, MechanismSpec, Pos } from './types';

export const CELL = 16;
export const KEY_PARTS = ['key_crown', 'key_seal', 'key_tooth'] as const;

export interface SetPiece {
  id: string;
  name: string;
  /** Chamber column and row in the 4x3 grid. */
  cell: [number, number];
  kinds: string[];
  /** True when the chamber's exit stays shut until its puzzle is solved (the others are hazards on an open road). */
  gated: boolean;
  /** Global coordinates. */
  solution: MechEvent[];
  carelessPath?: MechEvent[];
}

interface CellDef {
  n: number;
  name: string;
  cell: [number, number];
  rows: string[];
  build: (m: Marks) => { mechanisms: MechanismSpec[]; solution: MechEvent[]; carelessPath?: MechEvent[] };
}

const pit = (id: string, at: Pos): MechanismSpec =>
  mk('covered_pit', id, at, {
    hidden: true,
    diff: 5,
    params: { dice: [2, 6] },
    clue: 'The pole goes through the flagstone like a spoon through custard. Below, a pit, and not a clean one.',
  });

const GATED = new Set([3, 4, 5, 6, 8, 9, 10, 11, 12]);

const CELLS: CellDef[] = [
  // ── 1: the Road of Lies ────────────────────────────────────────────────────
  {
    n: 1,
    name: 'The Road of Lies',
    cell: [0, 2],
    rows: [
      '################',
      '################',
      '################',
      '################',
      '################',
      '################',
      '#.....##I#######',
      '#..............#',
      '#.u.s...........',
      '#.........b....#',
      '#.....##########',
      '################',
      '################',
      '################',
      '################',
      '################',
    ],
    build: (m) => {
      const pits = [pos(9, 8), pos(11, 7), pos(11, 9)];
      return {
        mechanisms: [
          ...pits.map((p, i) => pit(`c1_pit${i + 1}`, p)),
          mk('inscription', 'c1_note', m.p('I'), {
            clue: "THE DEAD KING'S ROAD IS LAID WITH LIES. ASK EVERY STONE BEFORE YOU TRUST IT.",
          }),
          mk('inscription', 'c1_bones', m.p('b'), {
            params: { look: 'bones' },
            clue: 'A boot, and in the boot, the rest of its owner.',
          }),
        ],
        solution: [
          E.read('c1_note'),
          ...pits.map((p) => E.probe(p)),
          ...E.walk([pos(6, 8), pos(7, 8), pos(8, 8), pos(9, 7), pos(10, 7), pos(10, 8), pos(11, 8), pos(12, 8), pos(13, 8), pos(14, 8), pos(15, 8)]),
        ],
        carelessPath: [E.step(pos(8, 8)), E.step(pos(9, 8))],
      };
    },
  },
  // ── 2: the Wire Gallery ────────────────────────────────────────────────────
  {
    n: 2,
    name: 'The Wire Gallery',
    cell: [1, 2],
    rows: [
      '################',
      '################',
      '################',
      '################',
      '################',
      '#######D########',
      '#..............#',
      '#........z.....#',
      '................',
      '#..............#',
      '#..............#',
      '################',
      '################',
      '################',
      '################',
      '################',
    ],
    build: (m) => ({
      mechanisms: [
        mk('dart_wall', 'c2_darts', m.p('D'), {
          tiles: [6, 7, 8, 9, 10].map((y) => pos(7, y)),
          params: { tripwire: true, ammo: 1, zone: { tx: 5, ty: 6, w: 5, h: 5 }, dice: [1, 6], poison: true, cause: 'poisoned darts' },
          clue: 'The pole catches a wire at ankle height. Darts rip across the gallery and shatter on the far wall. You stood well back.',
        }),
        mk('inscription', 'c2_scorch', m.p('z'), {
          params: { look: 'scorch' },
          clue: 'Black fans of soot spread from a hole in the north wall across the full width of the floor. Green-tipped bronze darts lie in the cracks below it.',
        }),
      ],
      solution: [E.read('c2_scorch'), E.probe(pos(7, 8)), ...E.walk([pos(1, 8), pos(5, 8), pos(6, 8), pos(7, 8), pos(8, 8), pos(14, 8), pos(15, 8)])],
      carelessPath: [E.step(pos(6, 8)), E.step(pos(7, 8))],
    }),
  },
  // ── 3: the Weighing Gate ───────────────────────────────────────────────────
  {
    n: 3,
    name: 'The Weighing Gate',
    cell: [2, 2],
    rows: [
      '################',
      '################',
      '################',
      '################',
      '################',
      '###I###D########',
      '#..........#####',
      '#......z...#####',
      '...a...p...g....',
      '#..........#####',
      '#..........#####',
      '################',
      '################',
      '################',
      '################',
      '################',
    ],
    build: (m) => {
      const plate = m.p('p');
      return {
        mechanisms: [
          mk('pressure_plate', 'c3_plate', plate, {
            params: { momentary: true },
            links: ['c3_gate', 'c3_darts'],
            clue: 'One flagstone sits a hair lower than the rest, ringed with old scorch.',
          }),
          mk('dart_wall', 'c3_darts', m.p('D'), {
            params: { zone: { tx: 5, ty: 6, w: 5, h: 5 }, dice: [2, 6], ammo: 3, save: 'breath' },
            clue: 'Narrow slots in the north wall, all aimed at the middle of the floor.',
          }),
          mk('portcullis', 'c3_gate', m.p('g')),
          mk('inscription', 'c3_note', m.p('I'), {
            clue: 'THE PLATE WEIGHS THIEF AND SAINT ALIKE, AND HAS NEVER LEARNED TO TELL A MAN FROM HIS LUGGAGE.',
          }),
          mk('inscription', 'c3_scorch', m.p('z'), {
            params: { look: 'scorch' },
            clue: 'Every black streak ends at the plate. Whoever stands on it eats the whole wall.',
          }),
        ],
        solution: [
          E.read('c3_note'),
          E.step(m.p('a')),
          E.step(pos(4, 8)),
          E.step(plate, 'item'),
          ...E.walk([pos(5, 7), pos(6, 7), pos(8, 7), pos(9, 8), pos(10, 8), pos(11, 8), pos(12, 8), pos(15, 8)]),
        ],
        carelessPath: [E.step(pos(4, 8)), E.step(plate)],
      };
    },
  },
  // ── 4: the Ring of Six Runes (Crown shard) ─────────────────────────────────
  {
    n: 4,
    name: 'The Ring of Six Runes',
    cell: [3, 2],
    rows: [
      '########.#######',
      '########.#######',
      '#####I##S#######',
      '##............##',
      '##............##',
      '##....b...c...##',
      '##............##',
      '##............##',
      '....a.......d.##',
      '##............##',
      '##............##',
      '##....f...e...##',
      '##............##',
      '##............##',
      '###########J####',
      '################',
    ],
    build: (m) => {
      const [a, b, c, d, e, f] = ['a', 'b', 'c', 'd', 'e', 'f'].map((ch) => m.p(ch));
      return {
        mechanisms: [
          mk('rune_floor', 'c4_runes', c, {
            tiles: [e, a, f, b, d],
            params: {
              order: [2, 4, 0, 5, 1, 3], glyphs: ['c', 'e', 'a', 'f', 'b', 'd'], punish: 'bolt', dice: [2, 6], save: 'wands',
              cause: 'a bolt from the wrong rune', grant: KEY_PARTS[0], spawnAt: pos(8, 8),
            },
            links: ['c4_slide'],
            clue: 'Six rune-stones ring the hall. They are warm underfoot, as if something below were listening.',
          }),
          mk('sliding_wall', 'c4_slide', m.p('S')),
          mk('inscription', 'c4_note', m.p('I'), {
            clue: "BEGIN WHERE THE DRAFT FROM THE DOOR FIRST STRIKES STONE. GO NORTH, THEN ROUND THE RING AS A CLOCK'S HAND GOES, UNTIL YOU STAND BESIDE YOUR OWN FIRST FOOTPRINT. NO RUNE TWICE. THE FIRST PIECE OF THE KEY LIES WHERE THE LAST RUNE WAKES.",
          }),
          mk('inscription', 'c4_warn', m.p('J'), { clue: 'THE FLOOR REMEMBERS EVERY WRONG STEP, AND THE CEILING PAYS ITS DEBTS.' }),
        ],
        solution: [E.read('c4_note'), E.read('c4_warn'), ...E.walk([a, b, c, d, e, f]), ...E.walk([pos(8, 3), pos(8, 2), pos(8, 1), pos(8, 0)])],
        carelessPath: [E.step(c)],
      };
    },
  },
  // ── 5: the Anvil Door (Seal shard) ─────────────────────────────────────────
  {
    n: 5,
    name: 'The Anvil Door',
    cell: [3, 1],
    rows: [
      '################',
      '################',
      '################',
      '#####I##########',
      '###...........##',
      '###...........##',
      '###...........##',
      '###...........##',
      '..d...........##',
      '###...........##',
      '###...........##',
      '###...........##',
      '###.....b.....##',
      '###...........##',
      '########.#######',
      '########.#######',
    ],
    build: (m) => ({
      mechanisms: [
        mk('riddle_door', 'c5_door', m.p('d'), {
          params: {
            answers: ['anvil', 'an anvil', 'the anvil', 'smith anvil', "smith's anvil", 'smiths anvil'],
            strikes: 3, dice: [2, 6], save: 'spells', cause: "the anvil door's answer", grant: KEY_PARTS[1], spawnAt: pos(3, 8),
          },
          clue: 'Cut into the lintel: EVERY BLOW IN THE KINGDOM IS STRUCK ON MY ACCOUNT, AND I HAVE NEVER STRUCK BACK. THE SWORDS ARE BORN IN MY LAP, AND I OUTLIVE EVERY ONE OF THEM.',
        }),
        mk('inscription', 'c5_note', m.p('I'), {
          clue: 'THE DOOR WANTS A WORD, NOT A SHOULDER. THE SECOND PIECE OF THE KEY IS THE DOOR\'S TOLL, AND IT PAYS ITS TOLL TO THE ONE WHO ANSWERS.',
        }),
        mk('inscription', 'c5_bones', m.p('b'), {
          params: { look: 'bones' },
          clue: 'Dozens of shoulder-blades, stacked like crockery. None of them was ever any use.',
        }),
      ],
      solution: [
        ...E.walk([pos(8, 14), pos(8, 10), pos(4, 8)]),
        E.read('c5_note'),
        E.read('c5_door'),
        E.answer('c5_door', 'An anvil.'),
        ...E.walk([pos(3, 8), pos(2, 8), pos(1, 8), pos(0, 8)]),
      ],
      carelessPath: [E.answer('c5_door', 'open'), E.answer('c5_door', 'sword'), E.answer('c5_door', 'forge')],
    }),
  },
  // ── 6: the Breathless Hall ─────────────────────────────────────────────────
  {
    n: 6,
    name: 'The Breathless Hall',
    cell: [2, 1],
    rows: [
      '################',
      '################',
      '################',
      '######V#########',
      '##........######',
      '##........######',
      '##........###L##',
      '##........##...#',
      '.h........tg....',
      '##........##...#',
      '##........####I#',
      '##........######',
      '##........######',
      '################',
      '################',
      '################',
    ],
    build: (m) => {
      const t = m.p('t');
      return {
        mechanisms: [
          mk('gas_room', 'c6_gas', m.p('V'), {
            tiles: [t],
            hidden: true,
            links: ['c6_gate'],
            params: { zone: { tx: 2, ty: 4, w: 9, h: 9 }, totalMs: 25000 },
            clue: 'A square stone just inside the doorway, rubbed bright by one step in a hundred. The vents above are crusted yellow.',
          }),
          mk('lever', 'c6_vent', m.p('L'), {
            hidden: true,
            diff: 15,
            links: ['c6_gas', 'c6_exit'],
            clue: 'A brick too clean for its neighbours. Behind it a pull-ring on a chain that climbs toward the vents.',
            params: { listenText: 'A faint dry rasp in the wall, like a chain taking up slack.' },
          }),
          mk('portcullis', 'c6_gate', m.p('g'), { params: { startOpen: true } }),
          mk('portcullis', 'c6_exit', m.p('h')),
          mk('inscription', 'c6_note', m.p('I'), {
            clue: 'THE HALL HOLDS ITS BREATH UNTIL IT IS FED. FIND THE CLEAN BRICK BEFORE YOU FEED IT, FOR THE FAR DOOR OPENS TO THE SAME HAND.',
          }),
        ],
        solution: [
          E.step(pos(15, 8)),
          E.read('c6_note'),
          E.listen(pos(13, 7)),
          E.search(pos(13, 7)),
          E.pull('c6_vent'),
          ...E.walk([pos(12, 8), pos(11, 8), t, pos(9, 8), pos(5, 8), pos(2, 8), pos(1, 8), pos(0, 8)]),
        ],
        carelessPath: [E.step(pos(11, 8)), E.step(t), ...E.wait(30)],
      };
    },
  },
  // ── 7: the Hall of Pads ────────────────────────────────────────────────────
  {
    n: 7,
    name: 'The Hall of Pads',
    cell: [1, 1],
    rows: [
      '################',
      '################',
      '################',
      '################',
      '################',
      '################',
      '#######I########',
      '#..............#',
      '................',
      '#...z..........#',
      '###h############',
      '##...###########',
      '#L...###########',
      '##...###########',
      '################',
      '################',
    ],
    build: (m) => {
      const loop = pos(14, 8);
      const pads: { id: string; at: Pos; cell: boolean }[] = [
        { id: 'c7_pad1', at: pos(12, 7), cell: false },
        { id: 'c7_pad2', at: pos(11, 8), cell: true },
        { id: 'c7_pad3', at: pos(8, 7), cell: false },
        { id: 'c7_pad4', at: pos(6, 8), cell: false },
        { id: 'c7_pad5', at: pos(4, 7), cell: false },
      ];
      return {
        mechanisms: [
          ...pads.map((p) =>
            mk('teleporter', p.id, p.at, {
              hidden: true,
              diff: 5,
              params: p.cell ? { dest: pos(3, 12), spawn: 'skeleton', spawnAt: pos(4, 13) } : { dest: loop },
              clue: 'A hairline square in the floor. The stone inside it hums when you lean on it.',
            }),
          ),
          mk('portcullis', 'c7_hatch', m.p('h')),
          mk('lever', 'c7_lever', m.p('L'), { links: ['c7_hatch'] }),
          mk('inscription', 'c7_note', m.p('I'), {
            clue: 'ONLY THE LOWEST ROAD IS SURE. THE HIGHER ROADS ARE THE SAME ROAD, WALKED AGAIN.',
          }),
          mk('inscription', 'c7_lane', m.p('z'), {
            params: { look: 'stain' },
            clue: 'The dust is scuffed in a single lane along the south wall and nowhere else. The rest lies untouched as a made bed.',
          }),
        ],
        solution: [
          E.read('c7_note'),
          E.read('c7_lane'),
          E.probe(pos(11, 8)),
          E.probe(pos(12, 7)),
          ...E.walk(Array.from({ length: 14 }, (_, i) => pos(14 - i, 9))),
          E.step(pos(0, 8)),
        ],
        carelessPath: [E.step(pos(11, 8))],
      };
    },
  },
  // ── 8: Two Doors ───────────────────────────────────────────────────────────
  {
    n: 8,
    name: 'Two Doors, One Honest',
    cell: [0, 1],
    rows: [
      '########.#######',
      '########.#######',
      '########.#######',
      '########S#######',
      '##.............#',
      '##.............#',
      '##.............#',
      '##.............#',
      '#F..............',
      '##.............#',
      '##.............#',
      '##.............#',
      '##.............#',
      '#####I##########',
      '################',
      '################',
    ],
    build: (m) => ({
      mechanisms: [
        mk('false_door', 'c8_false', m.p('F'), {
          params: { springs: 'darts', dice: [3, 6], save: 'breath', saveHalves: true, cause: 'the false door' },
          clue: 'The hinge-pins are paint, the handle is wired to a spring, and the dust around the frame is full of dart-shafts.',
        }),
        mk('secret_door', 'c8_secret', m.p('S'), {
          hidden: true,
          diff: 10,
          clue: 'A hair-thin seam in the north wall, pinned in the middle: a slab that pivots.',
          params: { listenText: 'A cold thin whistle comes through the north wall. Air is moving on the other side of that stone.' },
        }),
        mk('inscription', 'c8_note', m.p('I'), {
          clue: 'THE DOOR THAT BEGS TO BE OPENED HAS NEVER BEEN A DOOR. THE ONE THAT DOES NOT ASK ONLY LISTENS.',
        }),
      ],
      solution: [
        ...E.walk([pos(14, 8), pos(8, 8), pos(8, 5), pos(8, 4)]),
        E.read('c8_note'),
        E.listen(pos(8, 4)),
        E.search(pos(8, 4)),
        E.push('c8_secret'),
        ...E.walk([pos(8, 3), pos(8, 2), pos(8, 1), pos(8, 0)]),
      ],
      carelessPath: [E.step(pos(2, 8)), E.open('c8_false')],
    }),
  },
  // ── 9: the Narrowing (Tooth shard) ─────────────────────────────────────────
  {
    n: 9,
    name: 'The Narrowing',
    cell: [0, 0],
    rows: [
      '################',
      '################',
      '################',
      '################',
      '#####.......####',
      '#####.......####',
      '#####.......####',
      '#####...t...####',
      '#####.......e...',
      '#####.......####',
      '#####.......####',
      '########g#######',
      '######L...######',
      '######I...######',
      '########.#######',
      '########.#######',
    ],
    build: (m) => {
      const t = m.p('t');
      return {
        mechanisms: [
          mk('closing_walls', 'c9_walls', t, {
            hidden: true,
            links: ['c9_gate', 'c9_exit'],
            params: {
              zone: { tx: 5, ty: 4, w: 7, h: 7 }, totalMs: 45000, stages: 3, spikesNeeded: 1, saveMod: -2,
              grant: KEY_PARTS[2], spawnAt: pos(8, 8),
            },
            clue: 'Grooves run across the floor from every wall toward the middle stone, and the stone is rubbed bright by something dragged over it.',
          }),
          mk('lever', 'c9_lever', m.p('L'), {
            hidden: true,
            diff: 20,
            links: ['c9_walls'],
            clue: 'A lever of ash-black iron, tucked into a gap that looks like a flaw in the stone.',
            params: { listenText: 'Behind the wall, stone grinds on stone in a very slow loop that has been running for years.' },
          }),
          mk('portcullis', 'c9_gate', m.p('g'), { params: { startOpen: true } }),
          mk('portcullis', 'c9_exit', m.p('e')),
          mk('inscription', 'c9_note', m.p('I'), {
            clue: 'WHAT CLOSES CAN BE ASKED TO STAY. AN IRON TONGUE HOLDS A STONE MOUTH. THE LAST PIECE OF THE KEY WAITS WHERE THE WALLS WOULD MEET.',
          }),
        ],
        solution: [
          ...E.walk([pos(8, 14), pos(8, 13), pos(7, 12)]),
          E.read('c9_note'),
          E.listen(pos(7, 12)),
          E.search(pos(7, 12)),
          E.pull('c9_lever'),
          ...E.walk([m.p('g'), pos(8, 10), t, pos(8, 8), pos(11, 8), pos(12, 8), pos(13, 8), pos(15, 8)]),
        ],
        carelessPath: [E.step(m.p('g')), E.step(t), ...E.wait(50)],
      };
    },
  },
  // ── 10: the Dry Saint ──────────────────────────────────────────────────────
  {
    n: 10,
    name: 'The Dry Saint',
    cell: [1, 0],
    rows: [
      '################',
      '################',
      '################',
      '################',
      '################',
      '###I############',
      '#.........######',
      '#....s....######',
      '..........g.....',
      '#.........######',
      '#.........######',
      '################',
      '################',
      '################',
      '################',
      '################',
    ],
    build: (m) => ({
      mechanisms: [
        mk('statue_offering', 'c10_saint', m.p('s'), {
          params: { wants: 'torch' },
          links: ['c10_gate'],
          clue: 'A saint of the long dark. In her raised hand, an empty iron cresset, black with old soot. Cut on her plinth: SHE DOES NOT WANT TO BE PAID. SHE WANTS TO SEE.',
        }),
        mk('portcullis', 'c10_gate', m.p('g')),
        mk('inscription', 'c10_note', m.p('I'), {
          clue: 'SHE HAS BEEN IN THE DARK SO LONG SHE HAS FORGOTTEN WHAT GOLD LOOKS LIKE, AND SHE RESENTS BEING REMINDED.',
        }),
      ],
      solution: [E.step(pos(2, 8)), E.read('c10_note'), E.read('c10_saint'), E.offer('c10_saint', 'torch'), ...E.walk([pos(9, 8), pos(10, 8), pos(15, 8)])],
      carelessPath: [E.offer('c10_saint', 'gem')],
    }),
  },
  // ── 11: the False Tomb ─────────────────────────────────────────────────────
  {
    n: 11,
    name: 'The False Tomb',
    cell: [2, 0],
    rows: [
      '################',
      '################',
      '###B#X#F#Y#R####',
      '##............##',
      '##............##',
      '##............##',
      '##....z.......##',
      '##............##',
      '........i.....S.',
      '##............##',
      '##......y.....##',
      '##...C.....C..##',
      '##............##',
      '##............##',
      '####I###########',
      '################',
    ],
    build: (m) => ({
      mechanisms: [
        mk('lure', 'c11_idol', m.p('i'), {
          params: { save: 'petrify', saveMod: -2, cause: "the king's golden effigy" },
          clue: 'The effigy wears a smile too wide for the face, and its crown is bright where every other thing in the room is dust.',
        }),
        mk('lever', 'c11_brazier', m.p('B'), {
          params: { setsFlag: 'c11_warm' },
          clue: 'A lever with a flame cut into its plate. Behind the wall a draught is let into a flue.',
        }),
        mk('lever', 'c11_left', m.p('X'), { params: { fires: ['c11_roof'] }, clue: 'Cold iron. A little pale powder lies on the floor beneath it.' }),
        mk('talking_face', 'c11_face', m.p('F'), {
          params: {
            truthFlag: 'c11_warm',
            trueText: 'The right lever lifts the wall. The left lever lets the roof fall.',
            falseText: 'The left lever lifts the wall. The right lever lets the roof fall.',
          },
        }),
        mk('lever', 'c11_right', m.p('Y'), { links: ['c11_exit'], clue: 'Cold iron. The floor beneath is swept clean.' }),
        mk('dart_wall', 'c11_roof', m.p('R'), {
          hidden: true,
          params: { zone: { tx: 2, ty: 3, w: 12, h: 11 }, dice: [4, 6], ammo: 1, save: 'breath', saveHalves: true, cause: 'the falling roof' },
          clue: 'The ceiling slabs above the left lever sit in grooves, and fine pale dust has sifted from their joints.',
        }),
        mk('sliding_wall', 'c11_exit', m.p('S')),
        mk('inscription', 'c11_note', m.p('I'), {
          clue: 'THE HOLLOW KING IS NOT AT HOME. THE MOUTH IN THE NORTH WALL KNOWS THE WAY OUT, BUT SPEAKS TRUE ONLY WHILE THE COALS ARE LIT.',
        }),
        mk('inscription', 'c11_scorch', m.p('z'), {
          params: { look: 'scorch' },
          clue: 'Scorch rings the effigy and the floor is polished by knees. The walls elsewhere are clean as a bone.',
        }),
        mk('inscription', 'c11_bones', m.p('y'), {
          params: { look: 'bones' },
          clue: 'Two skeletons embracing, one of them wearing the other\'s ring.',
        }),
      ],
      solution: [
        E.read('c11_note'),
        E.pull('c11_brazier'),
        E.touch('c11_face'),
        E.pull('c11_right'),
        ...E.walk([pos(1, 8), pos(7, 8), pos(7, 9), pos(9, 9), pos(9, 8), pos(13, 8), pos(14, 8), pos(15, 8)]),
      ],
      carelessPath: [E.touch('c11_idol')],
    }),
  },
  // ── 12: the Hollow King's door and chamber ─────────────────────────────────
  {
    n: 12,
    name: "The Hollow King's Door",
    cell: [3, 0],
    rows: [
      '################',
      '################',
      '################',
      '#####.........##',
      '#####.........##',
      '#####........C##',
      '##I##.........##',
      '#...#.........##',
      'k........h...x##',
      '#...#.........##',
      '#####.........##',
      '#####........C##',
      '#####.........##',
      '#####.........##',
      '################',
      '################',
    ],
    build: (m) => ({
      mechanisms: [
        mk('locked_door', 'c12_door', m.p('k'), {
          params: { seats: [...KEY_PARTS], unpickable: true },
          clue: 'No handle, no hinge, no pin to pick. Three keyholes: one cut like a crown, one like a seal, one like a tooth.',
        }),
        mk('inscription', 'c12_note', m.p('I'), {
          clue: 'THE KING WAS BURIED WITH HIS KEY IN THREE PIECES, SO THAT NO ONE THIEF COULD BE TRUSTED WITH THE WHOLE OF HIM. NOBODY HAS WALKED OUT OF HIS ROOM BACKWARDS.',
        }),
        mk('one_way_door', 'c12_seal', pos(5, 8), {
          params: { door: pos(4, 8) },
          clue: 'The inner face of the doorway has no handle, no hinge-pin and no keyhole. It was built to be walked into once.',
        }),
      ],
      solution: [
        E.step(pos(0, 8)),
        E.open('c12_door', KEY_PARTS[0]),
        E.open('c12_door', KEY_PARTS[1]),
        E.open('c12_door', KEY_PARTS[2]),
      ],
    }),
  },
];

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface TombData {
  id: string;
  name: string;
  width: number;
  height: number;
  rows: string[];
  mechanisms: MechanismSpec[];
  solution: MechEvent[];
  walkthrough: string[];
  setPieces: SetPiece[];
  playerStart: Pos;
  stairsUpPos: Pos;
  /** The way out, behind the boss. */
  stairsPos: Pos;
  /** HOLLOW_KING spawn marker. */
  bossSpawn: Pos;
  /** The three pieces of the key, in seating order. */
  keyParts: string[];
  keyDoorId: string;
  /** Chests: the two in the false tomb are mimics. */
  chests: { tx: number; ty: number; tier: 'wooden' | 'iron' | 'golden'; isMimic: boolean }[];
  /** Guards using the existing enemy table. */
  guards: { tx: number; ty: number; type: 'SKELETON' | 'ZOMBIE' | 'GHOST' }[];
}

function assemble(): TombData {
  const grid: string[] = [];
  const mechanisms: MechanismSpec[] = [];
  const solution: MechEvent[] = [];
  const setPieces: SetPiece[] = [];
  const chests: TombData['chests'] = [];
  let start: Pos | undefined;
  let up: Pos | undefined;
  let down: Pos | undefined;
  let boss: Pos | undefined;

  for (let cy = 0; cy < 3; cy++) {
    for (let ly = 0; ly < CELL; ly++) {
      let line = '';
      for (let cx = 0; cx < 4; cx++) {
        const def = CELLS.find((c) => c.cell[0] === cx && c.cell[1] === cy);
        if (!def) throw new Error(`no chamber at ${cx},${cy}`);
        line += def.rows[ly];
      }
      grid.push(line);
    }
  }

  const ordered = [...CELLS].sort((a, b) => a.n - b.n);
  for (const def of ordered) {
    def.rows.forEach((r, i) => {
      if (r.length !== CELL) throw new Error(`chamber ${def.n} row ${i} is ${r.length} wide`);
    });
    if (def.rows.length !== CELL) throw new Error(`chamber ${def.n} has ${def.rows.length} rows`);
    const m = marks(def.rows);
    const dx = def.cell[0] * CELL;
    const dy = def.cell[1] * CELL;
    const built = def.build(m);
    const specs = built.mechanisms.map((s) => translateSpec(s, dx, dy));
    mechanisms.push(...specs);
    const sol = built.solution.map((e) => translateEvent(e, dx, dy));
    solution.push(...sol);
    setPieces.push({
      id: `chamber_${def.n}`,
      name: def.name,
      cell: def.cell,
      kinds: [...new Set(specs.map((s) => s.kind).filter((k) => k !== 'inscription'))],
      gated: GATED.has(def.n),
      solution: sol,
      carelessPath: built.carelessPath?.map((e) => translateEvent(e, dx, dy)),
    });
    if (def.n === 1) {
      start = { tx: m.p('s').tx + dx, ty: m.p('s').ty + dy };
      up = { tx: m.p('u').tx + dx, ty: m.p('u').ty + dy };
    }
    if (def.n === 11) {
      for (const c of m.all('C')) chests.push({ tx: c.tx + dx, ty: c.ty + dy, tier: 'golden', isMimic: true });
    }
    if (def.n === 12) {
      const h = m.p('h');
      const x = m.p('x');
      boss = { tx: h.tx + dx, ty: h.ty + dy };
      down = { tx: x.tx + dx, ty: x.ty + dy };
      for (const c of m.all('C')) chests.push({ tx: c.tx + dx, ty: c.ty + dy, tier: 'golden', isMimic: false });
    }
  }
  if (!start || !up || !down || !boss) throw new Error('tomb is missing a marker');

  const keyDoor = mechanisms.find((s) => s.id === 'c12_door');
  if (!keyDoor) throw new Error('tomb is missing the key door');

  for (const row of grid) for (const ch of row) tileKindOf(ch);

  return {
    id: 'tomb_of_the_hollow_king',
    name: 'The Tomb of the Hollow King',
    width: CELL * 4,
    height: CELL * 3,
    rows: grid,
    mechanisms,
    solution,
    walkthrough: [
      '1. The Road of Lies: read the warning, probe the three hidden pits with the pole, then walk the zigzag round them.',
      '2. The Wire Gallery: the scorch fan says darts. Probe the tripwire from a distance so the single volley spends itself on the far wall.',
      '3. The Weighing Gate: stand west of the dart zone and drop a sack on the plate; the gate holds up while the sack weighs it, and the darts hit nobody.',
      '4. The Ring of Six Runes: tread the runes nearest the door, then north, then clockwise round the ring. The Crown shard drops in the middle and the north wall slides away.',
      '5. The Anvil Door: answer the riddle with "anvil". The door pays its toll, the Seal shard, and opens west.',
      '6. The Breathless Hall: read the warning, listen and search the antechamber wall, pull the hidden vent lever (it also unbars the far gate), and only then cross the doorway stone.',
      '7. The Hall of Pads: the dust shows one worn lane along the south wall. Walk it; the hidden pads on the upper roads loop you back or drop you into a cell.',
      '8. Two Doors: ignore the grand carved door (darts). Listen and search at the north wall for the draught and the pinned slab, then push it open.',
      '9. The Narrowing: search the vestibule for the black lever and pull it before stepping on the bright stone. It stops the walls and drops the Tooth shard. (Backup: step in, then drive an iron spike into the groove.)',
      '10. The Dry Saint: she wants light, not gold. Offer a torch and the gate lifts.',
      '11. The False Tomb: the golden effigy and its two chests are bait (petrify, and mimics). Pull the flame lever to warm the Mouth, ask it, and it truthfully names the right-hand lever; pull that and the east wall slides away.',
      "12. The Hollow King's Door: seat Crown, Seal and Tooth in the three keyholes. The boss chamber opens: the Hollow King waits, and the real treasure and the way out lie behind him.",
    ],
    setPieces,
    playerStart: start,
    stairsUpPos: up,
    stairsPos: down,
    bossSpawn: boss,
    keyParts: [...KEY_PARTS],
    keyDoorId: 'c12_door',
    chests,
    guards: [
      { tx: 58, ty: 26, type: 'SKELETON' },
      { tx: 6, ty: 26, type: 'ZOMBIE' },
      { tx: 22, ty: 10, type: 'GHOST' },
      { tx: 53, ty: 10, type: 'SKELETON' },
      { tx: 52, ty: 8, type: 'SKELETON' },
    ],
  };
}

export const TOMB: TombData = assemble();
