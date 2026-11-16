import type { GameContext } from "../../GameContext";
import type { GameEventScope } from "../../GameEvents";
import type { Enemy } from "../../entities/Enemy";
import { TILE, TILE_SIZE, TOMB_FLOOR, enemyPoolForFloor } from "../../constants";
import { MONSTERS, mathRng } from "../../rules";
import {
  GAME_TURN_MS, chooseWanderSpawn, findPath, lineOfSight, wanderBlockedReason, wanderCheck,
  type Tile,
} from "../../rules/encounter";

/** How often a wanderer that cannot see the player re-plans its walk to them. */
const REPATH_MS = 700;
/** A wanderer within this many tiles with a clear line to the player stops following its route and just attacks. */
const HUNT_HANDOFF_TILES = 8;
/** How far ahead along its route a wanderer aims (tiles), when the straight line to that tile is clear. */
const LOOKAHEAD_TILES = 6;

/**
 * Wandering monsters, on a turn clock. A game turn is 60 seconds of dungeon time: at each turn roll 1d6 and on a 1
 * something comes looking (2 in 6 if there was a fight, a trap or other noise this turn). It appears out of sight
 * 12 to 18 tiles away and walks the real route to the player. `GameScene.update` calls `update(delta)`; it is not
 * called while the rest dialog or a boon/shrine dialog has the game paused, so the clock stops with the game.
 */
export class WanderController {
  private floorAgeMs = 0;
  private turnMs = 0;
  private turn = 0;
  private noisy = false;
  private spawned = 0;
  private repathMs = 0;
  private scope: GameEventScope;

  constructor(private ctx: GameContext) {
    const noise = () => this.makeNoise();
    this.scope = ctx.bus.scope()
      .on('player_hit', noise)
      .on('player_hurt', noise)
      .on('enemy_death', noise)
      .on('trap_triggered', noise)
      .on('knock', noise);
  }

  /** Raise the odds at the next game-turn check (only the next one). Other systems may call this. */
  makeNoise() {
    this.noisy = true;
  }

  /** Wanderers spawned on this visit to the floor. */
  get spawnedCount(): number {
    return this.spawned;
  }

  update(delta: number) {
    const ctx = this.ctx;
    if (!ctx.player || !ctx.enemyGroup) return;
    this.floorAgeMs += delta;
    this.updateHunters(delta);

    this.turnMs += delta;
    if (this.turnMs < GAME_TURN_MS) return;
    this.turnMs -= GAME_TURN_MS;
    this.turn++;
    ctx.bus.emit('game_turn', { turn: this.turn });

    // Noise raises the odds for this one check only.
    const noisy = this.noisy;
    this.noisy = false;
    if (ctx.modalOpen) return;
    const blocked = wanderBlockedReason({
      floor: ctx.currentFloor,
      inTombFirstChamber: this.inTombFirstChamber(),
      floorAgeMs: this.floorAgeMs,
      restDialogOpen: ctx.floor?.restDialogOpen ?? false,
      spawnedThisVisit: this.spawned,
    });
    if (blocked) return;
    if (!wanderCheck(mathRng, noisy)) return;
    this.spawnWanderer();
  }

  // ── Spawning ──────────────────────────────────────────────────────────────

  private playerTile(): Tile {
    const p = this.ctx.player;
    return { tx: Math.floor(p.x / TILE_SIZE), ty: Math.floor(p.y / TILE_SIZE) };
  }

  /** The tomb floor's first chamber: the room that holds the player start. */
  private inTombFirstChamber(): boolean {
    const ctx = this.ctx;
    if (ctx.currentFloor < TOMB_FLOOR) return false;
    const start = ctx.dungeon.playerStart;
    const here = this.playerTile();
    const room = ctx.dungeon.rooms.find(
      (r) => start.tx >= r.x - 1 && start.tx <= r.x + r.w && start.ty >= r.y - 1 && start.ty <= r.y + r.h,
    );
    if (!room) return Math.hypot(here.tx - start.tx, here.ty - start.ty) < 10;
    return here.tx >= room.x - 1 && here.tx <= room.x + room.w && here.ty >= room.y - 1 && here.ty <= room.y + room.h;
  }

  private isOpaque = (tx: number, ty: number): boolean => {
    const t = this.ctx.dungeon.tiles[ty]?.[tx];
    return t === undefined || t === TILE.WALL || t === TILE.SECRET_DOOR;
  };

  private spawnWanderer() {
    const ctx = this.ctx;
    const pool = enemyPoolForFloor(ctx.currentFloor).filter((k) => !MONSTERS[k].boss && k !== 'MIMIC');
    if (pool.length === 0) return;
    const spot = chooseWanderSpawn(mathRng, this.playerTile(), (x, y) => ctx.isWalkable(x, y), this.isOpaque);
    if (!spot) return;
    const key = pool[Math.floor(mathRng.next() * pool.length)];
    // Through the combat controller, like every other monster (the mechanism lane does the same).
    const enemy = ctx.combat.addEnemy(key, spot.tx, spot.ty);
    enemy.wandering = true;
    enemy.returnToFight(); // already hunting: no waiting for the player to wander into its aggro range
    this.spawned++;
    this.planRoute(enemy);
    ctx.status("You hear something moving in the dark.");
    ctx.bus.emit('wandering_monster', { enemyKey: key, tx: spot.tx, ty: spot.ty });
  }

  // ── Walking to the player ─────────────────────────────────────────────────

  private updateHunters(delta: number) {
    this.repathMs += delta;
    if (this.repathMs < REPATH_MS) return;
    this.repathMs = 0;
    for (const e of this.ctx.enemies) {
      if (e.wandering && e.active && e.hp > 0) this.planRoute(e);
    }
  }

  /** Point the wanderer along the walking route to the player, or free it to use its normal chase when close. */
  private planRoute(e: Enemy) {
    const ctx = this.ctx;
    const player = ctx.player;
    const from: Tile = { tx: Math.floor(e.x / TILE_SIZE), ty: Math.floor(e.y / TILE_SIZE) };
    const to = this.playerTile();
    const dist = Math.hypot(e.x - player.x, e.y - player.y) / TILE_SIZE;
    if (dist <= HUNT_HANDOFF_TILES && lineOfSight(this.isOpaque, from, to)) {
      e.hunt = null;
      return;
    }
    const path = findPath((x, y) => ctx.isWalkable(x, y), from, to);
    if (!path || path.length < 2) {
      e.hunt = null;
      return;
    }
    let aim = 1;
    const blocked = (x: number, y: number) => !ctx.isWalkable(x, y);
    for (let i = Math.min(LOOKAHEAD_TILES, path.length - 1); i > 1; i--) {
      if (lineOfSight(blocked, path[0], path[i])) { aim = i; break; }
    }
    e.hunt = { x: path[aim].tx * TILE_SIZE + TILE_SIZE / 2, y: path[aim].ty * TILE_SIZE + TILE_SIZE / 2 };
  }

  destroy() {
    this.scope.dispose();
  }
}
