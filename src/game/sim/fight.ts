/**
 * One character against a group of monsters, in melee, in 50 ms steps. Headless and pure (no Phaser).
 *
 * Every dice rule is the game's own function (`resolvePlayerAttack`, `resolveMonsterRound`, `playerArmorClass`,
 * `playerSave`, `moraleCheck`, `turnUndead`, `applyDrain`, the spell definitions, the bestiary). What the sim adds is
 * the real-time layer around them, kept as close to `CombatController` / `Enemy` / `Player` as a headless model can:
 * swing cooldown, the hit-grace window, approach and contact, surprise, reaction, morale flights, poison, paralysis,
 * drain, cleave, skeleton reform. Where a rule lives inside a Phaser-importing file it is re-expressed here, with a
 * comment naming the source, so the places drift can come from are easy to find.
 *
 * The player is a policy, not a person: it swings at the nearest monster in reach, drinks a potion at 45% hit points
 * (1.2 s apart), and casts spells by the simple rules in `wizardCast` / `clericCast`.
 */
import { monsterPressure } from '../rules/pressure';
import type { ClassKey } from '../constants';
import { PLAYER_STATS } from '../constants';
import {
  RANGE_PX, WIZARD_DART, canHarm, charismaReaction, damageDice, getSpell, hasSpecial, isTurnable, missileCount,
  attackRoll, damageRoll, monsterSave, roll, rollDice, rollMonsterHp, turnUndead,
  type AbilityScores, type MonsterDef, type MonsterKey, type Rng, type Spellbook,
} from '../rules';
import {
  ALLY_DEATH_RADIUS_PX, MELEE_HOLD_PX, SURPRISE_MS, WARY_PATIENCE_MS, WARY_PROXIMITY_PX, fleeDurationMs,
  KEEP_DISTANCE_MS, isIntelligent, moraleCheck, monsterReaction, neverChecksMorale, retreatOutcome, surpriseRoll,
} from '../rules/encounter';
import type { Inventory } from '../items';
import { equipmentBonuses } from '../items';
import {
  BASE_SWING_MS, HEALING_POTION_BONUS, HEALING_POTION_DICE, PLAYER_HIT_GRACE_MS, applyDrain, ignoresArmor,
  playerArmorClass, playerSave, resolveMonsterRound, resolvePlayerAttack, weaponProfile,
  type PlayerAttackOutcome, type PlayerSheet, type TargetInfo,
} from '../scenes/game/AdndCombat';
import { monsterDef, type SimOverrides } from './overrides';

// ── Numbers ─────────────────────────────────────────────────────────────────

export const STEP_MS = 50;
/** The sim player drinks a healing potion at or below this share of maximum hit points (the user's model, not a game rule). */
export const POTION_AT = 0.45;
export const POTION_COOLDOWN_MS = 1200;
/** Gap between two casts. Source: SpellInputController.ts `CAST_GAP_MS` (a private constant there). */
export const CAST_GAP_MS = 500;
/** Source: CombatController.ts `TURN_COOLDOWN_MS` (private). */
export const TURN_COOLDOWN_MS = 4000;
/** Source: CombatController.doTurnUndead, the 200 px reach and the 10 s flight. */
export const TURN_RANGE_PX = 200;
export const TURN_FLEE_MS = 10_000;
/** Source: Player.addEffect: paralysis cannot be renewed while it lasts or for 6 s after. */
export const HELD_IMMUNE_EXTRA_MS = 6000;
/** Source: CombatController.doCleave `TILE_SIZE * 2`. */
export const CLEAVE_RANGE_PX = 64;
/** Source: CombatController MISSILE_RANGE_PX (private), for a bow or sling. */
export const BOW_RANGE_PX = 224;
export const MELEE_REACH_PX = PLAYER_STATS.ATTACK_RANGE;
export const PLAYER_SPEED_PX = PLAYER_STATS.BASE_SPEED;
/** A fight that runs past this is called stuck. */
export const MAX_FIGHT_MS = 120_000;
/** Ranged monsters stand at this share of their range and shoot. */
const RANGED_HOLD = 0.85;
/** Source: Enemy.tryReform: 45% once, back at half hit points (at least 2). */
const REFORM_CHANCE = 0.45;
const SLEEP_RADIUS_PX = 64;

// ── The character ───────────────────────────────────────────────────────────

export interface Hero {
  classKey: ClassKey;
  level: number;
  scores: AbilityScores;
  inventory: Inventory;
  hp: number;
  maxHp: number;
  /** Maximum hit points lost to drain so far (it comes back with a long rest, which a delve never takes). */
  drained: number;
  /** Healing potions carried: 2d4+2 (the game's number for the basic one) and extra healing 3d8+3. */
  potions: { healing: number; extra: number };
  book: Spellbook | null;
  /** Bless (+1 to hit) and Protection from Evil (AC 2 better), cast before the first fight. */
  blessToHit: number;
  buffAc: number;
  /** Running total, never reset: the delve reads the difference. */
  potionsUsed: number;
}

export function heroSheet(h: Hero): PlayerSheet {
  return {
    classKey: h.classKey, level: h.level, scores: h.scores, inventory: h.inventory,
    blessToHit: h.blessToHit, buffAc: h.buffAc,
  };
}

// ── Fight input and output ──────────────────────────────────────────────────

export interface MobSpec {
  key: MonsterKey;
  elite?: boolean;
}

export interface FightSpec {
  monsters: readonly MobSpec[];
  floor: number;
  overrides?: SimOverrides;
  /** A man-at-arms fights beside the character (boss room test). */
  hireling?: boolean;
  /** Longer than the default 120 s cap (the boss fight). */
  maxMs?: number;
}

export interface HitEvent {
  t: number;
  /** Hit points actually lost (a hit inside the grace window loses none and is not listed). */
  damage: number;
  key: MonsterKey;
  cause: 'hit' | 'spell' | 'poison';
}

export type FightOutcome = 'won' | 'died' | 'stuck';

export interface FightResult {
  outcome: FightOutcome;
  durationMs: number;
  /** Hit points lost in the fight (including poison that ran out after it). */
  damageTaken: number;
  /** Hit points lost to each kind of monster. */
  damageBy: Partial<Record<MonsterKey, number>>;
  potionsUsed: number;
  kills: number;
  hpEnd: number;
  trace?: HitEvent[];
}

type MobState = 'idle' | 'hold' | 'chase' | 'flee' | 'distance' | 'dead';
type MobStatus = 'asleep' | 'held' | 'webbed' | null;

interface Mob {
  idx: number;
  key: MonsterKey;
  def: MonsterDef;
  elite: boolean;
  hp: number;
  maxHp: number;
  /** Distance from the character and bearing, in pixels. */
  d: number;
  th: number;
  speed: number;
  hold: number;
  reach: number;
  ranged: boolean;
  /** Brought to the character by an advance: no longer holds its distance. */
  pinned: boolean;
  state: MobState;
  status: MobStatus;
  statusMs: number;
  attackTimer: number;
  surpriseMs: number;
  engaged: boolean;
  contacted: boolean;
  contactAt: number;
  contactT: number;
  hostile: boolean;
  fleeMs: number;
  fleeKind: 'turn' | 'morale';
  keepMs: number;
  retreats: number;
  halfChecked: boolean;
  reformed: boolean;
  casterTimer: number;
  regenMs: number;
  /** Attack cooldown (a boss phase can shorten it). */
  cd: number;
  /** Called up by a boss: no surprise, no reaction, no morale. */
  summoned: boolean;
  summonTimer: number;
  phaseIdx: number;
}

const px = (m: Mob): number => m.d * Math.cos(m.th);
const py = (m: Mob): number => m.d * Math.sin(m.th);
const between = (a: Mob, b: Mob): number => Math.hypot(px(a) - px(b), py(a) - py(b));

/**
 * Run one fight. Mutates `hero` (hit points, drain, potions, spell slots, corroded gear). Same rng, same hero, same
 * spec: same result.
 */
export function simulateFight(hero: Hero, spec: FightSpec, rng: Rng, opts: { trace?: boolean } = {}): FightResult {
  const ov = spec.overrides;
  const floor = spec.floor;
  const sheet = heroSheet(hero);
  const trace: HitEvent[] | undefined = opts.trace ? [] : undefined;
  const damageBy: Partial<Record<MonsterKey, number>> = {};
  const potionsAtStart = hero.potionsUsed;
  const hpAtStart = hero.hp;
  let kills = 0;

  // ── Armor class, cached until gear changes (acid) ──
  let acDirty = true;
  let acNormal = 10;
  let acIgnore = 10;
  const refreshAc = (): void => {
    if (!acDirty) return;
    acNormal = playerArmorClass(sheet);
    acIgnore = playerArmorClass(sheet, { ignoreArmor: true });
    acDirty = false;
  };
  const eqBonus = equipmentBonuses(hero.inventory);

  // ── Monsters ──
  const hpMult = ov?.hpMult?.(floor) ?? 1;
  // The game's own pressure (rules/pressure.ts), then any proposal on top.
  const press = monsterPressure(floor, hero.level);
  const dmgBonus = press.damage + (ov?.damageBonus?.(floor) ?? 0);
  const hitBonus = press.toHit + (ov?.toHitBonus?.(floor) ?? 0);
  const makeMob = (ms: MobSpec, idx: number, d0: number, summoned: boolean): Mob => {
    const def = monsterDef(ms.key, ov);
    const elite = !!ms.elite;
    // Source: Enemy constructor: hit points x1.5 for an elite, speed x1.08.
    const maxHp = Math.max(1, Math.ceil(rollMonsterHp(def, rng) * (elite ? 1.5 : 1) * hpMult));
    const ranged = !!hasSpecial(def, 'ranged');
    const th = rng.next() * Math.PI * 2;
    const speed = def.speed * (elite ? 1.08 : 1);
    // Source: Enemy.canAttackPlayer reach, `max(attackRange + TILE_SIZE / 2, MELEE_HOLD_PX + 10)`.
    const reach = Math.max(def.attackRange + 16, MELEE_HOLD_PX + 10);
    return {
      idx, key: ms.key, def, elite, hp: maxHp, maxHp,
      d: d0, th, speed, hold: ranged ? def.attackRange * RANGED_HOLD : MELEE_HOLD_PX, reach, ranged, pinned: false,
      state: summoned ? 'chase' : 'idle', status: null, statusMs: 0, attackTimer: 0, surpriseMs: 0, engaged: false,
      contacted: summoned, contactAt: !summoned && d0 > def.aggroRange ? ((d0 - def.aggroRange) / PLAYER_SPEED_PX) * 1000 : 0,
      contactT: 0, hostile: true, fleeMs: 0, fleeKind: 'morale', keepMs: 0, retreats: 0, halfChecked: false,
      reformed: false,
      // Source: Enemy constructor `cooldownMs * 0.6` and `everyMs * 0.5`.
      casterTimer: (hasSpecial(def, 'caster')?.cooldownMs ?? 0) * 0.6,
      regenMs: 0,
      cd: def.attackCooldownMs, summoned, summonTimer: (hasSpecial(def, 'summon')?.everyMs ?? 0) * 0.5, phaseIdx: 0,
    };
  };
  const mobs: Mob[] = spec.monsters.map((ms, idx) => makeMob(ms, idx, 64 + rng.next() * 256, false));
  // The boss room: the king waits on the far side of the chamber and is aware of you from the door.
  for (const m of mobs) if (m.def.boss) { m.d = 160 + rng.next() * 60; m.contactAt = 0; }
  let hirelingHp = spec.hireling ? roll(rng, 1, 8) : 0;
  let hirelingCd = 0;

  // ── Hero timers ──
  let t = 0;
  let graceMs = 0;
  let swingCd = 0;
  let castCd = 0;
  let potionCd = 0;
  let turnCd = 0;
  let turns = 0;
  let heldMs = 0;
  let heldImmuneUntil = 0;
  let poisonMs = 0;
  let poisonCarry = 0;
  let advance = null as { mob: Mob; ms: number } | null;
  let firstBlow = false;
  let chaAdj = charismaReaction(hero.scores.cha);
  chaAdj = Number.isFinite(chaAdj) ? chaAdj : 0;
  let outcome: FightOutcome | null = null;

  const alive = (m: Mob): boolean => m.state !== 'dead';
  const lose = (n: number, key: MonsterKey, cause: HitEvent['cause']): void => {
    hero.hp -= n;
    damageBy[key] = (damageBy[key] ?? 0) + n;
    trace?.push({ t, damage: n, key, cause });
  };

  /** Source: Player.takeDamage: nothing lands while the grace window is open, then 500 ms of grace. */
  const hurt = (amount: number, key: MonsterKey, cause: HitEvent['cause'] = 'hit'): void => {
    if (graceMs > 0 || hero.hp <= 0) return;
    lose(Math.max(1, Math.round(amount)), key, cause);
    graceMs = PLAYER_HIT_GRACE_MS;
  };

  /** Source: Player.addEffect('HELD'): not renewed while it lasts, nor for 6 s after. */
  const hold = (ms: number): void => {
    if (ov?.holdImmunity !== false && t < heldImmuneUntil) return;
    heldImmuneUntil = t + ms + HELD_IMMUNE_EXTRA_MS;
    heldMs = ms;
  };

  const save = (category: Parameters<typeof playerSave>[1], modifier = 0): boolean =>
    playerSave(sheet, category, modifier, rng).success;

  // ── Monster-side rules (CombatController) ──

  const provoke = (m: Mob): void => {
    m.hostile = true;
    if (m.state === 'hold') m.state = 'chase';
  };

  /** Source: CombatController.checkMorale. */
  const checkMorale = (m: Mob): void => {
    if (!alive(m) || m.hp <= 0 || m.status) return;
    if (neverChecksMorale(m.def, { summoned: m.summoned })) return;
    if (m.state === 'flee' || m.state === 'distance' || !m.contacted) return;
    if (moraleCheck(m.def.morale, rng).passed) return;
    m.state = 'flee';
    m.fleeKind = 'morale';
    m.fleeMs = fleeDurationMs(rng);
    m.surpriseMs = 0;
  };

  /** Source: CombatController.afterBlow: neighbours stop being wary, a monster under half hit points checks nerve. */
  const afterBlow = (m: Mob): void => {
    for (const e of mobs) {
      if (e === m || !alive(e) || e.hostile) continue;
      if (between(e, m) <= ALLY_DEATH_RADIUS_PX) provoke(e);
    }
    if (m.hp > 0 && !m.halfChecked && m.hp * 2 < m.maxHp) {
      m.halfChecked = true;
      checkMorale(m);
    }
  };

  /** Source: CombatController.killEnemy (reform, morale of witnesses) and doCleave. Returns true if it stayed dead. */
  const kill = (m: Mob, byMelee: boolean): boolean => {
    // Source: Enemy.tryReform.
    if (m.key === 'SKELETON' && !m.reformed && !m.elite && rng.next() <= REFORM_CHANCE) {
      m.reformed = true;
      m.hp = Math.max(2, Math.ceil(m.maxHp * 0.5));
      return false;
    }
    m.state = 'dead';
    kills++;
    // Things a boss summoned crumble with it (CombatController.killEnemy).
    if (m.def.boss) for (const e of mobs) if (e.summoned && alive(e)) e.state = 'dead';
    for (const e of mobs) {
      if (e === m || !alive(e) || e.hp <= 0) continue;
      if (between(e, m) > ALLY_DEATH_RADIUS_PX) continue;
      checkMorale(e);
    }
    if (hero.classKey === 'fighter' && byMelee) cleave(m);
    return true;
  };

  /** Source: CombatController.doCleave: one more real swing at the first neighbour within two tiles. */
  const cleave = (dead: Mob): void => {
    for (const e of mobs) {
      if (!alive(e) || e.hp <= 0) continue;
      if (between(e, dead) > CLEAVE_RANGE_PX) continue;
      applyPlayerOutcome(e, resolvePlayerAttack(sheet, targetInfo(e), rng, 'melee'), 'melee', false);
      break;
    }
  };

  /** Hurt a monster with damage already decided (a spell). Source: CombatController.damageEnemy. */
  const damageMob = (m: Mob, amount: number, byMelee = false): boolean => {
    m.hp = Math.max(0, m.hp - Math.max(1, Math.round(amount)));
    m.engaged = true;
    provoke(m);
    afterBlow(m);
    if (m.hp <= 0) return kill(m, byMelee);
    checkPhase(m);
    return false;
  };

  /** Source: Enemy.checkPhase + CombatController.damageEnemy: a boss phase changes speed and cooldown and calls help. */
  const checkPhase = (m: Mob): void => {
    const phases = hasSpecial(m.def, 'phases')?.phases;
    if (!phases || m.phaseIdx >= phases.length) return;
    const next = phases[m.phaseIdx];
    if ((m.hp / m.maxHp) * 100 > next.hpBelowPct) return;
    m.phaseIdx++;
    if (next.speedMult) m.speed *= next.speedMult;
    if (next.cooldownMult) m.cd *= next.cooldownMult;
    if (next.summon) for (let i = 0; i < (next.summonCount ?? 1); i++) summonOne(next.summon, m);
  };

  const summonOne = (key: MonsterKey, boss: Mob): void => {
    const sm = makeMob({ key }, mobs.length, 64 + rng.next() * 64, true);
    sm.d = Math.max(sm.hold, 64 + rng.next() * 64);
    void boss;
    mobs.push(sm);
  };

  /** Source: CombatController.applyPlayerOutcome. */
  const applyPlayerOutcome = (m: Mob, out: PlayerAttackOutcome, style: 'melee' | 'missile', allowCleave: boolean): void => {
    provoke(m);
    afterBlow(m);
    if (out.kind !== 'hit') return;
    if (eqBonus.lifeOnHit > 0) hero.hp = Math.min(hero.maxHp, hero.hp + eqBonus.lifeOnHit);
    if (style === 'melee') {
      for (const c of m.def.special ?? []) {
        if (c.kind === 'corrode' && c.target === 'weapon' && rng.next() * 100 < c.chancePct) corrode('weapon');
      }
    }
    void allowCleave;
    damageMob(m, out.damage, style === 'melee');
  };

  /** Source: CombatController.corrodeItem: a plus lost, never below -3. */
  const corrode = (what: 'weapon' | 'armor'): void => {
    const item = hero.inventory.equipment[what];
    if (!item || item.plus <= -3) return;
    item.plus -= 1;
    acDirty = true;
  };

  const targetInfo = (m: Mob): TargetInfo => ({
    ac: m.def.ac,
    def: m.def,
    key: m.key,
    // Source: Enemy.isUnaware / isHelpless / isSurprised.
    unaware: m.status === 'asleep' || m.status === 'held' || (!m.engaged && m.state !== 'flee'),
    helpless: m.status === 'asleep' || m.status === 'held',
    surprised: m.surpriseMs > 0,
  });

  /** Source: CombatController.applyOnHitSpecials. Runs on every landed round, even one the grace window absorbed. */
  const onHitSpecials = (m: Mob): void => {
    const def = m.def;
    const poison = hasSpecial(def, 'poison');
    if (poison && !eqBonus.resistPoison && !save(poison.save)) {
      // Source: Player.addEffect replaces a running poison, so it never stacks.
      poisonMs = poison.durationMs;
      poisonDps = poison.dps;
    }
    const para = hasSpecial(def, 'paralysis');
    if (para && !save(para.save)) hold(para.durationMs);
    const drain = hasSpecial(def, 'drain');
    if (drain && !(drain.save && save(drain.save))) {
      const state = { hp: hero.hp, maxHp: hero.maxHp, drained: hero.drained };
      const lost = applyDrain(state, drain.maxHpPerHit);
      const hpLost = hero.hp - state.hp;
      hero.maxHp = state.maxHp;
      hero.drained = state.drained;
      hero.hp = state.hp;
      if (hpLost > 0) {
        damageBy[m.key] = (damageBy[m.key] ?? 0) + hpLost;
        trace?.push({ t, damage: hpLost, key: m.key, cause: 'hit' });
      }
      void lost;
    }
    for (const c of def.special ?? []) {
      if (c.kind === 'corrode' && c.target === 'armor' && rng.next() * 100 < c.chancePct) corrode('armor');
    }
  };
  let poisonDps = 0;

  /** One monster attack round. Source: CombatController.rollMonsterRound + applyMonsterRound. */
  const monsterRound = (m: Mob): void => {
    // A man-at-arms in reach draws some of the blows (about a third; PartyController.monstersStrike hands the
    // monster's ready attack to the hireling when it is closer). Rolled against his armor class 6.
    if (hirelingHp > 0 && !m.ranged && rng.next() < 0.35) {
      const r = resolveMonsterRound(m.def, 6, rng, { toHit: m.elite ? 1 : 0, damage: m.elite ? 1 : 0 });
      hirelingHp -= r.total;
      return;
    }
    refreshAc();
    const round = resolveMonsterRound(m.def, ignoresArmor(m.def) ? acIgnore : acNormal, rng, {
      toHit: (m.elite ? 1 : 0) + hitBonus,
      damage: (m.elite ? 1 : 0) + dmgBonus,
    });
    if (round.hits === 0) return;
    hurt(round.total, m.key);
    if (hero.hp <= 0) return;
    onHitSpecials(m);
    if (eqBonus.thorns > 0 && !m.ranged && alive(m)) damageMob(m, eqBonus.thorns);
  };

  /** Monster casters. Source: CombatController.monsterCastSpell (missile and hold; no fireball outside the boss). */
  const monsterCast = (m: Mob): void => {
    const spells = hasSpecial(m.def, 'caster')?.spells ?? [];
    const spell = spells[Math.floor(rng.next() * spells.length)];
    if (spell === 'hold_person') {
      if (!save('spells')) hold(m.def.boss ? 3000 : 2500);
      return;
    }
    const isFire = spell === 'fireball';
    let dmg = isFire ? rollDice(rng, '3d6') : rollDice(rng, '1d4+1');
    if (isFire && save('spells')) dmg = Math.max(1, Math.floor(dmg / 2));
    hurt(dmg, m.key, 'spell');
  };

  // ── Monster step ──

  const contact = (m: Mob): void => {
    m.contacted = true;
    m.contactT = t;
    // Source: CombatController.checkFirstContact: 2 in 6 caught flat; the intelligent ones roll a reaction.
    if (!m.def.boss && surpriseRoll(rng)) m.surpriseMs = SURPRISE_MS;
    const reaction = monsterReaction(m.def, rng, chaAdj);
    if (isIntelligent(m.def) && reaction !== 'hostile') {
      // Wary and afraid monsters both hold their ground until a blow (or 8 s, or two tiles) ends it.
      m.hostile = false;
      m.state = 'hold';
    } else {
      m.state = 'chase';
    }
  };

  const mobStep = (m: Mob): void => {
    if (!alive(m)) return;
    m.attackTimer = Math.max(0, m.attackTimer - STEP_MS);
    m.casterTimer = Math.max(0, m.casterTimer - STEP_MS);

    if (m.status) {
      m.statusMs -= STEP_MS;
      if (m.statusMs <= 0) m.status = null;
      else return;
    }
    // Source: Enemy.update regeneration (fire and acid would stop it; the sim has neither).
    const regen = hasSpecial(m.def, 'regen');
    if (regen && m.hp < m.maxHp) {
      m.regenMs += STEP_MS;
      if (m.regenMs >= 1000) { m.regenMs -= 1000; m.hp = Math.min(m.maxHp, m.hp + regen.hpPerSec); }
    }

    if (m.state === 'idle') {
      if (t >= m.contactAt) contact(m);
      return;
    }
    if (m.surpriseMs > 0) { m.surpriseMs = Math.max(0, m.surpriseMs - STEP_MS); return; }

    const stepPx = (m.speed * STEP_MS) / 1000;

    if (m.state === 'flee') {
      m.fleeMs -= STEP_MS;
      m.d += stepPx;
      if (m.fleeMs <= 0) {
        if (m.fleeKind === 'turn') {
          m.state = 'chase';
        } else {
          m.retreats++;
          const r = retreatOutcome(m.def.morale, rng, m.retreats - 1);
          if (r.outcome === 'return') m.state = 'chase';
          else { m.state = 'distance'; m.keepMs = KEEP_DISTANCE_MS; }
        }
      }
      return;
    }
    if (m.state === 'distance') {
      m.keepMs -= STEP_MS;
      if (m.d < 128) m.d += stepPx * 0.6;
      if (m.keepMs <= 0) {
        m.retreats++;
        const r = retreatOutcome(m.def.morale, rng, m.retreats - 1);
        if (r.outcome === 'return') m.state = 'chase';
        else m.keepMs = KEEP_DISTANCE_MS;
      } else if (!m.ranged) {
        return;
      }
    }
    if (m.state === 'hold') {
      if (m.d <= WARY_PROXIMITY_PX || t - m.contactT >= WARY_PATIENCE_MS) provoke(m);
      else return;
    }

    // Closing in.
    if (m.state === 'chase') {
      const stop = m.pinned ? MELEE_HOLD_PX : m.hold;
      if (m.d > stop) m.d = Math.max(stop, m.d - stepPx);
    }

    // Casters (cultist): a spell every few seconds while within 230 px.
    if (m.state === 'chase' && hasSpecial(m.def, 'caster') && m.casterTimer <= 0 && m.d <= 230 && m.hostile) {
      m.casterTimer = hasSpecial(m.def, 'caster')!.cooldownMs;
      monsterCast(m);
      if (hero.hp <= 0) return;
    }

    // Boss summons: a skeleton every 12 s up to four alive. Source: CombatController.monsterSummon.
    const summon = hasSpecial(m.def, 'summon');
    if (summon && m.state === 'chase') {
      m.summonTimer = Math.max(0, m.summonTimer - STEP_MS);
      if (m.summonTimer <= 0) {
        m.summonTimer = summon.everyMs;
        const n = mobs.filter((e) => alive(e) && e.summoned).length;
        if (n < summon.maxAlive) summonOne(summon.monster, m);
      }
    }

    // Source: Enemy.canAttackPlayer.
    if (m.attackTimer <= 0 && m.hostile && m.d <= m.reach && (m.state === 'chase' || (m.state === 'distance' && m.ranged))) {
      m.engaged = true;
      m.attackTimer = m.cd;
      monsterRound(m);
    }
  };

  // ── Player-side actions ──

  const meleeCandidates = (): Mob[] =>
    mobs.filter((m) => alive(m) && m.d <= MELEE_REACH_PX).sort((a, b) => a.d - b.d || a.idx - b.idx);

  const drinkPotion = (): void => {
    if (potionCd > 0 || hero.hp <= 0 || hero.hp > hero.maxHp * POTION_AT) return;
    const p = hero.potions;
    if (p.healing + p.extra <= 0) return;
    const wantsExtra = hero.hp <= hero.maxHp * 0.25 && p.extra > 0;
    let amount: number;
    if (wantsExtra || p.healing <= 0) {
      p.extra--;
      amount = rollDice(rng, '3d8') + 3;
    } else {
      p.healing--;
      amount = rollDice(rng, `${HEALING_POTION_DICE}+${HEALING_POTION_BONUS}`);
    }
    hero.hp = Math.min(hero.maxHp, hero.hp + amount);
    hero.potionsUsed++;
    potionCd = POTION_COOLDOWN_MS;
  };

  const missileRange = (): number => {
    const w = weaponProfile(hero.inventory);
    if (w.ranged) return BOW_RANGE_PX;
    return hero.classKey === 'wizard' ? RANGE_PX[WIZARD_DART.range] : 0;
  };

  const swing = (): void => {
    if (swingCd > 0 || heldMs > 0 || advance) return;
    const w = weaponProfile(hero.inventory);
    const near = meleeCandidates();
    const missileOk = hero.classKey === 'wizard' || w.ranged;
    if (near.length > 0) {
      // The nearest monster that this weapon can hurt; a wizard falls back to the dart on an immune one.
      let target: Mob | undefined = near.find((m) => canHarm(m.def, { plus: w.plus, silver: w.silver }));
      let style: 'melee' | 'missile' = 'melee';
      if (!target && missileOk) { target = near[0]; style = 'missile'; }
      if (!target) return;
      firstBlow = true;
      if (style === 'melee') {
        swingCd = BASE_SWING_MS;
        applyPlayerOutcome(target, resolvePlayerAttack(sheet, targetInfo(target), rng, 'melee'), 'melee', true);
      } else {
        swingCd = hero.classKey === 'wizard' && !w.ranged ? WIZARD_DART.cooldownMs : BASE_SWING_MS;
        const dice = w.ranged ? undefined : `${WIZARD_DART.dice[0]}d${WIZARD_DART.dice[1]}`;
        applyPlayerOutcome(target, resolvePlayerAttack(sheet, targetInfo(target), rng, 'missile', dice), 'missile', false);
      }
      return;
    }
    // Source: CombatController.handlePlayerAttack: with nothing in reach a wizard or archer fires at what it can see.
    if (missileOk) {
      const range = missileRange();
      const shots = mobs.filter((m) => alive(m) && m.contacted && m.d <= range).sort((a, b) => a.d - b.d);
      if (shots.length > 0) {
        const target = shots[0];
        firstBlow = true;
        swingCd = hero.classKey === 'wizard' && !w.ranged ? WIZARD_DART.cooldownMs : BASE_SWING_MS;
        const dice = w.ranged ? undefined : `${WIZARD_DART.dice[0]}d${WIZARD_DART.dice[1]}`;
        applyPlayerOutcome(target, resolvePlayerAttack(sheet, targetInfo(target), rng, 'missile', dice), 'missile', false);
        return;
      }
    }
    // Nothing to hit and nothing about to arrive on its own: walk up to the nearest stationary or distant target.
    const coming = mobs.some((m) => alive(m) && (m.state === 'idle' || m.state === 'flee'
      || (m.state === 'chase' && !m.ranged && !m.status && m.hostile)));
    if (coming) return;
    const goals = mobs.filter((m) => alive(m) && m.d > MELEE_REACH_PX && m.state !== 'flee');
    if (goals.length === 0) return;
    goals.sort((a, b) => a.d - b.d);
    const goal = goals[0];
    advance = { mob: goal, ms: Math.max(500, ((goal.d - 40) / PLAYER_SPEED_PX) * 1000) };
  };

  // ── Spells ──

  const spellReady = (key: string): boolean => !!hero.book && hero.book.canCast(key);
  const spend = (key: string): void => { hero.book!.cast(key); castCd = CAST_GAP_MS; };

  /** Monsters within `radius` of the best centre among `cands` (a spell's burst). */
  const cluster = (cands: Mob[], radius: number, cap: number): Mob[] => {
    let best: Mob[] = [];
    for (const c of cands) {
      const hit = cands.filter((o) => between(o, c) <= radius).sort((a, b) => a.hp - b.hp).slice(0, cap);
      if (hit.length > best.length) best = hit;
    }
    return best;
  };

  const awakeInPlay = (): Mob[] => mobs.filter((m) => alive(m) && m.contacted && !m.status && m.state !== 'flee');

  const wizardCast = (): void => {
    const book = hero.book!;
    const prepared = book.available().map((a) => a.key);
    const level = hero.level;
    const inPlay = awakeInPlay().filter((m) => m.d <= RANGE_PX.far);
    if (inPlay.length === 0) return;

    // Sleep: two or more weak living things close together. No save; they stay asleep and helpless.
    if (spellReady('sleep')) {
      const eff = getSpell('sleep')!.effect;
      if (eff.kind === 'status') {
        const cands = inPlay.filter((m) => !m.def.undead && m.def.hd <= (eff.maxHd ?? 4) && m.d <= RANGE_PX.near);
        const hit = cluster(cands, SLEEP_RADIUS_PX, eff.maxTargets ?? 6);
        if (hit.length >= 2) {
          spend('sleep');
          for (const m of hit) { m.status = 'asleep'; m.statusMs = eff.durationMs; }
          return;
        }
      }
    }
    // Burst damage: the best of fireball, lightning bolt, ice storm over a cluster.
    let bestSpell: { key: string; targets: Mob[]; value: number } | null = null;
    for (const key of ['fireball', 'lightning_bolt', 'ice_storm']) {
      if (!prepared.includes(key)) continue;
      const def = getSpell(key)!;
      if (def.effect.kind !== 'damage') continue;
      const radius = def.effect.radiusPx ?? 40;
      const cap = key === 'lightning_bolt' ? 2 : 5;
      const targets = cluster(inPlay, radius, cap);
      const dice = damageDice(def.effect, level);
      const value = targets.length * (dice[0] * (dice[1] + 1)) / 2;
      if ((targets.length >= 2 || (targets[0]?.hp ?? 0) >= 15) && (!bestSpell || value > bestSpell.value)) bestSpell = { key, targets, value };
    }
    if (bestSpell) {
      const def = getSpell(bestSpell.key)!;
      if (def.effect.kind === 'damage') {
        spend(bestSpell.key);
        const dice = damageDice(def.effect, level);
        for (const m of bestSpell.targets) {
          let dmg = roll(rng, dice[0], dice[1], def.effect.bonus ?? 0);
          if (def.effect.save && monsterSave(m.def.hd, def.effect.save, rng).success) dmg = Math.floor(dmg / 2);
          damageMob(m, dmg);
        }
        return;
      }
    }
    // Web: two or more awake monsters close together; a breath save frees each.
    if (spellReady('web')) {
      const def = getSpell('web')!;
      if (def.effect.kind === 'status') {
        const hit = cluster(inPlay.filter((m) => m.d <= RANGE_PX.near), def.effect.radiusPx ?? 80, 6);
        if (hit.length >= 2) {
          spend('web');
          for (const m of hit) {
            if (def.effect.save && monsterSave(m.def.hd, def.effect.save, rng).success) continue;
            m.status = 'webbed';
            m.statusMs = def.effect.durationMs;
          }
          return;
        }
      }
    }
    // Magic missile: never misses, one target.
    if (spellReady('magic_missile')) {
      const def = getSpell('magic_missile')!;
      if (def.effect.kind === 'missiles') {
        const target = [...inPlay].sort((a, b) => a.d - b.d)[0];
        spend('magic_missile');
        let dmg = 0;
        for (let i = 0; i < missileCount(def.effect, level); i++) dmg += roll(rng, def.effect.dice[0], def.effect.dice[1], def.effect.bonus);
        damageMob(target, dmg);
      }
    }
  };

  const healSpell = (): boolean => {
    for (const key of ['cure_serious_wounds', 'cure_light_wounds']) {
      if (!spellReady(key)) continue;
      const def = getSpell(key)!;
      if (def.effect.kind !== 'heal') continue;
      spend(key);
      hero.hp = Math.min(hero.maxHp, hero.hp + roll(rng, def.effect.dice[0], def.effect.dice[1], def.effect.bonus ?? 0));
      return true;
    }
    return false;
  };

  const clericCast = (): void => {
    if (hero.hp <= hero.maxHp * 0.5 && healSpell()) return;
    // Hold Person: two or more living humanoids; a spells save frees each. Held monsters are struck automatically.
    if (spellReady('hold_person')) {
      const def = getSpell('hold_person')!;
      if (def.effect.kind === 'status') {
        const humanoids = awakeInPlay().filter((m) => isIntelligent(m.def) && m.d <= RANGE_PX.far);
        if (humanoids.length >= 2) {
          spend('hold_person');
          for (const m of humanoids.slice(0, def.effect.maxTargets ?? 3)) {
            if (monsterSave(m.def.hd, 'spells', rng).success) continue;
            m.status = 'held';
            m.statusMs = def.effect.durationMs;
          }
        }
      }
    }
  };

  /** Source: CombatController.doTurnUndead. */
  const turn = (): void => {
    if (hero.classKey !== 'cleric' || turnCd > 0 || heldMs > 0) return;
    const targets = mobs.filter((m) => alive(m) && m.def.undead && m.contacted && m.state !== 'flee'
      && isTurnable(m.def) && m.d <= TURN_RANGE_PX);
    if (targets.length === 0) return;
    // Policy: turning only postpones a lone undead, so a cleric turns when the dead outnumber him, when he is hurt,
    // or when the table destroys them outright, and at most twice a fight otherwise.
    const destroys = targets.some((m) => hero.level - Math.ceil(m.def.hd) >= 5);
    if (!destroys && (turns >= 2 || (targets.length < 2 && hero.hp > hero.maxHp * 0.6))) return;
    turns++;
    turnCd = TURN_COOLDOWN_MS;
    for (const m of targets) {
      const o = turnUndead(hero.level, m.def.hd, rng);
      if (o === 'destroyed') { m.hp = 0; kill(m, false); }
      else if (o === 'turned') { m.state = 'flee'; m.fleeKind = 'turn'; m.fleeMs = TURN_FLEE_MS; }
    }
  };

  /** Nothing left that this hero can hurt: it runs. */
  const nothingHurtable = (): boolean => {
    if (hero.classKey === 'wizard' || weaponProfile(hero.inventory).ranged) return false;
    const w = weaponProfile(hero.inventory);
    return mobs.filter(alive).every((m) => !canHarm(m.def, { plus: w.plus, silver: w.silver }));
  };

  // ── The loop ──

  for (t = 0; t < (spec.maxMs ?? MAX_FIGHT_MS) && outcome === null; t += STEP_MS) {
    graceMs = Math.max(0, graceMs - STEP_MS);
    swingCd = Math.max(0, swingCd - STEP_MS);
    castCd = Math.max(0, castCd - STEP_MS);
    potionCd = Math.max(0, potionCd - STEP_MS);
    turnCd = Math.max(0, turnCd - STEP_MS);
    heldMs = Math.max(0, heldMs - STEP_MS);

    // Poison: whole points, no grace. Source: Player.tickEffects.
    if (poisonMs > 0) {
      poisonMs -= STEP_MS;
      poisonCarry += (poisonDps * STEP_MS) / 1000;
      const whole = Math.floor(poisonCarry);
      if (whole > 0) {
        poisonCarry -= whole;
        const src = [...mobs].reverse().find((m) => hasSpecial(m.def, 'poison'));
        lose(whole, src?.key ?? 'GIANT_SPIDER', 'poison');
      }
    }
    if (hero.hp <= 0) { outcome = 'died'; break; }

    drinkPotion();
    if (advance) {
      advance.ms -= STEP_MS;
      if (advance.ms <= 0) {
        const m = advance.mob;
        advance = null;
        if (alive(m) && m.d > MELEE_REACH_PX) { m.d = 40; m.pinned = true; }
        if (alive(m)) { firstBlow = true; provoke(m); afterBlow(m); }
      }
    }
    turn();
    if (hero.book && castCd <= 0 && heldMs <= 0) {
      if (hero.classKey === 'wizard') wizardCast();
      else if (hero.classKey === 'cleric') clericCast();
    }
    swing();
    if (hirelingHp > 0) {
      hirelingCd = Math.max(0, hirelingCd - STEP_MS);
      if (hirelingCd <= 0) {
        const foe = mobs.filter((e) => alive(e) && e.contacted && e.status !== 'asleep' && e.d <= 90 && e.state !== 'flee')
          .sort((a, b) => a.d - b.d)[0];
        if (foe) {
          hirelingCd = 1000;
          // Source: PartyController.strike: d20 vs armor class at THAC0 20, 1d6, nothing against a monster that needs magic.
          const r = attackRoll({ thac0: 20, targetAc: foe.def.ac }, rng);
          if (r.hit && !hasSpecial(foe.def, 'immune_normal_weapons')) {
            damageMob(foe, damageRoll([1, 6], 0, rng, { critical: r.critical }));
          }
        }
      }
    }

    for (const m of mobs.slice()) {
      mobStep(m);
      if (hero.hp <= 0) break;
    }
    if (hero.hp <= 0) { outcome = 'died'; break; }
    if (mobs.every((m) => !alive(m))) { outcome = 'won'; break; }
    if (nothingHurtable()) { outcome = 'stuck'; break; }
  }
  if (outcome === null) outcome = 'stuck';
  void firstBlow;

  // Poison still running when the last monster falls keeps ticking.
  if (outcome === 'won' && poisonMs > 0) {
    const rest = Math.floor((poisonMs * poisonDps) / 1000);
    if (rest > 0) {
      const src = mobs.find((m) => hasSpecial(m.def, 'poison'));
      lose(Math.min(rest, Math.max(0, hero.hp)), src?.key ?? 'GIANT_SPIDER', 'poison');
      if (hero.hp <= 0) outcome = 'died';
    }
  }

  const result: FightResult = {
    outcome,
    durationMs: t,
    damageTaken: Math.max(0, hpAtStart - Math.max(0, hero.hp)) + 0,
    damageBy,
    potionsUsed: hero.potionsUsed - potionsAtStart,
    kills,
    hpEnd: Math.max(0, hero.hp),
  };
  if (trace) result.trace = trace;
  return result;
}

/**
 * Between fights: drink a potion if under 45%, and a cleric spends cure slots while under 70%. Class healing is use it
 * or lose it here: a delve never rests, so unspent slots would be wasted by the end of it.
 */
export function betweenFights(hero: Hero, rng: Rng): void {
  const book = hero.book;
  if (hero.classKey === 'cleric' && book) {
    for (let guard = 0; guard < 12 && hero.hp <= hero.maxHp * 0.7; guard++) {
      let cast = false;
      for (const key of ['cure_serious_wounds', 'cure_light_wounds']) {
        const def = getSpell(key);
        if (!def || def.effect.kind !== 'heal' || !book.canCast(key)) continue;
        book.cast(key);
        hero.hp = Math.min(hero.maxHp, hero.hp + roll(rng, def.effect.dice[0], def.effect.dice[1], def.effect.bonus ?? 0));
        cast = true;
        break;
      }
      if (!cast) break;
    }
  }
  while (hero.hp <= hero.maxHp * POTION_AT && hero.potions.healing + hero.potions.extra > 0) {
    if (hero.potions.healing > 0) {
      hero.potions.healing--;
      hero.hp = Math.min(hero.maxHp, hero.hp + rollDice(rng, `${HEALING_POTION_DICE}+${HEALING_POTION_BONUS}`));
    } else {
      hero.potions.extra--;
      hero.hp = Math.min(hero.maxHp, hero.hp + rollDice(rng, '3d8') + 3);
    }
    hero.potionsUsed++;
  }
}

/** Cleric buffs before the first fight (Bless, Protection from Evil), if the prayer list has them. */
export function preBuff(hero: Hero): void {
  const book = hero.book;
  if (!book || hero.classKey !== 'cleric') return;
  if (book.canCast('bless')) { book.cast('bless'); hero.blessToHit = 1; }
  if (book.canCast('protection_from_evil')) { book.cast('protection_from_evil'); hero.buffAc = 2; }
}
