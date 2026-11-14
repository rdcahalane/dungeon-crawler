import * as Phaser from "phaser";
import type { GameContext } from "../../GameContext";
import { TILE_SIZE } from "../../constants";
import { Hireling } from "../../entities/Hireling";
import type { Enemy } from "../../entities/Enemy";
import { attackRoll, damageRoll, hasSpecial, mathRng } from "../../rules";
import {
  FLEE_MS, firstName, hurtHireling, moraleCheck, playerIsLow, sanitizeParty, shouldCheckMorale, splitGold,
  type HirelingState, type MoraleEvent,
} from "../../rules/hirelings";
import { retroText } from "../../gfx/font";
import { resolveMonsterRound } from "./AdndCombat";
import { findPath, lineClear, nearestWalkable, type Pt } from "../ui/pathfind";

/** Spear reach, centre to centre, in pixels. */
const REACH_PX = 40;
/** A monster this close to the man-at-arms is fair game. */
const ENGAGE_SELF_PX = 112;
/** ...or this close to the player. */
const ENGAGE_PLAYER_PX = 72;
/** He never chases a monster farther than this from the player. */
const LEASH_PX = 240;
/** Past this distance from the player a hireling is put back beside him. */
const SNAP_PX = TILE_SIZE * 14;
/** Unable to reach his place for this long: put him beside the player. */
const STUCK_SNAP_MS = 2500;
/** Where each kind keeps station: how many of the player's recent tiles behind him. */
const SLOT: Record<string, number> = { torchbearer: 2, man_at_arms: 3 };
const TRAIL_LEN = 16;

type Move = "arrived" | "moving" | "blocked";

const GREY = 0x7d7890;

/**
 * The hired companions on this floor: builds them from `player.stats.party`, walks them behind the player on the
 * existing tile pathfinding, lets the man-at-arms fight, rolls morale, and lays the dead to rest.
 *
 * Hirelings have no physics body (they never block a corridor). Monsters are not edited to know about them:
 * this controller rolls hireling-versus-monster blows itself, and a monster that is in reach of a hireling but not
 * able to strike the player this frame is struck back at on its own cooldown (`Enemy.canAttackPlayer` and
 * `beginAttack`, called with the hireling's position).
 *
 * The hireling states are the objects saved in `player.stats.party`, so a floor change or a save carries them.
 */
export class PartyController {
  private members: Hireling[] = [];
  private graves: Phaser.GameObjects.BitmapText[] = [];
  /** The player's recent tiles, newest first. */
  private trail: Pt[] = [];
  private playerLow = false;

  constructor(private ctx: GameContext) {}

  private get party(): HirelingState[] {
    const stats = this.ctx.player.stats;
    if (!stats.party) stats.party = [];
    return stats.party;
  }

  private walk = (tx: number, ty: number): boolean => this.ctx.isWalkable(tx, ty);

  // ── Setup ────────────────────────────────────────────────────────────────

  /** Put the saved hirelings on the floor beside the player. Called once the player exists. */
  create(): void {
    const ctx = this.ctx;
    const stats = ctx.player.stats;
    stats.party = sanitizeParty(stats.party);
    const ptx = Math.floor(ctx.player.x / TILE_SIZE);
    const pty = Math.floor(ctx.player.y / TILE_SIZE);
    this.trail = [{ tx: ptx, ty: pty }];
    const used = new Set<string>([`${ptx},${pty}`]);
    for (const state of stats.party) {
      const spot = this.freeTileNear(ptx, pty, used) ?? { tx: ptx, ty: pty };
      used.add(`${spot.tx},${spot.ty}`);
      this.members.push(new Hireling(
        ctx.scene, spot.tx * TILE_SIZE + TILE_SIZE / 2, spot.ty * TILE_SIZE + TILE_SIZE / 2, state,
      ));
    }
  }

  /** A walkable tile at least one step from (tx, ty), not in `used`, nearest first. */
  private freeTileNear(tx: number, ty: number, used: ReadonlySet<string>, minRing = 1, maxRing = 4): Pt | null {
    for (let r = minRing; r <= maxRing; r++) {
      let best: Pt | null = null;
      let bestD = Infinity;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const x = tx + dx;
          const y = ty + dy;
          if (used.has(`${x},${y}`) || !this.walk(x, y)) continue;
          const d = dx * dx + dy * dy;
          if (d < bestD) { bestD = d; best = { tx: x, ty: y }; }
        }
      }
      if (best) return best;
    }
    return null;
  }

  // ── Gold ─────────────────────────────────────────────────────────────────

  /**
   * Gold has just been found. A living man-at-arms keeps a third (rounded down). Returns what he keeps, so
   * `ctx.addGold` can pay the player the rest, and says so in the status line and over his head.
   */
  takeShare(amount: number): number {
    const split = splitGold(this.ctx.player.stats.party, amount);
    if (split.share <= 0 || !split.by) return 0;
    const m = this.members.find((h) => h.info === split.by);
    const first = firstName(split.by.name);
    this.ctx.status(`${first} keeps a third: ${split.share} gp. You get ${split.yours}.`);
    if (m) this.ctx.floatText(m.x, m.y - 40, `${first.toUpperCase()} +${split.share} GP`, 0xf4c42c, 11);
    return split.share;
  }

  // ── Per frame ────────────────────────────────────────────────────────────

  update(delta: number): void {
    if (this.members.length === 0) return;
    const ctx = this.ctx;
    const player = ctx.player;

    const ptx = Math.floor(player.x / TILE_SIZE);
    const pty = Math.floor(player.y / TILE_SIZE);
    const head = this.trail[0];
    if (!head || head.tx !== ptx || head.ty !== pty) {
      this.trail.unshift({ tx: ptx, ty: pty });
      if (this.trail.length > TRAIL_LEN) this.trail.length = TRAIL_LEN;
    }

    // The player falls under a quarter of his hit points: the men who fight look to their nerve, once per fall.
    const low = playerIsLow(player.stats.hp, player.stats.maxHp);
    if (low && !this.playerLow) {
      this.playerLow = true;
      for (const m of [...this.members]) this.checkMorale(m, "player_low");
    } else if (!low && player.stats.hp >= player.stats.maxHp * 0.25) {
      this.playerLow = false;
    }

    for (const m of [...this.members]) {
      if (!m.active) continue;
      m.moving = false;
      m.tick(delta);
      this.act(m, delta);
    }
    this.monstersStrike();
  }

  private act(m: Hireling, delta: number): void {
    if (m.fleeMs > 0) {
      m.fleeMs -= delta;
      if (m.fleeMs <= 0) {
        m.fleeMs = 0;
        this.ctx.floatText(m.x, m.y - 32, "back", 0xb8b4c8, 10);
      }
      this.runAway(m, delta);
      return;
    }
    if (m.def.fights) {
      const target = this.pickTarget(m);
      if (target) {
        this.fight(m, target, delta);
        return;
      }
    }
    this.follow(m, delta);
  }

  // ── Fighting ─────────────────────────────────────────────────────────────

  private pickTarget(m: Hireling): Enemy | null {
    const player = this.ctx.player;
    let best: Enemy | null = null;
    let bestD = Infinity;
    for (const e of this.ctx.enemies) {
      if (!e.active || e.hp <= 0 || e.status === "asleep") continue;
      const dSelf = Phaser.Math.Distance.Between(m.x, m.y, e.x, e.y);
      const dPlayer = Phaser.Math.Distance.Between(player.x, player.y, e.x, e.y);
      if (dPlayer > LEASH_PX) continue;
      if (dSelf > ENGAGE_SELF_PX && dPlayer > ENGAGE_PLAYER_PX) continue;
      if (e.fleeing && dSelf > REACH_PX) continue;
      if (dSelf < bestD) { bestD = dSelf; best = e; }
    }
    return best;
  }

  private fight(m: Hireling, e: Enemy, delta: number): void {
    const dist = Phaser.Math.Distance.Between(m.x, m.y, e.x, e.y);
    if (dist > REACH_PX) {
      const r = this.moveToward(m, e.x, e.y, 130, delta);
      if (r === "blocked") this.follow(m, delta);
      return;
    }
    m.stuckMs = 0;
    if (m.swingMs > 0) return;
    this.strike(m, e);
  }

  /** One spear thrust: d20 against the monster's armor class, then the damage die. */
  private strike(m: Hireling, e: Enemy): void {
    const ctx = this.ctx;
    const dmg = m.def.damage;
    m.swingMs = m.def.swingMs ?? 1000;
    m.flash(0xffffff);
    if (!dmg) return;
    const ex = e.x;
    const ey = e.y;
    const roll = attackRoll({ thac0: m.def.thac0, targetAc: e.ac }, mathRng);
    if (!roll.hit) {
      ctx.floatText(ex, ey - 20, "miss", 0x888899, 10);
      return;
    }
    if (hasSpecial(e.def, "immune_normal_weapons")) {
      ctx.floatText(ex, ey - 20, "no effect", 0x888899, 10);
      return;
    }
    const damage = damageRoll([dmg.count, dmg.sides], 0, mathRng, { critical: roll.critical });
    // Hurts the monster and, when it dies, runs the whole kill (experience to the player, drops, quests).
    ctx.combat.damageEnemy(e, damage, {});
    ctx.floatText(ex, ey - 20, `-${damage}`, 0xffd166, 11);
  }

  /** Monsters in reach of a hireling that the player does not hold are struck back at, on their own cooldown. */
  private monstersStrike(): void {
    const ctx = this.ctx;
    for (const e of [...ctx.enemies]) {
      if (!e.active || e.hp <= 0 || e.isRanged) continue;
      let victim: Hireling | null = null;
      let bestD = Infinity;
      for (const m of this.members) {
        if (!m.active || m.info.hp <= 0) continue;
        // Ready, awake, and close enough (the same test it uses on the player, asked at the hireling's spot).
        if (!e.canAttackPlayer(m.x, m.y)) continue;
        const d = Phaser.Math.Distance.Between(m.x, m.y, e.x, e.y);
        if (d < bestD) { bestD = d; victim = m; }
      }
      if (!victim) continue;
      e.beginAttack();
      const round = resolveMonsterRound(e.def, victim.def.ac, mathRng, {
        toHit: e.isElite ? 1 : 0,
        damage: e.isElite ? 1 : 0,
      });
      if (round.hits === 0) {
        ctx.floatText(victim.x, victim.y - 28, "miss", 0x888899, 10);
        continue;
      }
      this.hurt(victim, round.total, e.def.name);
    }
  }

  private hurt(m: Hireling, damage: number, cause: string): void {
    const dead = hurtHireling(m.info, damage);
    m.flash(0xff4444);
    this.ctx.floatText(m.x, m.y - 28, `-${damage}`, 0xd8382c, 11);
    m.refreshLabel();
    if (dead) {
      this.die(m, cause);
      return;
    }
    this.checkMorale(m, "hurt");
  }

  // ── Morale ───────────────────────────────────────────────────────────────

  private checkMorale(m: Hireling, event: MoraleEvent): void {
    if (!m.active || m.fleeMs > 0 || !shouldCheckMorale(m.info, event)) return;
    if (event === "hurt") m.info.hurtChecked = true;
    const ctx = this.ctx;
    const r = moraleCheck(m.info.kind, mathRng);
    const first = firstName(m.info.name);
    if (r.passed) {
      ctx.floatText(m.x, m.y - 40, "holds", 0xb8b4c8, 10);
      return;
    }
    if (r.failure === "lost") {
      ctx.status(`${m.info.name} panics and bolts into the dark. You will not see them again.`);
      ctx.floatText(m.x, m.y - 40, "RUNS!", 0xd8382c, 12);
      ctx.bus.emit("hireling_fled", { kind: m.info.kind, name: m.info.name, lost: true });
      this.remove(m);
      const away = this.awayFromEnemies(m);
      m.bolt(away.x * 96, away.y * 96);
      this.afterLossOfLight();
      return;
    }
    ctx.bus.emit("hireling_fled", { kind: m.info.kind, name: m.info.name, lost: false });
    m.fleeMs = FLEE_MS;
    m.path = [];
    ctx.status(`${first} loses their nerve and runs from the fight.`);
    ctx.floatText(m.x, m.y - 40, "FLEES!", 0xd8382c, 12);
  }

  // ── Death ────────────────────────────────────────────────────────────────

  private die(m: Hireling, cause: string): void {
    const ctx = this.ctx;
    const name = m.info.name;
    ctx.status(`${name} is dead, killed by the ${cause.toLowerCase()}. He is gone for good.`);
    ctx.bus.emit("hireling_died", { kind: m.info.kind, name, cause });
    ctx.floatText(m.x, m.y - 32, "R.I.P.", 0xb8b4c8, 12);
    // A small grave marker where he fell, for the rest of this visit to the floor.
    this.graves.push(
      retroText(ctx.scene, Math.round(m.x), Math.round(m.y), `+ ${firstName(name).toUpperCase()}`, {
        size: 16, color: GREY, originX: 0.5, originY: 0.5,
      }).setDepth(8),
    );
    this.remove(m);
    m.destroy();
    this.afterLossOfLight();
  }

  /** Take him off the floor and out of the saved party. */
  private remove(m: Hireling): void {
    const i = this.members.indexOf(m);
    if (i >= 0) this.members.splice(i, 1);
    const party = this.party;
    const j = party.indexOf(m.info);
    if (j >= 0) party.splice(j, 1);
  }

  /** A torchbearer gone means the light goes with him: the player's own torch takes over, or it is dark. */
  private afterLossOfLight(): void {
    const player = this.ctx.player;
    player.recomputeDerived();
    const light = player.ensureLight();
    if (light === "equipped") this.ctx.status("You light a torch of your own.");
    else if (light === "none" && !player.hasLight()) this.ctx.status("You have no light. Darkness presses in.");
    this.ctx.emitHUD();
  }

  // ── Movement ─────────────────────────────────────────────────────────────

  private behindTile(slot: number): Pt {
    const player = this.ctx.player;
    const ptx = Math.floor(player.x / TILE_SIZE);
    const pty = Math.floor(player.y / TILE_SIZE);
    const fx = player.stats.facing.x;
    const fy = player.stats.facing.y || (fx === 0 ? 1 : 0);
    const want = { tx: ptx - fx * slot, ty: pty - fy * slot };
    return nearestWalkable(want, this.walk, 2) ?? { tx: ptx, ty: pty };
  }

  private slotTile(m: Hireling): Pt {
    const slot = SLOT[m.info.kind] ?? 2;
    return this.trail[slot] ?? this.behindTile(slot);
  }

  private follow(m: Hireling, delta: number): void {
    const player = this.ctx.player;
    const dPlayer = Phaser.Math.Distance.Between(m.x, m.y, player.x, player.y);
    if (dPlayer > SNAP_PX) {
      this.snapNear(m);
      return;
    }
    // Standing on the player's own spot: step aside to his place behind.
    const nudged = dPlayer < 18;
    if (!nudged && dPlayer < TILE_SIZE * 1.6) {
      m.stuckMs = 0;
      return;
    }
    const slot = nudged ? this.behindTile(SLOT[m.info.kind] ?? 2) : this.slotTile(m);
    const gx = slot.tx * TILE_SIZE + TILE_SIZE / 2;
    const gy = slot.ty * TILE_SIZE + TILE_SIZE / 2;
    const speed = dPlayer > TILE_SIZE * 6 ? 210 : dPlayer > TILE_SIZE * 3 ? 150 : 110;
    const r = this.moveToward(m, gx, gy, speed, delta);
    if (r === "blocked") {
      m.stuckMs += delta;
      if (m.stuckMs > STUCK_SNAP_MS) this.snapNear(m);
    } else {
      m.stuckMs = 0;
    }
  }

  /** A man-at-arms who has broken runs from the nearest monster; with none near, he waits behind the player. */
  private runAway(m: Hireling, delta: number): void {
    const near = this.nearestEnemy(m, TILE_SIZE * 8);
    if (!near) {
      this.follow(m, delta);
      return;
    }
    const away = this.awayFromEnemies(m);
    const dest = nearestWalkable(
      { tx: m.tileX + Math.round(away.x * 4), ty: m.tileY + Math.round(away.y * 4) }, this.walk, 2,
    );
    if (!dest) return;
    this.moveToward(m, dest.tx * TILE_SIZE + TILE_SIZE / 2, dest.ty * TILE_SIZE + TILE_SIZE / 2, 170, delta);
  }

  private nearestEnemy(m: Hireling, within: number): Enemy | null {
    let best: Enemy | null = null;
    let bestD = within;
    for (const e of this.ctx.enemies) {
      if (!e.active || e.hp <= 0) continue;
      const d = Phaser.Math.Distance.Between(m.x, m.y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  }

  /** Unit vector pointing away from the nearest monster (down the screen when none is near). */
  private awayFromEnemies(m: Hireling): { x: number; y: number } {
    const e = this.nearestEnemy(m, TILE_SIZE * 12);
    if (!e) return { x: 0, y: 1 };
    const dx = m.x - e.x;
    const dy = m.y - e.y;
    const len = Math.hypot(dx, dy) || 1;
    return { x: dx / len, y: dy / len };
  }

  /** Put him on a free tile a few steps from the player (he lost the way, or fell too far behind). */
  private snapNear(m: Hireling): void {
    const player = this.ctx.player;
    const ptx = Math.floor(player.x / TILE_SIZE);
    const pty = Math.floor(player.y / TILE_SIZE);
    const used = new Set(this.members.filter((o) => o !== m).map((o) => `${o.tileX},${o.tileY}`));
    const spot = this.freeTileNear(ptx, pty, used, 2, 5) ?? this.freeTileNear(ptx, pty, used, 1, 5);
    m.stuckMs = 0;
    m.path = [];
    m.pathKey = "";
    if (!spot) return;
    m.setPosition(spot.tx * TILE_SIZE + TILE_SIZE / 2, spot.ty * TILE_SIZE + TILE_SIZE / 2);
  }

  /**
   * Walk toward a pixel point: straight when the way is clear, else along an A* path over walkable tiles.
   * No physics: the tiles were checked first, so a hireling never needs a wall collision.
   */
  private moveToward(m: Hireling, gx: number, gy: number, speed: number, deltaMs: number): Move {
    const dist = Math.hypot(gx - m.x, gy - m.y);
    if (dist < 3) return "arrived";
    let tx = gx;
    let ty = gy;
    if (lineClear(m.x, m.y, gx, gy, TILE_SIZE, this.walk, 6)) {
      m.path = [];
      m.pathKey = "";
    } else {
      const goal = { tx: Math.floor(gx / TILE_SIZE), ty: Math.floor(gy / TILE_SIZE) };
      const key = `${goal.tx},${goal.ty}`;
      m.repathMs -= deltaMs;
      if (m.pathKey !== key || m.repathMs <= 0 || m.path.length === 0) {
        m.path = findPath({ tx: m.tileX, ty: m.tileY }, goal, this.walk, { maxNodes: 500 }) ?? [];
        m.pathKey = key;
        m.repathMs = 600;
      }
      while (m.path.length > 0) {
        const wp = m.path[0];
        const cx = wp.tx * TILE_SIZE + TILE_SIZE / 2;
        const cy = wp.ty * TILE_SIZE + TILE_SIZE / 2;
        if (Math.hypot(cx - m.x, cy - m.y) < 4) m.path.shift();
        else break;
      }
      if (m.path.length === 0) return "blocked";
      tx = m.path[0].tx * TILE_SIZE + TILE_SIZE / 2;
      ty = m.path[0].ty * TILE_SIZE + TILE_SIZE / 2;
    }
    const d = Math.hypot(tx - m.x, ty - m.y) || 1;
    const step = Math.min((speed * deltaMs) / 1000, d);
    if (Math.abs(tx - m.x) > 0.5) m.setFlipX(tx < m.x);
    m.x += ((tx - m.x) / d) * step;
    m.y += ((ty - m.y) / d) * step;
    m.moving = true;
    return "moving";
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  destroy(): void {
    for (const m of this.members) m.destroy();
    this.members = [];
    for (const g of this.graves) g.destroy();
    this.graves = [];
  }
}
