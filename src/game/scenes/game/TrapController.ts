import * as Phaser from "phaser";
import { TILE_SIZE, TILE, TRAP_TYPES, TrapTypeKey } from "../../constants";
import type { GameContext } from "../../GameContext";
import { SEARCH_MS } from "./MechVerbs";

/** Floors on which the legacy random tile traps deal half damage. */
const TEACHING_FLOORS = 3;

/**
 * The legacy random tile traps (reflex/fortitude save) and the legacy secret doors:
 * detect, search (G), disarm (D, thief), trigger, reveal.
 * The new authored mechanisms live in `MechanismController`, not here. The G key starts a timed search
 * (`MechanismController.beginTimed`); when it finishes, the legacy search below and the authored `search`
 * event both run for the tile the player stands on.
 */
export class TrapController {
  // ── Trap detection ─────────────────────────────────────────────────────────
  readonly detectedTraps = new Set<string>();
  readonly warnedTrapKeys = new Set<string>();
  private trapOverlays = new Map<string, Phaser.GameObjects.Image>();

  // ── Secret door tracking (filled by MapController.buildTilemap) ────────────
  readonly secretDoorSet = new Set<string>();
  readonly secretDoorSprites = new Map<string, Phaser.GameObjects.Image>();

  // ── Trap tile tracking (filled by MapController.buildTilemap) ──────────────
  readonly trapMap = new Map<string, TrapTypeKey>();

  private _gKey?: Phaser.Input.Keyboard.Key;
  private _dKey?: Phaser.Input.Keyboard.Key;

  constructor(private ctx: GameContext) {}

  /** Same order as the old update loop: detect, search key, disarm key, trigger, secret-door hover. */
  update(ptx: number, pty: number) {
    this.checkTrapDetection(ptx, pty);
    this.checkSearchKey();
    this.checkDisarmKey(ptx, pty);
    this.checkTrapTriggering(ptx, pty);
    this.checkSecretDoors(ptx, pty);
  }

  // ── Trap Detection ────────────────────────────────────────────────────────

  /** Passive auto-detection for Thief; updates visual overlays. */
  private checkTrapDetection(ptx: number, pty: number) {
    const { classKey } = this.ctx.player.stats;
    const autoRange = classKey === 'thief' ? 4 : 0;

    for (const [key, trapType] of this.trapMap) {
      const [tx, ty] = key.split(',').map(Number);
      const dist = Math.abs(tx - ptx) + Math.abs(ty - pty);

      if (!this.detectedTraps.has(key) && dist <= autoRange) {
        this.detectTrap(key, tx, ty, trapType, classKey === 'thief' ? 'auto' : 'search');
      }
    }
  }

  detectTrap(key: string, tx: number, ty: number, trapType: TrapTypeKey, source: 'auto' | 'search') {
    if (this.detectedTraps.has(key)) return;
    this.detectedTraps.add(key);

    const wx = tx * TILE_SIZE + TILE_SIZE / 2;
    const wy = ty * TILE_SIZE + TILE_SIZE / 2;

    // Red X overlay on floor tile
    if (!this.trapOverlays.has(key)) {
      const overlay = this.ctx.scene.add.image(wx, wy, "trap_detected").setDepth(3).setAlpha(0.85);
      this.trapOverlays.set(key, overlay);
    }

    const msg = source === 'auto'
      ? `⚠ Trap detected: ${TRAP_TYPES[trapType].key} — press D to disarm`
      : `⚠ Found a trap: ${TRAP_TYPES[trapType].key}`;
    this.ctx.floatText(wx, wy - 20, '⚠ TRAP', 0xff1744, 11);
    this.ctx.status(msg);
  }

  /** G key: a careful search takes about a second, then looks for legacy traps, secret doors and tomb mechanisms. */
  private checkSearchKey() {
    const scene = this.ctx.scene;
    if (!this._gKey) this._gKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.G);
    if (!Phaser.Input.Keyboard.JustDown(this._gKey)) return;
    this.ctx.mech.beginTimed('Searching', SEARCH_MS, () => {
      const p = this.ctx.player;
      if (p.stats.hp <= 0) return;
      this.searchNow(Math.floor(p.x / TILE_SIZE), Math.floor(p.y / TILE_SIZE));
      this.ctx.mech.searchHere();
    });
  }

  /** The legacy search: area scan for traps AND secret doors around a tile. */
  private searchNow(ptx: number, pty: number) {
    const searchBonus = this.ctx.player.stats.searchBonus;
    const roll = Math.floor(Math.random() * 20) + 1 + searchBonus;
    const trapDC = 12;
    const doorDC = 15;
    const range = 3;
    let found = 0;

    // Search for traps
    for (const [key, trapType] of this.trapMap) {
      if (this.detectedTraps.has(key)) continue;
      const [tx, ty] = key.split(',').map(Number);
      if (Math.abs(tx - ptx) <= range && Math.abs(ty - pty) <= range) {
        if (roll >= trapDC) {
          this.detectTrap(key, tx, ty, trapType, 'search');
          found++;
        }
      }
    }

    // Search for secret doors
    for (const key of this.secretDoorSet) {
      const [stx, sty] = key.split(',').map(Number);
      if (Math.abs(stx - ptx) <= range && Math.abs(sty - pty) <= range) {
        if (roll >= doorDC) {
          this.revealSecretDoor(stx, sty, key);
          found++;
        }
      }
    }

    if (found === 0) {
      this.ctx.status(`Search: nothing found (rolled ${roll})`);
    }
  }

  /** D key: Thief disarms a detected trap within 1 tile. */
  private checkDisarmKey(ptx: number, pty: number) {
    if (this.ctx.player.stats.classKey !== 'thief') return;
    const scene = this.ctx.scene;
    if (!this._dKey) this._dKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D);
    if (!Phaser.Input.Keyboard.JustDown(this._dKey)) return;

    for (const key of this.detectedTraps) {
      const [tx, ty] = key.split(',').map(Number);
      if (Math.abs(tx - ptx) > 1 || Math.abs(ty - pty) > 1) continue;

      const trapType = this.trapMap.get(key);
      if (!trapType) continue;

      const disableBonus = this.ctx.player.stats.disableBonus;
      const roll = Math.floor(Math.random() * 20) + 1 + disableBonus;
      const dc = TRAP_TYPES[trapType]?.dc ?? 12;

      if (roll >= dc) {
        // Disarm success
        this.trapMap.delete(key);
        this.detectedTraps.delete(key);
        this.warnedTrapKeys.delete(key);
        this.ctx.persist.triggeredTrapKeys.add(key); // mark as dealt with
        this.trapOverlays.get(key)?.destroy();
        this.trapOverlays.delete(key);
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;
        this.ctx.floatText(wx, wy - 20, 'Disarmed!', 0x69f0ae, 12);
        this.ctx.status(`Trap disarmed! (rolled ${roll} vs DC ${dc})`);
      } else {
        // Disarm failure — trigger the trap
        this.ctx.status(`Disarm failed! (rolled ${roll} vs DC ${dc})`);
        this.triggerTrap(trapType, tx, ty, key);
      }
      break; // only attempt one disarm per keypress
    }
  }

  /** Called on the player's current tile — triggers if trap present. */
  private checkTrapTriggering(ptx: number, pty: number) {
    const player = this.ctx.player;
    const trapKey = `${ptx},${pty}`;
    const trapType = this.trapMap.get(trapKey);
    if (!trapType) return;

    // Detected traps: give +4 save bonus (player saw it coming)
    const isDetected = this.detectedTraps.has(trapKey);
    if (isDetected) {
      if (!this.warnedTrapKeys.has(trapKey)) {
        const msg = player.stats.classKey === 'thief'
          ? 'Known trap ahead. Press D beside it to disarm, or route around it.'
          : 'Known trap ahead. Route around it or risk another path.';
        this.ctx.status(msg);
        this.ctx.floatText(player.x, player.y - 34, 'TRAP AHEAD', 0xffd166, 11);
        this.warnedTrapKeys.add(trapKey);
      }
      return;
    }

    this.triggerTrap(trapType, ptx, pty, trapKey, isDetected ? 4 : 0);

    // Clean up detection overlay
    this.detectedTraps.delete(trapKey);
    this.warnedTrapKeys.delete(trapKey);
    this.trapOverlays.get(trapKey)?.destroy();
    this.trapOverlays.delete(trapKey);
  }

  // ── Secret Doors ──────────────────────────────────────────────────────────

  private checkSecretDoors(ptx: number, pty: number) {
    const scene = this.ctx.scene;
    const { classKey } = this.ctx.player.stats;
    const autoRange = classKey === 'thief' ? 3 : 2;

    for (const key of this.secretDoorSet) {
      const [stx, sty] = key.split(',').map(Number);
      const dx = ptx - stx;
      const dy = pty - sty;
      const inRange = Math.abs(dx) <= autoRange && Math.abs(dy) <= autoRange;

      const sprite = this.secretDoorSprites.get(key);
      if (inRange) {
        if (sprite) sprite.setTint(0x448aff);
        // Click to search
        if (scene.input.activePointer.isDown) {
          const clickTx = Math.floor(scene.input.activePointer.worldX / TILE_SIZE);
          const clickTy = Math.floor(scene.input.activePointer.worldY / TILE_SIZE);
          if (clickTx === stx && clickTy === sty) {
            this.revealSecretDoor(stx, sty, key);
          }
        }
      } else {
        if (sprite) sprite.clearTint();
      }
    }
  }

  revealSecretDoor(tx: number, ty: number, key: string) {
    if (!this.secretDoorSet.has(key)) return;
    const searchBonus = this.ctx.player.stats.searchBonus;
    const roll = Math.floor(Math.random() * 20) + 1 + searchBonus;

    if (roll >= 15) {
      this.ctx.dungeon.tiles[ty][tx] = TILE.FLOOR;
      this.ctx.persist.revealedDoorKeys.add(key);

      const wx = tx * TILE_SIZE + TILE_SIZE / 2;
      const wy = ty * TILE_SIZE + TILE_SIZE / 2;

      // Remove physics wall
      const members = this.ctx.wallGroup.getChildren();
      for (const m of members) {
        const r = m as Phaser.GameObjects.Rectangle;
        if (Math.abs(r.x - wx) < 2 && Math.abs(r.y - wy) < 2) {
          r.destroy(); break;
        }
      }

      const sprite = this.secretDoorSprites.get(key);
      if (sprite) { sprite.setTexture("secret_door_open"); sprite.clearTint(); }

      this.secretDoorSet.delete(key);
      this.secretDoorSprites.delete(key);
      this.ctx.floatText(wx, wy - 20, 'Secret door!', 0x448aff, 13);
      this.ctx.status(`Secret door revealed! (rolled ${roll})`);
      this.ctx.bus.emit('door_secret_found');
    } else {
      this.ctx.status(`Search failed (rolled ${roll}, need 15)`);
    }
  }

  // ── Traps ─────────────────────────────────────────────────────────────────

  triggerTrap(type: TrapTypeKey, tx: number, ty: number, mapKey: string, saveBonus = 0) {
    const def = TRAP_TYPES[type];
    const player = this.ctx.player;
    const s = player.stats;

    this.trapMap.delete(mapKey);
    this.warnedTrapKeys.delete(mapKey);
    this.ctx.dungeon.tiles[ty][tx] = TILE.FLOOR;
    this.ctx.persist.triggeredTrapKeys.add(mapKey);
    this.ctx.bus.emit('trap_triggered', { type });

    const wx = tx * TILE_SIZE + TILE_SIZE / 2;
    const wy = ty * TILE_SIZE + TILE_SIZE / 2;
    this.ctx.floatText(wx, wy - 20, def.description, def.color, 12);
    this.ctx.scene.cameras.main.shake(100, 0.006);

    if (def.saveStat === 'none') { this.doAlarmEffect(); return; }

    const baseSave = def.saveStat === 'reflex' ? s.reflexSave : s.fortSave;
    const roll = Math.floor(Math.random() * 20) + 1 + baseSave + saveBonus;
    const saved = roll >= def.dc;

    if (saved) {
      const label = saveBonus > 0 ? `SAVED! Saw it coming! (${roll})` : `SAVED! (${roll})`;
      this.ctx.floatText(player.x, player.y - 40, label, 0x69f0ae, 12);
      return;
    }

    if (def.damage[0] > 0) {
      let dmg = 0;
      for (let i = 0; i < def.damage[1]; i++) dmg += Math.floor(Math.random() * def.damage[0]) + 1;
      // Teaching floors: the random tile traps hurt half as much on floors 1 to 3.
      if (this.ctx.currentFloor <= TEACHING_FLOORS) dmg = Math.max(1, Math.floor(dmg / 2));
      player.takeDamage(dmg, false);
    }
    if (def.effect === 'POISONED') player.addEffect('POISONED', def.effectDuration ?? 5000, 3);
    else if (def.effect === 'SLOWED') player.addEffect('SLOWED', def.effectDuration ?? 4000);

    this.ctx.status(`${def.description} Failed save (${roll} vs DC ${def.dc})`);
  }

  private doAlarmEffect() {
    const player = this.ctx.player;
    const px = player.x;
    const py = player.y;
    let count = 0;
    for (const enemy of this.ctx.enemies) {
      if (!enemy.active) continue;
      const dx = enemy.x - px;
      const dy = enemy.y - py;
      if (Math.sqrt(dx * dx + dy * dy) < 300) { enemy.update(0, px, py); count++; }
    }
    this.ctx.scene.cameras.main.shake(150, 0.01);
    this.ctx.status(`ALARM! ${count} enemies alerted!`);
  }

  destroy() {
    this.trapOverlays.forEach(o => o.destroy());
    this.trapOverlays.clear();
  }
}
