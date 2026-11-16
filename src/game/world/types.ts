// Tomb engine types. Pure TypeScript: no Phaser, no ambient randomness.
// `SaveCategory` and `Rng` are structurally identical to the ones A1 publishes in src/game/rules.

export type SaveCategory = 'death' | 'petrify' | 'wands' | 'breath' | 'spells';

/** Float in [0, 1). */
export interface Rng {
  next(): number;
}

export interface Pos {
  tx: number;
  ty: number;
}

export interface Rect {
  tx: number;
  ty: number;
  w: number;
  h: number;
}

// ── Events in, effects out (binding contract from docs/OVERHAUL.md) ──────────

export type MechVerb = 'pull' | 'push' | 'touch' | 'read' | 'open' | 'offer';

export type MechEvent =
  | { type: 'step'; tx: number; ty: number; weight: 'player' | 'item' | 'monster' }
  | { type: 'leave'; tx: number; ty: number }
  /** roll/chance are only used by a thief picking a lock: verb 'open', no itemKey, success when roll <= chance - lockDiff. */
  | { type: 'interact'; id: string; verb: MechVerb; itemKey?: string; roll?: number; chance?: number }
  | { type: 'probe'; tx: number; ty: number }
  | { type: 'search'; tx: number; ty: number; roll: number; chance: number }
  | { type: 'listen'; tx: number; ty: number; roll: number; chance: number }
  | { type: 'answer'; id: string; text: string }
  | { type: 'tick'; dtMs: number };

export type MechEffect =
  | { type: 'message'; text: string; tone: 'clue' | 'danger' | 'info' }
  | {
      type: 'damage';
      dice: [count: number, sides: number];
      bonus?: number;
      save?: SaveCategory;
      saveHalves?: boolean;
      cause: string;
    }
  | { type: 'save_or_die'; save: SaveCategory; modifier?: number; cause: string }
  | { type: 'status'; key: string; durationMs: number; save?: SaveCategory }
  | { type: 'set_tile'; tx: number; ty: number; tile: number }
  | { type: 'reveal'; id: string }
  | { type: 'spawn'; monster: string; tx: number; ty: number }
  | { type: 'teleport'; tx: number; ty: number }
  | { type: 'fall'; floors: number; dice: [number, number] }
  | { type: 'grant'; itemKey: string; tx: number; ty: number }
  | { type: 'sfx'; key: string }
  | { type: 'shake'; ms: number }
  // Addition: the scene removes one of this item from the pack (key seated, spike driven, offering made).
  | { type: 'consume'; itemKey: string };

// ── Static definition ────────────────────────────────────────────────────────

export type MechKind =
  | 'covered_pit'
  | 'spiked_pit'
  | 'dart_wall'
  | 'pressure_plate'
  | 'lever'
  | 'portcullis'
  | 'sliding_wall'
  | 'closing_walls'
  | 'gas_room'
  | 'false_door'
  | 'illusory_wall'
  | 'one_way_door'
  | 'teleporter'
  | 'rune_floor'
  | 'riddle_door'
  | 'statue_offering'
  | 'lure'
  | 'talking_face'
  | 'inscription'
  | 'locked_door'
  | 'secret_door';

export const ALL_KINDS: MechKind[] = [
  'covered_pit', 'spiked_pit', 'dart_wall', 'pressure_plate', 'lever', 'portcullis', 'sliding_wall',
  'closing_walls', 'gas_room', 'false_door', 'illusory_wall', 'one_way_door', 'teleporter', 'rune_floor',
  'riddle_door', 'statue_offering', 'lure', 'talking_face', 'inscription', 'locked_door', 'secret_door',
];

/** One flat parameter bag; each kind reads the fields it documents in mechanisms.ts. */
export interface MechParams {
  // hazards
  dice?: [number, number];
  bonus?: number;
  save?: SaveCategory;
  saveHalves?: boolean;
  saveMod?: number;
  cause?: string;
  lethal?: boolean;
  poison?: boolean;
  floors?: number;
  // areas and positions (all tile coordinates; translated when a vault is stamped)
  zone?: Rect;
  dest?: Pos;
  trigger?: Pos;
  door?: Pos;
  spawnAt?: Pos;
  // dart wall
  ammo?: number;
  tripwire?: boolean;
  // timed rooms
  totalMs?: number;
  stages?: number;
  spikesNeeded?: number;
  // plates
  momentary?: boolean;
  /** Portcullis that starts raised (so a trap can drop it behind the player). */
  startOpen?: boolean;
  minWeight?: 'item' | 'player';
  // link behaviour
  fires?: string[];
  unless?: string;
  setsFlag?: string;
  // rune floor
  order?: number[];
  glyphs?: string[];
  punish?: 'bolt' | 'spawn' | 'fall';
  // riddle door
  answers?: string[];
  strikes?: number;
  // statue
  wants?: string;
  // talking face
  truthFlag?: string;
  trueText?: string;
  falseText?: string;
  // locked door
  keyItem?: string;
  seats?: string[];
  lockDiff?: number;
  needle?: boolean;
  unpickable?: boolean;
  // false door
  springs?: 'darts' | 'fall' | 'spawn';
  // generic
  grant?: string;
  spawn?: string;
  about?: string;
  look?: 'inscription' | 'stain' | 'scorch' | 'bones';
  listenText?: string;
  listenDiff?: number;
  once?: boolean;
}

export interface MechanismSpec {
  id: string;
  kind: MechKind;
  tx: number;
  ty: number;
  /** Extra footprint tiles (rune tiles, tripwire tiles, wall segments, trigger stones). */
  tiles?: Pos[];
  params: MechParams;
  /** Ids of other mechanisms this one acts on (doors a lever opens, the dart wall a plate fires...). */
  links: string[];
  hidden: boolean;
  clue?: string;
  /** Subtracted from the searcher's chance. */
  searchDifficulty: number;
}

// ── Dynamic state (JSON-serializable) ────────────────────────────────────────

export interface MechRuntime {
  id: string;
  revealed: boolean;
  /** Open door, pulled lever, pressed plate, sprung pit, running trap, solved puzzle (see mechanisms.ts per kind). */
  on: boolean;
  /** Used up or disarmed. */
  spent: boolean;
  timerMs: number;
  progress: number;
  /** Things standing on a plate. */
  held: number;
  /** Volleys fired, wrong answers, failed picks. */
  count: number;
  seated: string[];
  stage: number;
}

export interface MechState {
  specs: MechanismSpec[];
  rt: Record<string, MechRuntime>;
  flags: Record<string, boolean>;
  clockMs: number;
  /** Last tile the player stepped on or was teleported to (the engine never sees movement otherwise). */
  playerAt: Pos | null;
  /** Latest set_tile written per "tx,ty": lets a loaded game repaint the map. */
  tileLog: Record<string, number>;
}

export interface MechView {
  id: string;
  textureKey: string;
  blocks: boolean;
  visible: boolean;
  tx: number;
  ty: number;
}

// ── Vaults ───────────────────────────────────────────────────────────────────

export interface LegendEntry {
  tile: 'wall' | 'floor';
  note: string;
  chest?: boolean;
  spawn?: string;
}

export interface Entrance {
  x: number;
  y: number;
  /** Side of the vault the opening is on; the stamper digs outward from here. */
  dir: 'N' | 'S' | 'E' | 'W';
}

export type VaultGoal =
  | { kind: 'open'; id: string }
  | { kind: 'disarmed'; id: string }
  | { kind: 'revealed'; id: string };

export interface VaultDef {
  id: string;
  name: string;
  minFloor: number;
  maxFloor: number;
  width: number;
  height: number;
  rows: string[];
  legend: Record<string, LegendEntry>;
  mechanisms: MechanismSpec[];
  entrances: Entrance[];
  clues: string[];
  lootTier: 'wooden' | 'iron' | 'golden';
  chests: Pos[];
  spawns: { tx: number; ty: number; monster: string }[];
  goal: VaultGoal;
  /** Intended safe sequence, vault-local coordinates. */
  solution: MechEvent[];
  /** Other intended safe sequences (optional). */
  altSolutions?: MechEvent[][];
  /** What a careless player does; must fire a harmful effect. */
  carelessPath: MechEvent[];
  /** One line describing the trick. */
  trick: string;
}

export interface InscriptionSpawn {
  tx: number;
  ty: number;
  text: string;
  look: 'inscription' | 'stain' | 'scorch' | 'bones';
  id: string;
}
