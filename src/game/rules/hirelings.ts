/**
 * Hirelings: the torchbearer and the man-at-arms. Stat blocks, what they cost, the third of the gold the
 * man-at-arms keeps, and morale. Pure TS (no Phaser); every roll takes an `Rng`.
 *
 * A hireling is saved as a small `HirelingState` on the character (`PlayerStats.party`). At most one of each kind.
 */
import { roll, type Rng } from './dice';

export type HirelingKind = 'torchbearer' | 'man_at_arms';
export const HIRELING_KINDS: readonly HirelingKind[] = ['torchbearer', 'man_at_arms'];

/** What a failed morale check does to him. */
export type MoraleFailure = 'lost' | 'flees';

export interface HirelingDef {
  kind: HirelingKind;
  /** "Torchbearer", for panels. */
  title: string;
  blurb: string;
  textureKey: string;
  /** Gold paid up front at the inn. */
  upfrontGp: number;
  /** Does he share the gold you find? (He keeps `GOLD_SHARE_DIVISOR`ths of it.) */
  keepsShare: boolean;
  /** Hit points: a fixed number, or a die to roll (`hpDie`). */
  hpFixed?: number;
  hpDie?: number;
  /** Descending armor class. */
  ac: number;
  thac0: number;
  /** Spear and the like: damage die. Absent for a hireling who does not fight. */
  damage?: { count: number; sides: number };
  /** Swing cooldown in ms (real-time play on top of the dice). */
  swingMs?: number;
  /** Morale target: 2d6 above this and he breaks. */
  morale: number;
  onMoraleFail: MoraleFailure;
  /** Light radius in tiles he adds while he lives (a lit torch's). */
  lightRadius: number;
  fights: boolean;
}

/** Radius of a lit torch in tiles (matches `getDef('torch').light.radius`; a test keeps them equal). */
export const TORCH_RADIUS = 4;
/** The man-at-arms keeps one third of gold found. */
export const GOLD_SHARE_DIVISOR = 3;
/** Roll 2d6; above the morale number he breaks. */
export const MORALE_DICE: readonly [number, number] = [2, 6];
/** How long a man-at-arms who breaks stays away from the fight before he comes back. */
export const FLEE_MS = 10000;

export const HIRELINGS: Record<HirelingKind, HirelingDef> = {
  torchbearer: {
    kind: 'torchbearer',
    title: 'Torchbearer',
    blurb: 'Carries the light, so your off hand can hold a shield. Does not fight. Runs if hurt and frightened.',
    textureKey: 'hireling_torchbearer',
    upfrontGp: 5,
    keepsShare: false,
    hpFixed: 3,
    ac: 10,
    thac0: 20,
    morale: 6,
    onMoraleFail: 'lost',
    lightRadius: TORCH_RADIUS,
    fights: false,
  },
  man_at_arms: {
    kind: 'man_at_arms',
    title: 'Man-at-arms',
    blurb: 'Fights beside you with a spear. Wants a third of the gold you find. Can break and run.',
    textureKey: 'hireling_man_at_arms',
    upfrontGp: 20,
    keepsShare: true,
    hpDie: 8,
    ac: 6,
    thac0: 20,
    damage: { count: 1, sides: 6 },
    swingMs: 1000,
    morale: 7,
    onMoraleFail: 'flees',
    lightRadius: 0,
    fights: true,
  },
};

export interface HirelingState {
  /** Stable id inside the party ("torchbearer" or "man_at_arms": there is at most one of each). */
  id: string;
  kind: HirelingKind;
  /** Full name: "Odo the linkboy". */
  name: string;
  hp: number;
  maxHp: number;
  /** The "first hurt" morale check has been taken (once, ever). */
  hurtChecked?: boolean;
}

// ── Names ───────────────────────────────────────────────────────────────────

const NAMES: Record<HirelingKind, readonly string[]> = {
  torchbearer: [
    'Odo the linkboy', 'Wim the wick', 'Pib the lamp-lad', 'Tamsin Candlewick', 'Hob the ember',
    'Nell the linkgirl', 'Fenn Tallowhand', 'Joss the glim',
  ],
  man_at_arms: [
    'Garrick the steady', 'Brannoc Ironshin', 'Dunstan Dullblade', 'Ysolt Greyspear',
    'Rurik the tall', 'Maud Ashcroft', 'Corwin Haybarn', 'Tilda Fourpenny',
  ],
};

/** "Odo the linkboy" gives "Odo". Used for the small label above the sprite. */
export function firstName(name: string): string {
  return name.split(/\s+/)[0] ?? name;
}

export function namesFor(kind: HirelingKind): readonly string[] {
  return NAMES[kind];
}

/** A name from the list, avoiding ones in `taken` when any are left. */
export function pickName(kind: HirelingKind, rng: Rng, taken: readonly string[] = []): string {
  const pool = NAMES[kind].filter((n) => !taken.includes(n));
  const list = pool.length > 0 ? pool : NAMES[kind];
  return list[Math.min(list.length - 1, Math.floor(rng.next() * list.length))];
}

// ── Hiring ──────────────────────────────────────────────────────────────────

export function hireCost(kind: HirelingKind): number {
  return HIRELINGS[kind].upfrontGp;
}

/** Roll a new hireling. The torchbearer has 3 hit points; the man-at-arms rolls a d8. */
export function makeHireling(kind: HirelingKind, rng: Rng, taken: readonly string[] = []): HirelingState {
  const def = HIRELINGS[kind];
  const maxHp = def.hpFixed ?? roll(rng, 1, def.hpDie ?? 4);
  return { id: kind, kind, name: pickName(kind, rng, taken), hp: maxHp, maxHp };
}

export type HireRefusal = 'have_one' | 'poor';

export interface HireCheck {
  ok: boolean;
  reason?: HireRefusal;
  /** A line for the status or panel. */
  message: string;
}

export function hasKind(party: readonly HirelingState[] | undefined, kind: HirelingKind): boolean {
  return !!party?.some((h) => h.kind === kind && h.hp > 0);
}

export function canHire(party: readonly HirelingState[] | undefined, kind: HirelingKind, gold: number): HireCheck {
  const def = HIRELINGS[kind];
  if (hasKind(party, kind)) {
    return { ok: false, reason: 'have_one', message: `You already have a ${def.title.toLowerCase()}.` };
  }
  if (gold < def.upfrontGp) {
    return { ok: false, reason: 'poor', message: `A ${def.title.toLowerCase()} wants ${def.upfrontGp} gp up front.` };
  }
  return { ok: true, message: '' };
}

// ── Gold ────────────────────────────────────────────────────────────────────

export interface GoldSplit {
  /** What the hireling keeps (a third, rounded down). */
  share: number;
  /** What the player gets. */
  yours: number;
  /** Who took the share, if anyone. */
  by?: HirelingState;
}

/** Split gold found between the player and a living man-at-arms. No such man, no split. */
export function splitGold(party: readonly HirelingState[] | undefined, amount: number): GoldSplit {
  const whole = Math.max(0, Math.floor(amount));
  const taker = party?.find((h) => HIRELINGS[h.kind].keepsShare && h.hp > 0);
  if (!taker || whole <= 0) return { share: 0, yours: whole };
  const share = Math.floor(whole / GOLD_SHARE_DIVISOR);
  if (share <= 0) return { share: 0, yours: whole };
  return { share, yours: whole - share, by: taker };
}

// ── Light ───────────────────────────────────────────────────────────────────

/** Light radius in tiles a living hireling adds (the torchbearer's lit torch), else 0. */
export function hirelingLightRadius(party: readonly HirelingState[] | undefined): number {
  let r = 0;
  for (const h of party ?? []) if (h.hp > 0) r = Math.max(r, HIRELINGS[h.kind].lightRadius);
  return r;
}

// ── Morale ──────────────────────────────────────────────────────────────────

export type MoraleEvent = 'hurt' | 'player_low';

/** Fraction of hit points below which a man-at-arms is "under half". */
export const HURT_FRACTION = 0.5;
/** Fraction of the player's hit points below which a man-at-arms looks to his nerve. */
export const PLAYER_LOW_FRACTION = 0.25;

/** Is the player "under a quarter" of his hit points? */
export function playerIsLow(hp: number, maxHp: number): boolean {
  return maxHp > 0 && hp > 0 && hp < maxHp * PLAYER_LOW_FRACTION;
}

/**
 * Should this hireling check morale now, because of `event`?
 * - 'hurt': the first time he is hurt at all if he does not fight (the torchbearer), or the first time he is
 *   under half his hit points if he does (the man-at-arms). Only once.
 * - 'player_low': when the player drops under a quarter, for a hireling who fights. The caller fires it once
 *   per drop, so it can come again after the player recovers and falls again.
 */
export function shouldCheckMorale(state: HirelingState, event: MoraleEvent): boolean {
  if (state.hp <= 0) return false;
  const def = HIRELINGS[state.kind];
  if (event === 'hurt') {
    if (state.hurtChecked) return false;
    return def.fights ? state.hp < state.maxHp * HURT_FRACTION : state.hp < state.maxHp;
  }
  return def.fights;
}

export interface MoraleResult {
  /** The 2d6 as rolled. */
  rolled: number;
  target: number;
  passed: boolean;
  failure?: MoraleFailure;
}

/** 2d6 against the morale number: above it and he breaks. Equal or under holds. */
export function moraleCheck(kind: HirelingKind, rng: Rng): MoraleResult {
  const def = HIRELINGS[kind];
  const rolled = roll(rng, MORALE_DICE[0], MORALE_DICE[1]);
  const passed = rolled <= def.morale;
  return { rolled, target: def.morale, passed, failure: passed ? undefined : def.onMoraleFail };
}

// ── Damage, healing, saving ─────────────────────────────────────────────────

/** Take damage. Returns true when it kills him. Never below 0. */
export function hurtHireling(state: HirelingState, damage: number): boolean {
  state.hp = Math.max(0, state.hp - Math.max(0, Math.round(damage)));
  return state.hp <= 0;
}

/** A night at the inn: a room mends all, the common room mends half the missing points (at least 1 if hurt). */
export function restParty(party: HirelingState[] | undefined, kind: 'room' | 'common'): number {
  let healed = 0;
  for (const h of party ?? []) {
    if (h.hp <= 0 || h.hp >= h.maxHp) continue;
    const missing = h.maxHp - h.hp;
    const back = kind === 'room' ? missing : Math.max(1, Math.floor(missing / 2));
    h.hp = Math.min(h.maxHp, h.hp + back);
    healed += back;
  }
  return healed;
}

/**
 * Make a party out of whatever a save held. Unknown kinds, dead men, duplicates and junk numbers are dropped, so an
 * old save (no `party`) or a damaged one still loads.
 */
export function sanitizeParty(raw: unknown): HirelingState[] {
  if (!Array.isArray(raw)) return [];
  const out: HirelingState[] = [];
  for (const r of raw as Array<Partial<HirelingState> | null | undefined>) {
    if (!r || typeof r !== 'object') continue;
    const kind = r.kind;
    if (kind !== 'torchbearer' && kind !== 'man_at_arms') continue;
    if (out.some((h) => h.kind === kind)) continue;
    const maxHp = Number.isFinite(r.maxHp) && (r.maxHp as number) >= 1 ? Math.round(r.maxHp as number) : 1;
    const hp = Number.isFinite(r.hp) ? Math.round(r.hp as number) : maxHp;
    if (hp <= 0) continue;
    out.push({
      id: kind,
      kind,
      name: typeof r.name === 'string' && r.name ? r.name.slice(0, 40) : NAMES[kind][0],
      hp: Math.min(maxHp, hp),
      maxHp,
      hurtChecked: !!r.hurtChecked,
    });
  }
  return out;
}
