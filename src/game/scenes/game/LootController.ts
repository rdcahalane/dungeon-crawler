import * as Phaser from "phaser";
import { TILE_SIZE, COLORS, abilityMod } from "../../constants";
import { onChestOpened } from "../../systems/QuestSystem";
import { TreasureChest, type ChestInteractResult } from "../../entities/TreasureChest";
import type { Enemy } from "../../entities/Enemy";
import type { GameContext } from "../../GameContext";
import { mathRng, rollDice, thiefSkill } from "../../rules";
import {
  getDef, displayName, upgradeNote, rarityColor, rollDrop, rollItem, makeItem,
  type Drop, type EquipSlot, type ItemInstance, type UseEffect, type ItemDef,
} from "../../items";
import { packGroundItems, unpackGroundItems, type SavedGroundItem } from "./groundPersist";
import { resolveInteract } from "./interactArbiter";
import { graveyard } from "../../systems/Graveyard";
import type { Unsubscribe } from "../../GameEvents";
import {
  HEALING_POTION_DICE, HEALING_POTION_BONUS, foeTagsFor,
} from "./AdndCombat";

/** One thing lying on the floor: an item stack, a pile of gold, or the legacy cursed shrine. */
interface GroundEntry {
  sprite: Phaser.GameObjects.Sprite;
  label?: Phaser.GameObjects.Text;
  item?: ItemInstance;
  gold?: number;
  /** The old floor-item spawn key, so a picked-up spawn stays gone when the floor is revisited. */
  spawnKey?: string;
  legacyType?: string;
  /** A dead character's bones: walking onto them gives the gold and removes the record. */
  bones?: { name: string };
  /** Dropped by the player: do not walk-pick it back up until they step off the tile. */
  needsLeave?: boolean;
  /** Put down by the player: lifting it again tells the mechanisms (a pressure plate lets go). */
  dropped?: boolean;
  fullWarned?: boolean;
}

const PICKUP_RANGE = TILE_SIZE * 0.8;
const GOLD_MAGNET = TILE_SIZE * 1.5;
/** Reach of a thrown flask of holy water. */
const THROW_RANGE = 224;
/** How close the player must stand to a chest to work it with E. */
const CHEST_REACH = TILE_SIZE * 1.2;

/** Treasure is experience: every gold piece the dungeon pays is worth this much XP. Shop, inn and quest gold in the tavern is not. */
export const XP_PER_GOLD = 1;

/** "+12 gp +12 xp", the text on a gold pickup. */
export function goldGainText(gold: number): string {
  return `+${gold} gp +${gold * XP_PER_GOLD} xp`;
}

/**
 * Items on the floor (all of it from `src/game/items`), chests, picking things up, and using or moving what is
 * in the inventory: belt, potions (F), equip, unequip, drop.
 */
export class LootController {
  private ground: GroundEntry[] = [];
  private chests: TreasureChest[] = [];

  private _eKey?: Phaser.Input.Keyboard.Key;
  private _fKey?: Phaser.Input.Keyboard.Key;
  private _offGoldXp?: Unsubscribe;

  constructor(private ctx: GameContext) {
    // Every gold piece `ctx.addGold` pays out in the dungeon is also experience. The bus fires once per payout
    // (floor gold, chests, room and objective rewards), and the tavern never goes through it.
    this._offGoldXp = ctx.bus.on('gold', ({ amount }) => {
      if (amount > 0) ctx.player?.gainXP(amount * XP_PER_GOLD);
    });
    // The optional members other lanes call through the context.
    ctx.useBelt = (i: number) => this.useBelt(i);
    ctx.dropItem = (id: string) => this.dropItem(id);
    ctx.equipItem = (id: string) => this.equipItem(id);
    ctx.unequipSlot = (slot: EquipSlot) => this.unequipSlot(slot);
  }

  /** Chest interaction, floor pickup, potion key. */
  update() {
    this.checkChestInteraction();
    this.checkItemPickup();
    this.checkPotionInput();
  }

  // ── Placing things on the floor ──────────────────────────────────────────

  private textureFor(item: ItemInstance): string {
    const scene = this.ctx.scene;
    const def = getDef(item.defKey);
    if (scene.textures.exists(def.icon)) return def.icon;
    switch (def.kind) {
      case 'weapon': return 'item_weapon';
      case 'armor': case 'shield': return 'item_armor';
      case 'consumable': return def.use?.type === 'heal' ? 'item_health_potion' : 'item_scroll';
      case 'treasure': return 'item_gold';
      default: return 'item_xp_orb';
    }
  }

  private makeLabel(x: number, y: number, text: string, color: number): Phaser.GameObjects.Text {
    return this.ctx.scene.add.text(x, y + 14, text, {
      fontSize: '9px',
      color: `#${color.toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(6);
  }

  private addBob(sprite: Phaser.GameObjects.Sprite, y: number) {
    this.ctx.scene.tweens.add({
      targets: sprite, y: y - 4, duration: 1000, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });
  }

  /** Lay an item on the floor at a world position. */
  placeItem(item: ItemInstance, x: number, y: number, extra: Partial<GroundEntry> = {}): GroundEntry {
    const scene = this.ctx.scene;
    const sprite = scene.add.sprite(x, y, this.textureFor(item)).setDepth(3);
    sprite.setDisplaySize(TILE_SIZE - 6, TILE_SIZE - 6);
    const label = this.makeLabel(x, y, displayName(item, { quantity: true }), rarityColor(item));
    this.addBob(sprite, y);
    const entry: GroundEntry = { sprite, label, item, ...extra };
    this.ground.push(entry);
    return entry;
  }

  /** Lay gold on the floor; walking near it picks it up. */
  placeGold(amount: number, x: number, y: number): GroundEntry {
    const scene = this.ctx.scene;
    const tex = scene.textures.exists('item_gold') ? 'item_gold' : 'item_gem';
    const sprite = scene.add.sprite(x, y, tex).setDepth(3);
    sprite.setDisplaySize(TILE_SIZE - 10, TILE_SIZE - 10);
    const label = this.makeLabel(x, y, `${amount} gp`, COLORS.GOLD_TEXT);
    this.addBob(sprite, y);
    const entry: GroundEntry = { sprite, label, gold: amount };
    this.ground.push(entry);
    return entry;
  }

  /** Put a whole drop on the floor around a point, items scattered on nearby walkable tiles. */
  scatterDrop(drop: Drop, x: number, y: number) {
    const ctx = this.ctx;
    if (drop.gold > 0) this.placeGold(drop.gold, x, y);
    const ptx = Math.floor(x / TILE_SIZE);
    const pty = Math.floor(y / TILE_SIZE);
    const spots: Array<[number, number]> = [[ptx, pty]];
    for (let r = 1; r <= 2; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) === r && ctx.isWalkable(ptx + dx, pty + dy)) spots.push([ptx + dx, pty + dy]);
        }
      }
    }
    drop.items.forEach((item, i) => {
      const [tx, ty] = spots[i % spots.length];
      this.placeItem(item, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
    });
  }

  /** A monster died: roll its drop and leave it where it fell. */
  dropFromMonster(enemy: Enemy) {
    const ctx = this.ctx;
    const def = enemy.def;
    const drop = rollDrop({ type: 'monster', hd: def.hd, boss: def.boss }, ctx.currentFloor, mathRng);
    if (enemy.isElite && !def.boss) drop.items.push(rollItem({ floor: ctx.currentFloor, rarityBias: 3 }, mathRng));
    if (drop.gold <= 0 && drop.items.length === 0) return;
    this.scatterDrop(drop, enemy.x, enemy.y);
  }

  /** Detect Magic: pulse every enchanted item on the floor within range. Returns how many. */
  pulseMagicItems(radiusPx: number): number {
    const p = this.ctx.player;
    let n = 0;
    for (const g of this.ground) {
      const item = g.item;
      if (!item || !g.sprite.active) continue;
      if (item.rarity === 'common' && !item.cursed && item.affixes.length === 0 && item.plus === 0) continue;
      if (Phaser.Math.Distance.Between(p.x, p.y, g.sprite.x, g.sprite.y) > radiusPx) continue;
      n++;
      this.ctx.scene.tweens.add({ targets: g.sprite, scaleX: g.sprite.scaleX * 1.5, scaleY: g.sprite.scaleY * 1.5, duration: 280, yoyo: true, repeat: 5 });
    }
    return n;
  }

  /** Put an item (by catalog key) on the floor at a tile. Used by the mechanism lane's `grant` effect. */
  placeDef(defKey: string, tx: number, ty: number, quantity = 1): ItemInstance {
    const item = makeItem(defKey, mathRng, quantity);
    this.placeItem(item, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2);
    return item;
  }

  /** Straight into the pack if it fits, else onto the floor at the player's feet. */
  giveItem(defKey: string, quantity = 1): ItemInstance {
    const ctx = this.ctx;
    const item = makeItem(defKey, mathRng, quantity);
    const r = ctx.player.inventory.add(item);
    if (r.ok) {
      this.afterInventoryChange();
    } else {
      this.placeItem(item, ctx.player.x, ctx.player.y);
      ctx.status("Your pack is full; it falls at your feet.");
    }
    return item;
  }

  // ── Floor spawns from the dungeon generator ──────────────────────────────

  spawnItems() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    for (const spawn of ctx.dungeon.items) {
      const key = `${spawn.tx},${spawn.ty}`;
      if (ctx.persist.pickedItemKeys.has(key)) continue; // already picked in prior session

      const ix = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const iy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;

      if (spawn.type === 'CURSED_SHRINE') {
        const sprite = scene.add.sprite(ix, iy, 'decal_shrine').setDepth(3);
        this.addBob(sprite, iy);
        this.ground.push({ sprite, spawnKey: key, legacyType: 'CURSED_SHRINE' });
        continue;
      }

      // The old pickups become real items: potions, weapons, armor, and treasure in place of XP orbs.
      let item: ItemInstance;
      if (spawn.type === 'HEALTH_POTION') item = makeItem('healing_potion', mathRng);
      else if (spawn.type === 'WEAPON') item = rollItem({ floor: ctx.currentFloor, kind: 'weapon' }, mathRng);
      else if (spawn.type === 'ARMOR') item = rollItem({ floor: ctx.currentFloor, kind: 'armor' }, mathRng);
      else item = rollItem({ floor: ctx.currentFloor, kind: 'treasure' }, mathRng);
      this.placeItem(item, ix, iy, { spawnKey: key });
    }

    // Things left lying on this floor on an earlier visit. The mechanism state is saved separately and already counts
    // any that sit on a pressure plate, so nothing is announced to it here.
    for (const s of unpackGroundItems(ctx.persist.groundItems)) {
      const entry = this.placeItem(s.item, s.tx * TILE_SIZE + TILE_SIZE / 2, s.ty * TILE_SIZE + TILE_SIZE / 2);
      if (s.dropped) entry.dropped = true;
    }

    this.spawnBones();
  }

  // ── Bones ─────────────────────────────────────────────────────────────────

  /**
   * If an earlier character died on this floor, their bones lie here with the gold they carried. The recorded tile came
   * from a different layout (floors are generated fresh for each new character), so the pile goes on the nearest walkable
   * tile, never within two tiles of where you arrive. The tomb is one fixed map, so there it lands exactly where they fell.
   */
  private spawnBones() {
    const ctx = this.ctx;
    const rec = graveyard.bonesOn(ctx.currentFloor);
    if (!rec) return;
    const start = ctx.dungeon.playerStart;
    const ok = (tx: number, ty: number) =>
      ctx.isWalkable(tx, ty) && Math.max(Math.abs(tx - start.tx), Math.abs(ty - start.ty)) > 2;
    let spot: { tx: number; ty: number } | null = ok(rec.tx, rec.ty) ? { tx: rec.tx, ty: rec.ty } : null;
    for (let r = 1; !spot && r <= 40; r++) {
      for (let dy = -r; dy <= r && !spot; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          if (ok(rec.tx + dx, rec.ty + dy)) { spot = { tx: rec.tx + dx, ty: rec.ty + dy }; break; }
        }
      }
    }
    if (!spot) return;
    const scene = ctx.scene;
    const x = spot.tx * TILE_SIZE + TILE_SIZE / 2;
    const y = spot.ty * TILE_SIZE + TILE_SIZE / 2;
    const tex = scene.textures.exists('mech_bones') ? 'mech_bones' : 'item_gem';
    const sprite = scene.add.sprite(x, y, tex).setDepth(3);
    sprite.setDisplaySize(TILE_SIZE - 6, TILE_SIZE - 6);
    const label = this.makeLabel(x, y, `Bones of ${rec.name}`, COLORS.GOLD_TEXT);
    this.ground.push({ sprite, label, gold: rec.gold, bones: { name: rec.name } });
  }

  /** True when walking or pressing E would pick something up right now. The stairs ask this so one E never does two jobs. */
  pickupInReach(): boolean {
    const p = this.ctx.player;
    if (!p) return false;
    return this.ground.some((g) =>
      g.sprite.active && !g.needsLeave &&
      Phaser.Math.Distance.Between(p.x, p.y, g.sprite.x, g.sprite.y) < TILE_SIZE * 1.0);
  }

  /** Items on the floor right now, for the floor save. */
  serializeGround(): SavedGroundItem[] {
    const live = this.ground
      .filter((g) => g.sprite.active && g.item)
      .map((g) => ({ item: g.item, x: g.sprite.x, y: g.sprite.y, spawnKey: g.spawnKey, dropped: g.dropped }));
    return packGroundItems(live, TILE_SIZE);
  }

  /** Pixels to the nearest unopened chest within reach of E, or `Infinity` when there is none. */
  nearestChestDistance(): number {
    const p = this.ctx.player;
    if (!p) return Infinity;
    let best = Infinity;
    for (const chest of this.chests) {
      if (!chest.active) continue;
      const d = Math.hypot(p.x - chest.x, p.y - chest.y);
      if (d <= CHEST_REACH && d < best) best = d;
    }
    return best;
  }

  // ── Chests ────────────────────────────────────────────────────────────────

  spawnChests() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    for (const spawn of ctx.dungeon.chests) {
      const key = `${spawn.tx},${spawn.ty}`;
      if (ctx.persist.openedChestKeys.has(key)) continue; // already opened in prior session

      const cx = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;

      const chest = new TreasureChest(scene, cx, cy, spawn.tier, spawn.trapped, spawn.isMimic);

      if (spawn.isMimic) {
        chest.onMimicReveal = (mx, my) => {
          const enemy = ctx.combat.addEnemy('MIMIC', Math.floor(mx / TILE_SIZE), Math.floor(my / TILE_SIZE));
          enemy.revealMimic();
          ctx.floatText(mx, my - 30, 'MIMIC!', 0xffd700, 16);
          scene.cameras.main.shake(120, 0.008);
        };
      }

      this.chests.push(chest);
    }
  }

  /** Knock: spring the nearest closed chest within `rangePx` of a point. Returns true if one opened. */
  knockChestNear(x: number, y: number, rangePx: number): boolean {
    let best: TreasureChest | null = null;
    let bestD = rangePx;
    for (const chest of this.chests) {
      if (!chest.active || chest.chestState === 'open') continue;
      const d = Phaser.Math.Distance.Between(x, y, chest.x, chest.y);
      if (d <= bestD) { bestD = d; best = chest; }
    }
    if (!best) return false;
    const result = best.forceOpen(this.ctx.currentFloor);
    if (!result) return false;
    this.finishChestOpen(best, result);
    return true;
  }

  private checkChestInteraction() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const player = ctx.player;
    if (!this._eKey) this._eKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    const s = player.stats;
    // One press of E does one thing: if a mechanism is nearer than the chest it takes the press instead.
    const chestFirst = resolveInteract(this.nearestChestDistance(), ctx.mech.nearestInteractDistance()) === 'chest';
    const nearest = this.nearestChestDistance();

    for (let i = this.chests.length - 1; i >= 0; i--) {
      const chest = this.chests[i];
      if (!chest.active) { this.chests.splice(i, 1); continue; }

      const dx = player.x - chest.x;
      const dy = player.y - chest.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const inRange = dist <= CHEST_REACH;
      chest.setPromptVisible(inRange);

      if (inRange && dist <= nearest && chestFirst && Phaser.Input.Keyboard.JustDown(this._eKey)) {
        const openPct = thiefSkill(s.classKey, s.level, 'openLocks') + (player.inventory.has('thieves_tools') ? 10 : 0);
        const result = chest.tryOpen(s.classKey, abilityMod(s.str), abilityMod(s.dex), s.level, ctx.currentFloor, openPct);
        if (result.message) ctx.status(result.message);

        if (result.trapTriggered) {
          const tx = Math.floor(chest.x / TILE_SIZE);
          const ty = Math.floor(chest.y / TILE_SIZE);
          ctx.traps.triggerTrap(result.trapTriggered, tx, ty, `${tx},${ty}`);
        }

        if (result.opened && result.loot) this.finishChestOpen(chest, result);
      }
    }
  }

  private finishChestOpen(chest: TreasureChest, result: ChestInteractResult) {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!result.opened || !result.loot) return;
    ctx.bus.emit('chest_open');
    // Record chest as opened for persistence
    const chestTx = Math.round((chest.x - TILE_SIZE / 2) / TILE_SIZE);
    const chestTy = Math.round((chest.y - TILE_SIZE / 2) / TILE_SIZE);
    ctx.persist.openedChestKeys.add(`${chestTx},${chestTy}`);
    this.applyChestObjectiveProgress(chestTx, chestTy);

    // Quest progress: chest opened
    if (player.stats.activeQuests) onChestOpened(player.stats.activeQuests);

    const { gold, items } = result.loot;
    let paid = 0;
    if (gold > 0) {
      paid = ctx.hasRelic('chest_contract') ? gold * 2 : gold;
      ctx.addGold(paid);
      if (ctx.hasRelic('chest_contract')) {
        player.takeDamage(Math.max(1, Math.floor(player.stats.maxHp * 0.04)));
        ctx.floatText(chest.x, chest.y - 38, 'PACT PAID', 0xce93d8, 11);
      }
      ctx.floatText(chest.x, chest.y - 20, goldGainText(paid), COLORS.GOLD_TEXT);
    }
    // The items spill onto the floor around the chest; walk over them or press E.
    this.scatterDrop({ gold: 0, items }, chest.x, chest.y);
    this.afterInventoryChange();
  }

  private applyChestObjectiveProgress(tx: number, ty: number) {
    const ctx = this.ctx;
    const objective = ctx.dungeon.floorObjective;
    if (!objective || ctx.run.floorObjectiveComplete || objective.type !== 'RAID_VAULT') return;
    const room = objective.roomIdx !== undefined ? ctx.dungeon.rooms[objective.roomIdx] : undefined;
    if (!room) return;
    if (tx < room.x || tx >= room.x + room.w || ty < room.y || ty >= room.y + room.h) return;

    ctx.run.floorObjectiveProgress = Math.min(objective.targetCount, ctx.run.floorObjectiveProgress + 1);
    if (ctx.run.floorObjectiveProgress >= objective.targetCount) ctx.rooms.completeFloorObjective();
  }

  // ── Picking up ────────────────────────────────────────────────────────────

  private checkItemPickup() {
    const ctx = this.ctx;
    const player = ctx.player;
    if (!this._eKey) this._eKey = ctx.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    const pressed = Phaser.Input.Keyboard.JustDown(this._eKey);
    let pressedUsed = false;

    for (let i = this.ground.length - 1; i >= 0; i--) {
      const g = this.ground[i];
      if (!g.sprite.active) { this.ground.splice(i, 1); continue; }
      const d = Phaser.Math.Distance.Between(player.x, player.y, g.sprite.x, g.sprite.y);

      if (g.needsLeave && d > TILE_SIZE * 1.0) g.needsLeave = false;
      if (g.fullWarned && d > TILE_SIZE * 1.6) g.fullWarned = false;

      const walkOver = d < (g.gold !== undefined && !g.bones ? GOLD_MAGNET : PICKUP_RANGE) && !g.needsLeave;
      const press = pressed && !pressedUsed && d < TILE_SIZE * 1.0;
      if (!walkOver && !press) continue;

      if (this.pickUp(g)) {
        if (press) pressedUsed = true;
        this.ground.splice(i, 1);
      }
    }
  }

  /** Try to take a floor entry. Returns true when it is gone from the floor. */
  private pickUp(g: GroundEntry): boolean {
    const ctx = this.ctx;
    const player = ctx.player;

    if (g.legacyType === 'CURSED_SHRINE') {
      if (g.spawnKey) ctx.persist.pickedItemKeys.add(g.spawnKey);
      ctx.rooms.showCursedShrine();
      g.sprite.destroy();
      return true;
    }

    if (g.bones) {
      const taken = graveyard.takeBones(ctx.currentFloor);
      const gold = taken?.gold ?? g.gold ?? 0;
      const name = taken?.name ?? g.bones.name;
      if (gold > 0) {
        ctx.addGold(gold);
        ctx.floatText(player.x, player.y - 24, goldGainText(gold), COLORS.GOLD_TEXT, 11);
        ctx.status(`You find the bones of ${name}. ${gold} gold pieces are yours now.`);
      } else {
        ctx.status(`You find the bones of ${name}. Nothing left worth taking.`);
      }
      ctx.bus.emit('bones_claimed', { name, gold });
      this.removeEntry(g);
      this.afterInventoryChange();
      return true;
    }

    if (g.gold !== undefined) {
      ctx.addGold(g.gold);
      ctx.floatText(player.x, player.y - 24, goldGainText(g.gold), COLORS.GOLD_TEXT, 11);
      this.removeEntry(g);
      this.afterInventoryChange();
      return true;
    }

    const item = g.item;
    if (!item) { this.removeEntry(g); return true; }
    const r = player.inventory.add(item);
    if (!r.ok) {
      if (!g.fullWarned) {
        g.fullWarned = true;
        ctx.status("Your pack is full.");
        ctx.floatText(g.sprite.x, g.sprite.y - 22, 'pack full', 0xff8a65, 10);
      }
      return false;
    }
    if (g.spawnKey) ctx.persist.pickedItemKeys.add(g.spawnKey);
    // Say when it beats what is worn or wielded: a found suit of banded mail +2 used to look like any other pickup.
    const better = upgradeNote(player.inventory, item);
    ctx.status(better ? `Picked up ${displayName(item, { quantity: true })}: ${better}` : `Picked up ${displayName(item, { quantity: true })}.`);
    if (better) ctx.floatText(player.x, player.y - 40, 'BETTER', 0x69f0ae, 11);
    ctx.floatText(player.x, player.y - 24, displayName(item), rarityColor(item), 11);
    ctx.bus.emit('item_pickup', { type: item.defKey });
    if (g.dropped) {
      ctx.bus.emit('item_picked', {
        defKey: item.defKey, tx: Math.floor(g.sprite.x / TILE_SIZE), ty: Math.floor(g.sprite.y / TILE_SIZE),
      });
    }
    this.removeEntry(g);
    this.afterInventoryChange();
    return true;
  }

  private removeEntry(g: GroundEntry) {
    g.label?.destroy();
    g.sprite.destroy();
  }

  /** After anything changed the pack, belt, body or gold: refresh derived numbers and the HUD. */
  private afterInventoryChange() {
    this.ctx.player.recomputeDerived();
    this.ctx.emitHUD();
  }

  // ── Equip, unequip, drop ──────────────────────────────────────────────────

  equipItem(itemId: string) {
    const ctx = this.ctx;
    const inv = ctx.player.inventory;
    const r = inv.equip(itemId);
    if (!r.ok) { ctx.status(r.message); return; }
    const f = inv.find(itemId);
    const name = f ? displayName(f.item) : 'item';
    ctx.status(r.curseRevealed ? `You equip ${name}. It is cursed!` : `Equipped ${name}.`);
    this.afterInventoryChange();
  }

  unequipSlot(slot: EquipSlot) {
    const ctx = this.ctx;
    const r = ctx.player.inventory.unequip(slot);
    if (!r.ok) { ctx.status(r.message); return; }
    ctx.status(`Took off ${displayName(r.item)}.`);
    this.afterInventoryChange();
  }

  /** Put an item on the player's tile. It will not jump back into the pack until the player steps away. */
  dropItem(itemId: string) {
    const ctx = this.ctx;
    const player = ctx.player;
    const r = player.inventory.remove(itemId);
    if (!r.ok) { ctx.status(r.message); return; }
    const tx = Math.floor(player.x / TILE_SIZE);
    const ty = Math.floor(player.y / TILE_SIZE);
    this.placeItem(r.item, tx * TILE_SIZE + TILE_SIZE / 2, ty * TILE_SIZE + TILE_SIZE / 2, { needsLeave: true, dropped: true });
    ctx.status(`Dropped ${displayName(r.item, { quantity: true })}.`);
    ctx.bus.emit('item_dropped', { itemId: r.item.id, defKey: r.item.defKey, tx, ty });
    this.afterInventoryChange();
  }

  // ── Using consumables ─────────────────────────────────────────────────────

  /** Use the consumable on belt slot `index` (0 to 3). */
  useBelt(index: number) {
    const ctx = this.ctx;
    const inv = ctx.player.inventory;
    const it = inv.belt[index];
    if (!it) { ctx.status(`Belt slot ${index + 1} is empty.`); return; }
    const def = getDef(it.defKey);
    if (!def.use) { ctx.status(`${def.name} cannot be used.`); return; }
    if (!inv.canUse(def)) { ctx.status(`A ${inv.classKey} cannot use ${def.name}.`); return; }
    if (!this.applyUse(def.use, def)) return; // refused: nothing is spent
    inv.useFromBelt(index);
    this.afterInventoryChange();
  }

  /** F key: the first healing potion on the belt, else one from the pack. */
  private checkPotionInput() {
    const ctx = this.ctx;
    if (!this._fKey) this._fKey = ctx.scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    if (!Phaser.Input.Keyboard.JustDown(this._fKey)) return;

    const inv = ctx.player.inventory;
    const beltIdx = inv.belt.findIndex(it => it?.defKey === 'healing_potion');
    if (beltIdx >= 0) { this.useBelt(beltIdx); return; }
    const def = getDef('healing_potion');
    if (inv.count('healing_potion') <= 0 || !def.use) { ctx.status("No healing potions."); return; }
    if (!this.applyUse(def.use, def)) return;
    inv.consume('healing_potion', 1);
    this.afterInventoryChange();
  }

  /**
   * Do what a consumable does. Returns false (and says why) when it cannot be used right now, so the caller
   * does not spend it. Heal potions are 2d4+2 whatever the catalog says.
   */
  private applyUse(effect: UseEffect, def: ItemDef): boolean {
    const ctx = this.ctx;
    const player = ctx.player;
    const inv = player.inventory;
    const s = player.stats;

    switch (effect.type) {
      case 'heal': {
        if (s.hp >= s.maxHp) { ctx.status("You are already unhurt."); return false; }
        const isBasic = def.key === 'healing_potion';
        const amount = isBasic
          ? rollDice(mathRng, `${HEALING_POTION_DICE}+${HEALING_POTION_BONUS}`)
          : rollDice(mathRng, effect.dice) + (effect.bonus ?? 0);
        player.heal(amount);
        if (ctx.hasRelic('swift_vial')) player.addEffect('RUSHED', 4500);
        ctx.floatText(player.x, player.y - 30, `${def.name}! +${amount} HP`, COLORS.HEAL_TEXT, 12);
        ctx.status(`You drink the ${def.name}.`);
        return true;
      }
      case 'cure_poison': {
        if (!player.hasEffect('POISONED')) { ctx.status("You are not poisoned."); return false; }
        player.removeEffect('POISONED');
        ctx.floatText(player.x, player.y - 30, 'Cured', COLORS.HEAL_TEXT, 12);
        return true;
      }
      case 'haste': {
        player.addEffect('RUSHED', effect.durationSec * 1000, 1 + effect.pct / 100);
        ctx.floatText(player.x, player.y - 30, 'HASTE!', 0xffd166, 12);
        return true;
      }
      case 'recall': {
        ctx.status("The scroll flares. The tavern's smoke curls around you.");
        ctx.floor.recallToTavern();
        return true;
      }
      case 'identify': {
        const target = inv.items().find(i => !i.identified);
        if (!target) { ctx.status("Nothing you carry needs identifying."); return false; }
        inv.identify(target.id);
        ctx.status(`Identified: ${displayName(target)}.`);
        return true;
      }
      case 'remove_curse': {
        const target = inv.items().find(i => i.cursed);
        if (!target) { ctx.status("Nothing you carry is cursed."); return false; }
        inv.removeCurse(target.id);
        ctx.status(`The curse on ${displayName(target)} lifts. It still carries its penalties.`);
        return true;
      }
      case 'light': {
        player.lightBoost = { radius: effect.radius, ms: effect.durationSec * 1000 };
        player.recomputeDerived();
        ctx.floatText(player.x, player.y - 30, 'LIGHT', 0xfff59d, 12);
        return true;
      }
      case 'cast':
        return ctx.spells.castFromScroll(effect.spell);
      case 'throw': {
        const target = this.nearestEnemy(THROW_RANGE, effect.vs);
        if (!target) { ctx.status(effect.vs ? "No undead in reach." : "Nothing to throw it at."); return false; }
        const dmg = rollDice(mathRng, effect.dice);
        const from = { x: player.x, y: player.y };
        ctx.spells.spellSystem.flyOrb(from, { x: target.x, y: target.y }, 0x80d8ff, 180, () => {
          if (!target.active || target.hp <= 0) return;
          const dealt = ctx.combat.damageEnemy(target, dmg);
          ctx.floatText(target.x, target.y - 20, `-${dealt}`, 0x80d8ff);
          ctx.bus.emit('player_hit', { enemyKey: target.typeKey, damage: dealt, crit: false });
        });
        ctx.status(`You hurl the ${def.name}.`);
        return true;
      }
      case 'eat': {
        if (s.hp >= s.maxHp && !(s.drained && s.drained > 0)) { ctx.status("You are not hungry."); return false; }
        player.heal(rollDice(mathRng, '1d3'));
        ctx.status("You eat. It is bland and it helps a little.");
        return true;
      }
    }
  }

  private nearestEnemy(range: number, vs?: 'undead' | 'giants' | 'spiders' | 'beasts' | 'demons'): Enemy | null {
    const ctx = this.ctx;
    let best: Enemy | null = null;
    let bestD = range;
    for (const e of ctx.enemies) {
      if (!e.active || e.hp <= 0) continue;
      if (e.isMimic && !e.mimicRevealed) continue;
      if (vs && !foeTagsFor(e.typeKey, e.def).includes(vs)) continue;
      const d = Phaser.Math.Distance.Between(ctx.player.x, ctx.player.y, e.x, e.y);
      if (d <= bestD) { bestD = d; best = e; }
    }
    return best;
  }

  destroy() {
    this._offGoldXp?.();
    this._offGoldXp = undefined;
    for (const g of this.ground) g.label?.destroy();
    this.ground = [];
    this.chests = [];
  }
}
