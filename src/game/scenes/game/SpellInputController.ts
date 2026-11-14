import * as Phaser from "phaser";
import type { SpellKey } from "../../constants";
import { TILE_SIZE } from "../../constants";
import { SpellSystem } from "../../systems/SpellSystem";
import type { Enemy } from "../../entities/Enemy";
import type { GameContext } from "../../GameContext";
import {
  RANGE_PX, mathRng, getSpell, missileCount, damageDice, damageRoll, rollDice, monsterSave,
  type SpellDef, type SpellEffect,
} from "../../rules";
import { selectHotkeySpells, selectSleepVictims } from "./AdndCombat";

/** Minimum gap between two casts (ms). */
const CAST_GAP_MS = 500;

const SPELL_COLORS: Record<string, number> = {
  magic_missile: 0xffffff, fireball: 0xff6f00, lightning_bolt: 0xfff176, ice_storm: 0x80d8ff,
  sleep: 0x8899ff, web: 0xeeeeee, hold_person: 0xb0bec5, light: 0xfff59d, detect_magic: 0xce93d8,
  knock: 0xffcc80, cure_light_wounds: 0x69f0ae, cure_serious_wounds: 0x69f0ae, bless: 0xffd700,
  protection_from_evil: 0x7e57c2, find_traps: 0xffab40, remove_curse: 0xfff9c4, neutralize_poison: 0x69f0ae,
};

/**
 * Spell hotkeys (1 to 4) over the memorized spell slots in `player.spellbook`. Hotkey `n` casts the nth prepared
 * spell that still has a copy left; with none left it fizzles. The visuals come from `SpellSystem`; the dice,
 * saves and conditions are rolled here.
 */
export class SpellInputController {
  spellSystem!: SpellSystem;
  private spellHotkeys: Phaser.Input.Keyboard.Key[] = [];
  /**
   * Legacy mana-spell bindings read by the old HUD payload. Always empty now: the HUD gets `spellSlots` instead
   * (see `AdndHud.ts`), so an untouched HUD simply draws no spell bar.
   */
  spellHotkeyMap: SpellKey[] = [];

  constructor(private ctx: GameContext) {}

  create() {
    const scene = this.ctx.scene;
    this.spellSystem = new SpellSystem(scene);
    const codes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
    ];
    this.spellHotkeys = codes.map(c => scene.input.keyboard!.addKey(c));
    this.spellHotkeyMap = [];
  }

  /** Hotkey presses. */
  update() {
    const ctx = this.ctx;
    if (!this.spellSystem) return;
    const book = ctx.player.spellbook;

    this.spellHotkeys.forEach((key, i) => {
      if (!Phaser.Input.Keyboard.JustDown(key)) return;
      if (!book) return; // fighters and thieves have nothing on 1 to 4 (the belt lane may bind them)
      this.castSlot(i);
    });
  }

  /** Cast the spell on hotbar slot `i` (0 to 3) at the pointer. Used by the hotkeys and by right click. */
  castSlot(i: number): void {
    const ctx = this.ctx;
    const book = ctx.player.spellbook;
    if (!this.spellSystem || !book) return;
    {
      if (ctx.player.hasEffect('HELD')) return;
      if (this.spellSystem.isCooling('cast')) return;

      const ready = selectHotkeySpells(book, 4);
      const pick = ready[i];
      if (!pick) {
        ctx.status(ready.length === 0 ? "No spell left. Rest to memorize them again." : `Nothing memorized for ${i + 1}.`);
        ctx.bus.emit('spell_fizzle');
        return;
      }
      const def = getSpell(pick.key);
      if (!def) return;
      if (!this.resolve(def, false)) return; // no valid target: the spell is not spent
      book.cast(pick.key);
      this.spellSystem.startCooldown('cast', CAST_GAP_MS);
      ctx.floatText(ctx.player.x, ctx.player.y - 30, `${def.name}!`, SPELL_COLORS[def.key] ?? 0xffffff, 12);
      ctx.bus.emit('spell_cast', { key: def.key });
      ctx.emitHUD();
    }
  }

  /** Cast a spell from a scroll: the effect without a slot. False when it has nothing to act on. */
  castFromScroll(spellKey: string): boolean {
    const ctx = this.ctx;
    const def = getSpell(spellKey);
    if (!def) { ctx.status("The writing is meaningless."); return false; }
    if (!this.resolve(def, true)) return false;
    ctx.floatText(ctx.player.x, ctx.player.y - 30, `${def.name}!`, SPELL_COLORS[def.key] ?? 0xffffff, 12);
    ctx.bus.emit('spell_cast', { key: def.key });
    return true;
  }

  /** Projectile and cooldown tick (end of the frame, as before). */
  tick(delta: number) {
    if (this.spellSystem) {
      this.spellSystem.update(delta, this.ctx.enemies, this.ctx.player);
    }
  }

  // ── Targeting ──────────────────────────────────────────────────────────────

  private liveEnemies(): Enemy[] {
    return this.ctx.enemies.filter(e => e.active && e.hp > 0 && !(e.isMimic && !e.mimicRevealed));
  }

  private dist(e: { x: number; y: number }, x: number, y: number): number {
    return Phaser.Math.Distance.Between(e.x, e.y, x, y);
  }

  /**
   * Where an area spell lands: the pointer (clamped to range), snapped to a monster near it, else to the nearest
   * monster in range, else the clamped pointer.
   */
  private aimPoint(rangePx: number): { x: number; y: number; hit: boolean } {
    const ctx = this.ctx;
    const p = ctx.player;
    const ptr = ctx.scene.input.activePointer;
    let ax = ptr.worldX;
    let ay = ptr.worldY;
    if (!Number.isFinite(ax) || !Number.isFinite(ay)) { ax = p.x + p.stats.facing.x * TILE_SIZE * 3; ay = p.y + p.stats.facing.y * TILE_SIZE * 3; }
    const dx = ax - p.x;
    const dy = ay - p.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len > rangePx) { ax = p.x + (dx / len) * rangePx; ay = p.y + (dy / len) * rangePx; }

    const live = this.liveEnemies().filter(e => this.dist(e, p.x, p.y) <= rangePx + 24);
    let near: Enemy | null = null;
    let nd = 96;
    for (const e of live) {
      const d = this.dist(e, ax, ay);
      if (d < nd) { nd = d; near = e; }
    }
    if (near) return { x: near.x, y: near.y, hit: true };
    let nearest: Enemy | null = null;
    let bd = Infinity;
    for (const e of live) {
      const d = this.dist(e, p.x, p.y);
      if (d < bd) { bd = d; nearest = e; }
    }
    if (nearest) return { x: nearest.x, y: nearest.y, hit: true };
    return { x: ax, y: ay, hit: false };
  }

  // ── Effects ───────────────────────────────────────────────────────────────

  /** Apply a spell. Returns false (with a status line) when it had nothing to act on, so no slot is spent. */
  private resolve(def: SpellDef, fromScroll: boolean): boolean {
    const ctx = this.ctx;
    const level = Math.max(1, ctx.player.stats.level);
    void fromScroll;
    const e: SpellEffect = def.effect;
    const color = SPELL_COLORS[def.key] ?? 0xffffff;
    const ss = this.spellSystem;
    const p = ctx.player;

    switch (e.kind) {
      case 'missiles': {
        const targets = this.liveEnemies()
          .filter(t => this.dist(t, p.x, p.y) <= RANGE_PX[def.range])
          .sort((a, b) => this.dist(a, p.x, p.y) - this.dist(b, p.x, p.y));
        if (targets.length === 0) { ctx.status("No target in range."); return false; }
        const count = missileCount(e, level);
        const spread = Math.min(3, targets.length);
        for (let i = 0; i < count; i++) {
          const t = targets[i % spread];
          const dmg = damageRoll(e.dice, e.bonus, mathRng);
          ctx.scene.time.delayedCall(i * 90, () => {
            if (!p.active) return;
            ss.flyOrb({ x: p.x, y: p.y }, { x: t.x, y: t.y }, color, 190, () => {
              if (!t.active || t.hp <= 0) return;
              const dealt = ctx.combat.damageEnemy(t, dmg);
              ctx.floatText(t.x, t.y - 20, `-${dealt}`, 0xff9800);
              ctx.bus.emit('player_hit', { enemyKey: t.typeKey, damage: dealt, crit: false });
            });
          });
        }
        return true;
      }

      case 'damage': {
        const range = RANGE_PX[def.range];
        const aim = this.aimPoint(range);
        const dice = damageDice(e, level);
        const fire = e.element === 'fire';
        let victims: Enemy[];
        if (e.radiusPx) {
          if (!aim.hit) { ctx.status("Nothing to burn there."); return false; }
          victims = this.liveEnemies().filter(t => this.dist(t, aim.x, aim.y) <= e.radiusPx!);
          ss.flyOrb({ x: p.x, y: p.y }, aim, color, 260, () => {
            ss.blast(aim.x, aim.y, e.radiusPx!, color);
            this.applyAreaDamage(victims, e, dice, fire);
          }, 6);
          return true;
        }
        // Lightning: a line from the caster through the aim point.
        const dx = aim.x - p.x;
        const dy = aim.y - p.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        const ux = dx / len;
        const uy = dy / len;
        const ex = p.x + ux * range;
        const ey = p.y + uy * range;
        victims = this.liveEnemies().filter(t => {
          const tx = t.x - p.x;
          const ty = t.y - p.y;
          const along = tx * ux + ty * uy;
          if (along < 0 || along > range) return false;
          return Math.abs(tx * uy - ty * ux) <= 22;
        });
        if (victims.length === 0) { ctx.status("The bolt would strike nothing."); return false; }
        ss.lineFlash({ x: p.x, y: p.y }, { x: ex, y: ey }, color, 5);
        this.applyAreaDamage(victims, e, dice, fire);
        return true;
      }

      case 'heal': {
        if (p.stats.hp >= p.stats.maxHp) { ctx.status("You are already unhurt."); return false; }
        const amount = rollDice(mathRng, { count: e.dice[0], sides: e.dice[1], bonus: e.bonus ?? 0 });
        p.heal(amount);
        ss.spawnSpellEffect(p.x, p.y, color, `+${amount}`);
        return true;
      }

      case 'buff': {
        if (e.stat === 'toHit') p.addEffect('BLESSED', e.durationMs, e.amount);
        else if (e.stat === 'ac') p.addEffect('SHIELDED', e.durationMs, e.amount);
        else p.addEffect('BLESSED', e.durationMs, 1);
        ss.spawnSpellEffect(p.x, p.y, color, def.name.toUpperCase());
        return true;
      }

      case 'status': {
        const range = RANGE_PX[def.range];
        if (e.status === 'asleep') {
          const aim = this.aimPoint(range);
          if (!aim.hit) { ctx.status("Nothing there to put to sleep."); return false; }
          const near = this.liveEnemies().filter(t => this.dist(t, aim.x, aim.y) <= (e.radiusPx ?? 64));
          const ids = selectSleepVictims(
            near.map((t, i) => ({ id: i, hd: t.def.hd, undead: !!t.def.undead })),
            e.maxHd ?? 4, e.maxTargets ?? 6,
          );
          ss.blast(aim.x, aim.y, e.radiusPx ?? 64, color, 600, 0.35);
          for (const id of ids) {
            near[id].applyStatus('asleep', e.durationMs);
            ctx.floatText(near[id].x, near[id].y - 22, 'Zzz', 0x8899ff, 11);
          }
          if (ids.length === 0) ctx.status("Nothing there is weak enough, or living enough, to sleep.");
          return true;
        }
        if (e.status === 'webbed') {
          const aim = this.aimPoint(range);
          if (!aim.hit) { ctx.status("Nothing there to catch."); return false; }
          const near = this.liveEnemies().filter(t => this.dist(t, aim.x, aim.y) <= (e.radiusPx ?? 80));
          ss.blast(aim.x, aim.y, e.radiusPx ?? 80, color, 700, 0.4);
          for (const t of near) {
            const save = monsterSave(t.def.hd, e.save ?? 'breath', mathRng);
            if (save.success) { ctx.floatText(t.x, t.y - 22, 'free', 0x888899, 10); continue; }
            t.applyStatus('webbed', e.durationMs);
            ctx.floatText(t.x, t.y - 22, 'WEBBED', 0xeeeeee, 11);
          }
          return true;
        }
        // held (hold person)
        const near = this.liveEnemies()
          .filter(t => this.dist(t, p.x, p.y) <= range && !(e.undeadImmune && t.def.undead))
          .sort((a, b) => this.dist(a, p.x, p.y) - this.dist(b, p.x, p.y))
          .slice(0, e.maxTargets ?? 3);
        if (near.length === 0) { ctx.status("Nothing living in reach to hold."); return false; }
        for (const t of near) {
          const save = monsterSave(t.def.hd, e.save ?? 'spells', mathRng);
          ss.flyOrb({ x: p.x, y: p.y }, { x: t.x, y: t.y }, color, 160, () => {
            if (!t.active) return;
            if (save.success) { ctx.floatText(t.x, t.y - 22, 'resists', 0x888899, 10); return; }
            t.applyStatus('held', e.durationMs);
            ctx.floatText(t.x, t.y - 22, 'HELD', 0xb0bec5, 11);
          });
        }
        return true;
      }

      case 'detect': {
        if (e.what === 'traps') {
          const tiles = Math.ceil(e.radiusPx / TILE_SIZE);
          const ptx = Math.floor(p.x / TILE_SIZE);
          const pty = Math.floor(p.y / TILE_SIZE);
          let found = 0;
          for (const [key, type] of ctx.traps.trapMap) {
            const [tx, ty] = key.split(',').map(Number);
            if (Math.hypot(tx - ptx, ty - pty) > tiles || ctx.traps.detectedTraps.has(key)) continue;
            ctx.traps.detectTrap(key, tx, ty, type, 'search');
            found++;
          }
          ctx.bus.emit('detect_traps', { radiusTiles: tiles, durationMs: e.durationMs });
          ss.blast(p.x, p.y, e.radiusPx, color, 700, 0.25);
          ctx.status(found > 0 ? `Find Traps: ${found} hidden hazard${found > 1 ? 's' : ''} revealed.` : "Find Traps: the floor around you is honest.");
          return true;
        }
        if (e.what === 'magic') {
          const n = ctx.loot.pulseMagicItems(e.radiusPx);
          ss.blast(p.x, p.y, e.radiusPx, color, 700, 0.25);
          ctx.status(n > 0 ? `Detect Magic: ${n} enchanted thing${n > 1 ? 's' : ''} glow nearby.` : "Detect Magic: nothing nearby glows.");
          return true;
        }
        ctx.status("You sense nothing.");
        return true;
      }

      case 'light': {
        p.lightBoost = { radius: e.radiusTiles, ms: e.durationMs };
        p.recomputeDerived();
        ss.spawnSpellEffect(p.x, p.y, color, 'LIGHT');
        return true;
      }

      case 'unlock': {
        const aim = this.aimPoint(RANGE_PX[def.range]);
        const fx = p.stats.facing.x || 0;
        const fy = p.stats.facing.y || 1;
        const px = aim.hit ? aim.x : (p.x + fx * TILE_SIZE);
        const py = aim.hit ? aim.y : (p.y + fy * TILE_SIZE);
        const tx = Math.floor(px / TILE_SIZE);
        const ty = Math.floor(py / TILE_SIZE);
        const chestOpened = ctx.loot.knockChestNear(p.x, p.y, TILE_SIZE * 3);
        ctx.bus.emit('knock', { tx, ty });
        ss.spawnSpellEffect(px, py, color, 'KNOCK');
        if (!chestOpened) ctx.status("Knock: you feel a lock somewhere give, or nothing at all.");
        return true;
      }

      case 'cure': {
        if (e.what === 'poison') {
          if (!p.hasEffect('POISONED')) { ctx.status("You are not poisoned."); return false; }
          p.removeEffect('POISONED');
          ss.spawnSpellEffect(p.x, p.y, color, 'CURED');
          return true;
        }
        if (e.what === 'curse') {
          const target = p.inventory.items().find(i => i.cursed);
          if (!target) { ctx.status("Nothing you carry is cursed."); return false; }
          p.inventory.removeCurse(target.id);
          p.recomputeDerived();
          ss.spawnSpellEffect(p.x, p.y, color, 'CURSE LIFTED');
          return true;
        }
        ctx.status("You are not diseased.");
        return false;
      }
    }
  }

  /** Roll one damage total, then each victim saves (monster saves by hit dice) for half where the spell allows. */
  private applyAreaDamage(
    victims: Enemy[], e: Extract<SpellEffect, { kind: 'damage' }>, dice: readonly [number, number], fire: boolean,
  ) {
    const ctx = this.ctx;
    const total = rollDice(mathRng, { count: dice[0], sides: dice[1], bonus: e.bonus ?? 0 });
    for (const t of victims) {
      if (!t.active || t.hp <= 0) continue;
      let dmg = total;
      if (e.save) {
        const save = monsterSave(t.def.hd, e.save, mathRng);
        if (save.success) {
          if (e.saveHalves) { dmg = Math.max(1, Math.floor(total / 2)); ctx.floatText(t.x, t.y - 34, 'saved', 0x888899, 9); }
          else continue;
        }
      }
      const dealt = ctx.combat.damageEnemy(t, dmg, { fire });
      ctx.floatText(t.x, t.y - 20, `-${dealt}`, 0xff9800);
      ctx.bus.emit('player_hit', { enemyKey: t.typeKey, damage: dealt, crit: false });
    }
  }

  destroy() {
    this.spellSystem?.destroy();
  }
}
