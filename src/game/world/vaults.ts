// Fifteen original vaults. Every one has a readable clue for every lethal part, an intended safe solution,
// and a careless path that hurts. Coordinates in solutions are vault-local.

import { E, defineVault, pos } from './builder';
import { mk } from './mechanisms';
import type { VaultDef } from './types';

const loose_flag = defineVault({
  id: 'loose_flag',
  name: 'The Loose Flagstone',
  floors: [1, 3],
  lootTier: 'wooden',
  trick: 'A mismatched slab hides a pit: probe it with the pole, walk round it, then pull the lever that lifts the gate.',
  rows: [
    '###I###L####',
    '#.......#..#',
    '#.......#..#',
    '....p...g.C#',
    '#.......#..#',
    '#.......#..#',
    '############',
  ],
  notes: { I: 'warning inscription', L: 'brass lever', p: 'loose flagstone', g: 'portcullis' },
  build: (m) => {
    const pit = m.p('p');
    return {
      mechanisms: [
        mk('covered_pit', 'lf_pit', pit, {
          params: { dice: [1, 6] },
          clue: 'The slab rocks under the pole. Beneath it a shaft drops away, its floor paved with old bone.',
        }),
        mk('inscription', 'lf_note', m.p('I'), {
          clue: 'One flag in this hall was laid on nothing, and the people who trusted it lie under it. Walk round, or ask the stone with a pole.',
        }),
        mk('lever', 'lf_lever', m.p('L'), { links: ['lf_gate'], clue: 'A brass lever in a socket. The gate beyond is the only other thing in the hall that is not stone.' }),
        mk('portcullis', 'lf_gate', m.p('g')),
      ],
      goal: { kind: 'open', id: 'lf_gate' },
      solution: [
        E.read('lf_note'),
        E.probe(pit),
        ...E.walk([pos(3, 3), pos(3, 2), pos(4, 2), pos(5, 2), pos(6, 2), pos(7, 2)]),
        E.pull('lf_lever'),
      ],
      carelessPath: [E.step(pos(3, 3)), E.step(pit)],
    };
  },
});

const two_levers = defineVault({
  id: 'two_levers',
  name: 'The Two Brass Handles',
  floors: [1, 3],
  lootTier: 'wooden',
  trick: 'Two levers, one gate: the handle polished bright by many palms is the one that fires the darts.',
  rows: [
    '##A#B######',
    '#.....#...#',
    'D.....#...#',
    '#.....g..C#',
    '......#...#',
    '#.....#...#',
    '###I#######',
  ],
  notes: { A: 'left lever', B: 'right lever', D: 'dart holes', I: 'inscription', g: 'portcullis' },
  build: (m) => ({
    mechanisms: [
      mk('lever', 'tl_left', m.p('A'), { links: ['tl_gate'], clue: 'Green with age, its housing furred with dust. Nobody has touched this one in a long time.' }),
      mk('lever', 'tl_right', m.p('B'), { params: { fires: ['tl_darts'] }, clue: 'The brass is rubbed bright and warm-looking by a hundred palms.' }),
      mk('dart_wall', 'tl_darts', m.p('D'), {
        params: { zone: { tx: 1, ty: 1, w: 5, h: 5 }, dice: [2, 4], ammo: 2, save: 'breath' },
        clue: 'The west wall is pitted with tiny black holes, and under them the floor is stuck with bronze dart-tips.',
      }),
      mk('portcullis', 'tl_gate', m.p('g')),
      mk('inscription', 'tl_note', m.p('I'), {
        clue: 'MANY HANDS WORE THE RIGHT-HAND BRASS BRIGHT. FEW CAME BACK TO WEAR THE LEFT.',
      }),
    ],
    goal: { kind: 'open', id: 'tl_gate' },
    solution: [E.read('tl_note'), E.read('tl_left'), E.read('tl_right'), E.pull('tl_left')],
    carelessPath: [E.step(pos(3, 3)), E.pull('tl_right')],
  }),
});

const weighing_hall = defineVault({
  id: 'weighing_hall',
  name: 'The Weighing Hall',
  floors: [2, 4],
  lootTier: 'wooden',
  trick: 'A plate holds the gate up only while weighted, and fires darts at whoever stands on it: drop a sack on it from the safe side.',
  rows: [
    '###I###D######',
    '#......z..#..#',
    '#.........#..#',
    '..a....p..g.C#',
    '#.........#..#',
    '#.........#..#',
    '##############',
  ],
  notes: { I: 'inscription', D: 'dart holes', z: 'scorch marks', a: 'where the careful stand', p: 'pressure plate', g: 'portcullis' },
  build: (m) => {
    const plate = m.p('p');
    return {
      mechanisms: [
        mk('pressure_plate', 'wh_plate', plate, {
          params: { momentary: true },
          links: ['wh_gate', 'wh_darts'],
          clue: 'A flagstone that sits a hair lower than its neighbours, ringed by old black scorch-marks.',
        }),
        mk('dart_wall', 'wh_darts', m.p('D'), {
          params: { zone: { tx: 5, ty: 1, w: 5, h: 5 }, dice: [2, 6], ammo: 3, save: 'breath' },
          clue: 'A dozen narrow slots in the north wall, all aimed at the middle of the hall.',
        }),
        mk('portcullis', 'wh_gate', m.p('g')),
        mk('inscription', 'wh_note', m.p('I'), {
          clue: 'THE PLATE COUNTS WEIGHT THE WAY A MISER COUNTS COINS. IT WAS NEVER TAUGHT TO TELL A SACK FROM A MAN.',
        }),
        mk('inscription', 'wh_scorch', m.p('z'), {
          params: { look: 'scorch' },
          clue: 'Black streaks fan from the north wall and all meet at the plate. Whatever stands there takes everything the wall throws.',
        }),
      ],
      goal: { kind: 'open', id: 'wh_gate' },
      solution: [
        E.read('wh_note'),
        E.step(m.p('a')),
        E.step(pos(4, 3)),
        E.step(plate, 'item'),
        ...E.walk([pos(5, 2), pos(6, 2), pos(7, 2), pos(8, 2), pos(9, 3), pos(10, 3)]),
      ],
      carelessPath: [E.step(pos(4, 3)), E.step(plate)],
    };
  },
});

const rune_ring = defineVault({
  id: 'rune_ring',
  name: 'The Ring of Six',
  floors: [3, 6],
  lootTier: 'iron',
  trick: 'Six runes in a ring must be trodden in order; a wall inscription gives the order by geometry, not by pictures.',
  rows: [
    '######I########',
    '#..........#..#',
    '#...b...c..#..#',
    '#..........#..#',
    '#..........#..#',
    '...a.....d.S.C#',
    '#..........#..#',
    '#..........#..#',
    '#...f...e..#..#',
    '#..........#..#',
    '######J########',
  ],
  notes: { a: 'rune nearest the door', b: 'rune', c: 'rune', d: 'rune', e: 'rune', f: 'rune', S: 'sliding wall to the treasure', I: 'inscription', J: 'inscription' },
  build: (m) => {
    const [a, b, c, d, e, f] = ['a', 'b', 'c', 'd', 'e', 'f'].map((ch) => m.p(ch));
    // footprint order (primary first): c, e, a, f, b, d  ->  tread order a, b, c, d, e, f = indices 2, 4, 0, 5, 1, 3
    return {
      mechanisms: [
        mk('rune_floor', 'rr_runes', c, {
          tiles: [e, a, f, b, d],
          params: { order: [2, 4, 0, 5, 1, 3], glyphs: ['c', 'e', 'a', 'f', 'b', 'd'], punish: 'bolt', dice: [2, 6], save: 'wands', cause: 'a bolt from the wrong rune' },
          links: ['rr_slide'],
          clue: 'Six rune-stones ring the hall, each a hand wide. They are warm, as though something under them is paying attention.',
        }),
        mk('sliding_wall', 'rr_slide', m.p('S')),
        mk('inscription', 'rr_note', m.p('I'), {
          clue: "BEGIN WHERE THE DRAFT FROM THE DOOR FIRST STRIKES STONE. GO NORTH, THEN ROUND THE RING AS A CLOCK'S HAND GOES, UNTIL YOU STAND BESIDE YOUR OWN FIRST FOOTPRINT. NO RUNE TWICE.",
        }),
        mk('inscription', 'rr_warn', m.p('J'), {
          clue: 'THE FLOOR REMEMBERS EVERY WRONG STEP, AND THE CEILING PAYS ITS DEBTS.',
        }),
      ],
      goal: { kind: 'open', id: 'rr_slide' },
      solution: [E.read('rr_note'), E.read('rr_warn'), ...E.walk([a, b, c, d, e, f])],
      carelessPath: [E.step(c)],
    };
  },
});

const false_and_true = defineVault({
  id: 'false_and_true',
  name: 'Two Doors, One Honest',
  floors: [3, 6],
  lootTier: 'iron',
  trick: 'The grand carved door drops you a floor; the real way is a secret slab in the north wall, found by ear then by eye.',
  rows: [
    '###########',
    '###.C.#####',
    '####S######',
    '#.........#',
    '#.........#',
    '..........F',
    '#.........#',
    '#.........#',
    '#####I#####',
  ],
  notes: { S: 'secret door', F: 'false door', I: 'inscription' },
  build: (m) => ({
    mechanisms: [
      mk('false_door', 'fd_false', m.p('F'), {
        params: { springs: 'fall', floors: 1, dice: [2, 6] },
        clue: 'The hinge-pins are painted on, not forged, and the handle is wired to something that is not a lock.',
      }),
      mk('secret_door', 'fd_secret', m.p('S'), {
        hidden: true,
        diff: 10,
        clue: 'A hairline seam in the north wall, pinned in the middle: a slab that pivots.',
        params: { listenText: 'A thin cold whistle slips through the north wall. Air moves on the other side of that stone.' },
      }),
      mk('inscription', 'fd_note', m.p('I'), {
        clue: 'THE DOOR THAT BEGS TO BE OPENED HAS NEVER BEEN A DOOR. THE ONE THAT DOES NOT ASK ONLY LISTENS.',
      }),
    ],
    goal: { kind: 'open', id: 'fd_secret' },
    solution: [E.read('fd_note'), E.listen(pos(4, 3)), E.search(pos(4, 3)), E.push('fd_secret')],
    carelessPath: [E.step(pos(9, 5)), E.open('fd_false')],
  }),
});

const sweating_chamber = defineVault({
  id: 'sweating_chamber',
  name: 'The Sweating Chamber',
  floors: [4, 8],
  lootTier: 'iron',
  trick: 'Stepping on the hidden doorway stone seals a gas chamber; the vent lever is hidden in the antechamber and must be found first.',
  rows: [
    '########V####',
    '######......#',
    '#I#L##......#',
    '#....#......#',
    '.....gt....C#',
    '#....#......#',
    '######......#',
    '######......#',
    '#############',
  ],
  notes: { V: 'vent', I: 'inscription', L: 'hidden vent lever', g: 'door that slams', t: 'hidden trigger stone' },
  build: (m) => ({
    mechanisms: [
      mk('gas_room', 'sw_gas', m.p('V'), {
        tiles: [m.p('t')],
        hidden: true,
        links: ['sw_gate'],
        params: { zone: { tx: 6, ty: 1, w: 6, h: 7 }, totalMs: 25000 },
        clue: 'A square stone in the doorway, worn bright by one step in a hundred. Above, the vents are crusted yellow, and dead flies lie under them like seed.',
      }),
      mk('lever', 'sw_vent', m.p('L'), {
        hidden: true,
        diff: 15,
        links: ['sw_gas'],
        clue: 'A brick cleaner than its neighbours. Behind it a pull-ring on a chain that runs up toward the vents.',
        params: { listenText: 'A faint dry rasp inside the wall, like a chain taking up slack.' },
      }),
      mk('portcullis', 'sw_gate', m.p('g'), { params: { startOpen: true } }),
      mk('inscription', 'sw_note', m.p('I'), {
        clue: 'THE ROOM SWEATS WHEN IT IS FED. FIND THE BRICK THAT IS CLEAN BEFORE YOU FEED IT.',
      }),
    ],
    goal: { kind: 'disarmed', id: 'sw_gas' },
    solution: [
      E.read('sw_note'),
      E.listen(pos(3, 3)),
      E.search(pos(3, 3)),
      E.pull('sw_vent'),
      ...E.walk([pos(1, 4), pos(5, 4), m.p('t'), pos(8, 4), pos(11, 4)]),
    ],
    carelessPath: [E.step(pos(5, 4)), E.step(m.p('t')), ...E.wait(30)],
  }),
});

const narrowing_cell = defineVault({
  id: 'narrowing_cell',
  name: 'The Narrowing Cell',
  floors: [7, 12],
  lootTier: 'golden',
  trick: 'Stepping on the bright stone starts walls closing in; a hidden lever outside stops them, or drive an iron spike into the groove.',
  rows: [
    '############',
    '####.......#',
    '#L##.......#',
    '#..#.......#',
    '...g...t.C.#',
    '#..#.......#',
    '#I##.......#',
    '####.......#',
    '############',
  ],
  notes: { L: 'hidden lever', I: 'inscription', g: 'door that slams', t: 'hidden trigger stone' },
  build: (m) => {
    const t = m.p('t');
    return {
      mechanisms: [
        mk('closing_walls', 'nc_walls', t, {
          hidden: true,
          links: ['nc_gate'],
          params: { zone: { tx: 4, ty: 1, w: 7, h: 7 }, totalMs: 45000, stages: 3, spikesNeeded: 1, saveMod: -2 },
          clue: 'Grooves run in the floor from every wall toward this stone, and the stone is rubbed bright by something dragged across it.',
        }),
        mk('lever', 'nc_lever', m.p('L'), {
          hidden: true,
          diff: 20,
          links: ['nc_walls'],
          clue: 'A lever of ash-black iron, tucked into a gap that looks like a flaw in the stone.',
          params: { listenText: 'Behind the wall, stone grinds on stone in a very slow loop that has been running for years.' },
        }),
        mk('portcullis', 'nc_gate', m.p('g'), { params: { startOpen: true } }),
        mk('inscription', 'nc_note', m.p('I'), {
          clue: 'WHAT CLOSES CAN BE ASKED TO STAY. AN IRON TONGUE HOLDS A STONE MOUTH.',
        }),
      ],
      goal: { kind: 'disarmed', id: 'nc_walls' },
      solution: [
        E.read('nc_note'),
        E.listen(pos(1, 3)),
        E.search(pos(1, 3)),
        E.pull('nc_lever'),
        ...E.walk([m.p('g'), t, pos(9, 4)]),
      ],
      altSolutions: [[E.read('nc_note'), E.step(m.p('g')), E.step(t), E.offer('nc_walls', 'iron_spikes')]],
      carelessPath: [E.step(m.p('g')), E.step(t), ...E.wait(50)],
    };
  },
});

const gilded_bait = defineVault({
  id: 'gilded_bait',
  name: 'The Gilded Bait',
  floors: [5, 12],
  lootTier: 'golden',
  trick: 'The golden idol is a trap that petrifies; the real chest is behind the one wall that has no scorch on it, and that wall is paint.',
  rows: [
    '####I######',
    '#.......###',
    '#.......###',
    '#..z....###',
    '....i...wC#',
    '#....y..###',
    '#.......###',
    '#.......###',
    '###########',
  ],
  notes: { I: 'inscription', z: 'scorch marks', i: 'golden idol', y: 'bones', w: 'painted wall' },
  build: (m) => {
    const wall = m.p('w');
    return {
      mechanisms: [
        mk('lure', 'bt_idol', m.p('i'), {
          params: { save: 'petrify', saveMod: -2, cause: "the idol's embrace" },
          clue: 'It grins with too many teeth, and the light slides off its lips as if they were greased.',
        }),
        mk('illusory_wall', 'bt_wall', wall, {
          clue: 'The pole goes through the east wall like a hand through smoke. Behind the paint is a short passage and a plain chest.',
        }),
        mk('inscription', 'bt_note', m.p('I'), {
          clue: 'THE MOUTH IS GOLD. THE PRIZE IS LEAD. NOBODY EVER ASKED THE EAST WALL ITS OPINION.',
        }),
        mk('inscription', 'bt_scorch', m.p('z'), {
          params: { look: 'scorch' },
          clue: 'Scorch rings the pedestal and the floor is polished by knees. There is not one mark on the east wall.',
        }),
        mk('inscription', 'bt_bones', m.p('y'), {
          params: { look: 'bones' },
          clue: 'A hand, bones only, still wearing a ring, reaching toward the pedestal across the dust.',
        }),
      ],
      goal: { kind: 'revealed', id: 'bt_wall' },
      solution: [E.read('bt_note'), E.read('bt_scorch'), E.read('bt_bones'), E.probe(wall), ...E.walk([pos(7, 4), wall, pos(9, 4)])],
      carelessPath: [E.touch('bt_idol')],
    };
  },
});

const warm_mouth = defineVault({
  id: 'warm_mouth',
  name: 'The Warm Mouth',
  floors: [6, 12],
  lootTier: 'golden',
  trick: 'A carved face tells the truth only while the brazier lever has been pulled; cold, it lies, and the wrong lever drops the ceiling.',
  rows: [
    '#B##X#F#Y#R##',
    '#........####',
    '#........####',
    '#........####',
    '.........g.C#',
    '#........####',
    '#........####',
    '#........####',
    '####I########',
  ],
  notes: { B: 'brazier lever', X: 'left lever', F: 'carved face', Y: 'right lever', R: 'ceiling trap', I: 'inscription', g: 'portcullis' },
  build: (m) => ({
    mechanisms: [
      mk('lever', 'lm_brazier', m.p('B'), {
        params: { setsFlag: 'lm_warm' },
        clue: 'A lever with a flame cut into its plate. Behind the wall you can hear a draught being let into a flue.',
      }),
      mk('lever', 'lm_left', m.p('X'), {
        params: { fires: ['lm_roof'] },
        clue: 'Cold iron. A little pale powder lies on the floor beneath it.',
      }),
      mk('talking_face', 'lm_face', m.p('F'), {
        params: {
          truthFlag: 'lm_warm',
          trueText: 'The right lever opens the way. The left lever lets the roof fall.',
          falseText: 'The left lever opens the way. The right lever lets the roof fall.',
        },
      }),
      mk('lever', 'lm_right', m.p('Y'), { links: ['lm_gate'], clue: 'Cold iron. The floor beneath is swept clean.' }),
      mk('dart_wall', 'lm_roof', m.p('R'), {
        hidden: true,
        params: { zone: { tx: 1, ty: 1, w: 8, h: 7 }, dice: [4, 6], ammo: 1, save: 'breath', saveHalves: true, cause: 'the falling ceiling' },
        clue: 'Slabs in the ceiling above the left lever sit in grooves, and fine pale dust has sifted from the joints.',
      }),
      mk('portcullis', 'lm_gate', m.p('g')),
      mk('inscription', 'lm_note', m.p('I'), {
        clue: 'THE MOUTH SPEAKS TRUE ONLY WHILE THE COALS ARE LIT. COLD, IT LIES, AND LIES WELL.',
      }),
    ],
    goal: { kind: 'open', id: 'lm_gate' },
    solution: [E.read('lm_note'), E.pull('lm_brazier'), E.touch('lm_face'), E.pull('lm_right')],
    carelessPath: [E.touch('lm_face'), E.step(pos(4, 3)), E.pull('lm_left')],
  }),
});

const thirsty_saint = defineVault({
  id: 'thirsty_saint',
  name: 'The Thirsty Saint',
  floors: [4, 9],
  lootTier: 'iron',
  trick: 'A stone saint with a dry bowl wants something blessed; anything else curses the giver.',
  rows: [
    '###I#######',
    '#.....#...#',
    '#..s..#...#',
    '......g..C#',
    '#.....#...#',
    '#.....#...#',
    '###########',
  ],
  notes: { I: 'inscription', s: 'stone saint', g: 'portcullis' },
  build: (m) => ({
    mechanisms: [
      mk('statue_offering', 'ts_saint', m.p('s'), {
        params: { wants: 'holy_water' },
        links: ['ts_gate'],
        clue: 'A saint with her mouth open and her stone bowl held out. The bowl is dry, with a clear salt ring where something once dried. Her plinth is scratched: SHE NEVER BLESSED A THIEF.',
      }),
      mk('portcullis', 'ts_gate', m.p('g')),
      mk('inscription', 'ts_note', m.p('I'), {
        clue: 'SHE BLESSES WHAT WAS BLESSED. GOLD SHE HAS NEVER ACCEPTED, AND SHE HAS A LONG MEMORY FOR THOSE WHO OFFERED IT.',
      }),
    ],
    goal: { kind: 'open', id: 'ts_gate' },
    solution: [E.read('ts_note'), E.read('ts_saint'), E.offer('ts_saint', 'holy_water')],
    carelessPath: [E.offer('ts_saint', 'gem')],
  }),
});

const door_that_asks = defineVault({
  id: 'door_that_asks',
  name: 'The Door That Asks',
  floors: [2, 6],
  lootTier: 'wooden',
  trick: 'The only way on is a door that wants a spoken answer; three wrong words and it answers back.',
  rows: [
    '##I######',
    '#....#..#',
    '#....#..#',
    '.....d.C#',
    '#....#..#',
    '#....#..#',
    '#########',
  ],
  notes: { I: 'inscription', d: 'riddle door' },
  build: (m) => ({
    mechanisms: [
      mk('riddle_door', 'rd_door', m.p('d'), {
        params: { answers: ['ash', 'ashes', 'wood ash', 'hearth ash', 'the ashes of the fire'], strikes: 3, dice: [2, 6], save: 'spells', cause: "the door's answer" },
        clue: "Cut over the lintel: ONCE I WAS A BANQUET'S FIRE AND A PAUPER'S WARMTH. NOW I WEIGH LESS THAN THE COAL THAT MADE ME. SCATTER ME ON THE ICE AND THE CARTER BLESSES YOU. SCATTER ME ON THE GRAVE AND THE PRIEST DOES.",
      }),
      mk('inscription', 'rd_note', m.p('I'), {
        clue: 'THE DOOR WANTS A WORD, NOT A SHOULDER. IT HAS BROKEN BETTER SHOULDERS THAN YOURS.',
      }),
    ],
    goal: { kind: 'open', id: 'rd_door' },
    solution: [E.read('rd_note'), E.read('rd_door'), E.answer('rd_door', 'The ashes.')],
    carelessPath: [E.answer('rd_door', 'open'), E.answer('rd_door', 'let me in'), E.answer('rd_door', 'a key')],
  }),
});

const wardens_cell = defineVault({
  id: 'wardens_cell',
  name: "The Warden's Cell",
  floors: [2, 5],
  lootTier: 'wooden',
  trick: 'The door is needle-trapped; the key hides behind a hidden brick lever, or a thief can pick it with care.',
  rows: [
    '##L########',
    '#.....#...#',
    '#.....#...#',
    '......k..C#',
    '#.....#...#',
    '#.....#...#',
    '###I#######',
  ],
  notes: { L: 'hidden lever', k: 'locked door', I: 'inscription' },
  build: (m) => ({
    mechanisms: [
      mk('lever', 'wc_lever', m.p('L'), {
        hidden: true,
        diff: 10,
        params: { grant: 'iron_key', spawnAt: pos(2, 1), listenText: 'A soft metal tick behind the north wall, like a drawer sticking.' },
        clue: 'A brick worn smooth round its edge where a thumb has worked it for years. Behind it a hook, and a drawer-chain.',
      }),
      mk('locked_door', 'wc_door', m.p('k'), {
        params: { keyItem: 'iron_key', needle: true, lockDiff: 10 },
        diff: 10,
        clue: 'A pinprick beside the keyhole, rimmed green. Someone made the lock a little hungry.',
      }),
      mk('inscription', 'wc_note', m.p('I'), {
        clue: 'THE WARDEN KEPT HIS KEY WHERE A LAZY MAN WOULD: BEHIND THE BRICK PULLED TOO OFTEN.',
      }),
    ],
    goal: { kind: 'open', id: 'wc_door' },
    solution: [
      E.read('wc_note'),
      E.search(pos(2, 1)),
      E.pull('wc_lever'),
      E.step(pos(5, 3)),
      E.open('wc_door', 'iron_key'),
    ],
    altSolutions: [[E.step(pos(5, 3)), E.pick('wc_door', 1, 50)]],
    carelessPath: [E.step(pos(5, 3)), E.open('wc_door')],
  }),
});

const returns_corridor = defineVault({
  id: 'returns_corridor',
  name: 'The Corridor of Returns',
  floors: [5, 10],
  lootTier: 'iron',
  trick: 'Hidden floor pads send you back to the start or into a cell; the south lane is the only clean road.',
  rows: [
    '###############',
    '#...........###',
    '...........pgC#',
    '#...z.......###',
    '##h####I#######',
    '#...###########',
    'L...###########',
    '#...###########',
    '###############',
  ],
  notes: { z: 'worn lane', p: 'pressure plate', g: 'portcullis', h: 'cell hatch', I: 'inscription', L: 'cell lever' },
  build: (m) => {
    const start = pos(1, 2);
    const pads = [
      { id: 'rt_pad1', at: pos(5, 1), loop: true },
      { id: 'rt_pad2', at: pos(4, 2), loop: false },
      { id: 'rt_pad3', at: pos(8, 2), loop: true },
      { id: 'rt_pad4', at: pos(9, 1), loop: true },
    ];
    return {
      mechanisms: [
        ...pads.map((p) =>
          mk('teleporter', p.id, p.at, {
            hidden: true,
            diff: 5,
            params: p.loop
              ? { dest: start }
              : { dest: pos(2, 5), spawn: 'skeleton', spawnAt: pos(3, 7) },
            clue: 'A seam in the floor square: the stone beneath is a pad that blinks when weighted.',
          }),
        ),
        mk('pressure_plate', 'rt_plate', m.p('p'), { links: ['rt_gate'] }),
        mk('portcullis', 'rt_gate', m.p('g')),
        mk('portcullis', 'rt_hatch', m.p('h')),
        mk('lever', 'rt_lever', m.p('L'), { links: ['rt_hatch'] }),
        mk('inscription', 'rt_note', m.p('I'), {
          clue: 'ONLY THE LOWEST ROAD IS SURE. THE UPPER ROADS ARE THE SAME ROAD, WALKED AGAIN.',
        }),
        mk('inscription', 'rt_lane', m.p('z'), {
          params: { look: 'stain' },
          clue: 'The dust is scuffed in a single lane along the south edge of the hall. Everywhere else it lies as smooth as an unslept bed.',
        }),
      ],
      goal: { kind: 'open', id: 'rt_gate' },
      solution: [
        E.read('rt_note'),
        E.read('rt_lane'),
        E.probe(pos(4, 2)),
        E.probe(pos(5, 1)),
        ...E.walk(Array.from({ length: 11 }, (_, i) => pos(1 + i, 3))),
        E.step(m.p('p')),
      ],
      carelessPath: [E.step(pos(4, 2))],
    };
  },
});

const scorched_gallery = defineVault({
  id: 'scorched_gallery',
  name: 'The Gallery of Scorch',
  floors: [1, 4],
  lootTier: 'wooden',
  trick: 'A tripwire fires a poisoned dart volley once: snag it with the ten-foot pole from a distance, then walk freely.',
  rows: [
    '#####D###L###',
    '#.........###',
    '#.........###',
    '......z...gC#',
    '#.........###',
    '#.........###',
    '#############',
  ],
  notes: { D: 'dart hole', L: 'brass lever', z: 'scorch marks', g: 'portcullis' },
  build: (m) => {
    const wire = [1, 2, 3, 4, 5].map((y) => pos(5, y));
    return {
      mechanisms: [
        mk('dart_wall', 'sg_darts', m.p('D'), {
          tiles: wire,
          params: { tripwire: true, ammo: 1, zone: { tx: 3, ty: 1, w: 5, h: 5 }, dice: [1, 6], poison: true, cause: 'poisoned darts' },
          clue: 'The pole snags a wire stretched ankle-high. Darts hiss across the hall and splinter on the far wall. You were standing well back.',
        }),
        mk('lever', 'sg_lever', m.p('L'), { links: ['sg_gate'] }),
        mk('portcullis', 'sg_gate', m.p('g')),
        mk('inscription', 'sg_scorch', m.p('z'), {
          params: { look: 'scorch' },
          clue: 'Black streaks fan from a hole in the north wall across the whole width of the hall, and in the cracks at the foot of the wall lie small bronze darts with green tips.',
        }),
      ],
      goal: { kind: 'open', id: 'sg_gate' },
      solution: [E.read('sg_scorch'), E.probe(pos(5, 3)), ...E.walk([pos(4, 3), pos(5, 3), pos(6, 3), pos(8, 3)]), E.pull('sg_lever')],
      carelessPath: [E.step(pos(4, 3)), E.step(pos(5, 3))],
    };
  },
});

const honest_wall = defineVault({
  id: 'honest_wall',
  name: 'The Honest Wall',
  floors: [4, 9],
  lootTier: 'iron',
  trick: 'The floor is a field of hidden spiked pits except the row against the north wall; an inscription says which stones are honest.',
  rows: [
    '#####I#########',
    '...........pgC#',
    '#...........###',
    '#...........###',
    '#...........###',
    '#...........###',
    '#...........###',
    '#...........###',
    '###############',
  ],
  notes: { I: 'inscription', p: 'pressure plate', g: 'portcullis' },
  build: (m) => {
    const holes = [pos(4, 2), pos(7, 2), pos(3, 3), pos(6, 3), pos(9, 3), pos(5, 4), pos(8, 4), pos(10, 4), pos(4, 5), pos(7, 5), pos(9, 6), pos(5, 6)];
    return {
      mechanisms: [
        ...holes.map((h, i) =>
          mk('spiked_pit', `pf_pit${i}`, h, {
            hidden: true,
            diff: 5,
            params: { dice: [3, 6], cause: 'iron spikes at the bottom of a pit' },
            clue: 'The pole drops through the floor into iron teeth: a pit set with spikes.',
          }),
        ),
        mk('pressure_plate', 'pf_plate', m.p('p'), { links: ['pf_gate'] }),
        mk('portcullis', 'pf_gate', m.p('g')),
        mk('inscription', 'pf_note', m.p('I'), {
          clue: 'THE NORTH WALL HOLDS THE LAMPS. ONLY THE STONES THAT TOUCH THE LAMP-WALL ARE HONEST.',
        }),
      ],
      goal: { kind: 'open', id: 'pf_gate' },
      solution: [E.read('pf_note'), ...E.walk(Array.from({ length: 10 }, (_, i) => pos(1 + i, 1))), E.step(m.p('p'))],
      carelessPath: [E.step(pos(3, 1)), E.step(pos(4, 2))],
    };
  },
});

export const VAULTS: VaultDef[] = [
  loose_flag, two_levers, weighing_hall, scorched_gallery, door_that_asks, wardens_cell,
  rune_ring, false_and_true, thirsty_saint, sweating_chamber, honest_wall,
  returns_corridor, gilded_bait, warm_mouth, narrowing_cell,
];

export const VAULT_BY_ID: Record<string, VaultDef> = Object.fromEntries(VAULTS.map((v) => [v.id, v]));

export function vaultsForFloor(floor: number): VaultDef[] {
  return VAULTS.filter((v) => floor >= v.minFloor && floor <= v.maxFloor);
}
