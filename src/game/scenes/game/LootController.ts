import * as Phaser from "phaser";
import {
  TILE_SIZE, COLORS, ArmorTrait, EquipmentTrait, WeaponTrait, abilityMod,
} from "../../constants";
import { onChestOpened, InventoryItem } from "../../systems/QuestSystem";
import { Enemy } from "../../entities/Enemy";
import { TreasureChest } from "../../entities/TreasureChest";
import type { GameContext } from "../../GameContext";

export type LootLike = { type: string; label: string; bonus?: number; trait?: EquipmentTrait; statKey?: string; value?: number };

/**
 * Items on the floor, chests, applying loot to the player, the legacy inventory list, and potions (F/M).
 * The new `player.inventory` (items module) is not wired in here yet.
 */
export class LootController {
  private items: Phaser.GameObjects.Sprite[] = [];
  private chests: TreasureChest[] = [];

  private _eKey?: Phaser.Input.Keyboard.Key;
  private _fKey?: Phaser.Input.Keyboard.Key;
  private _mKey?: Phaser.Input.Keyboard.Key;

  constructor(private ctx: GameContext) {}

  /** Chest interaction, floor pickup, potion keys: the same three calls in the same order as before. */
  update() {
    this.checkChestInteraction();
    this.checkItemPickup();
    this.checkPotionInput();
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  spawnItems() {
    const scene = this.ctx.scene;
    for (const spawn of this.ctx.dungeon.items) {
      const key = `${spawn.tx},${spawn.ty}`;
      if (this.ctx.persist.pickedItemKeys.has(key)) continue; // already picked in prior session

      const ix = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const iy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const textureKey = spawn.type === 'CURSED_SHRINE' ? 'decal_shrine' : `item_${spawn.type.toLowerCase()}`;
      const sprite = scene.add.sprite(ix, iy, textureKey).setDepth(3);
      (sprite as Phaser.GameObjects.Sprite & { itemType: string; spawnKey: string }).itemType = spawn.type;
      (sprite as Phaser.GameObjects.Sprite & { itemType: string; spawnKey: string }).spawnKey = key;
      this.items.push(sprite);

      scene.tweens.add({
        targets: sprite,
        y: iy - 5,
        duration: 1000,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
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
          const enemy = new Enemy(scene, mx, my, 'MIMIC');
          ctx.enemies.push(enemy);
          ctx.enemyGroup.add(enemy);
          scene.physics.add.collider(enemy, ctx.wallGroup);
          const body = enemy.body as Phaser.Physics.Arcade.Body;
          body.setVelocity(50, 50);
          ctx.floatText(mx, my - 30, 'MIMIC!', 0xffd700, 16);
          scene.cameras.main.shake(120, 0.008);
        };
      }

      this.chests.push(chest);
    }
  }

  // ── Chest Interaction ─────────────────────────────────────────────────────

  private checkChestInteraction() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const player = ctx.player;
    if (!this._eKey) this._eKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    const s = player.stats;

    for (let i = this.chests.length - 1; i >= 0; i--) {
      const chest = this.chests[i];
      if (!chest.active) { this.chests.splice(i, 1); continue; }

      const dx = player.x - chest.x;
      const dy = player.y - chest.y;
      const inRange = Math.sqrt(dx * dx + dy * dy) <= TILE_SIZE * 1.2;
      chest.setPromptVisible(inRange);

      if (inRange && Phaser.Input.Keyboard.JustDown(this._eKey)) {
        const result = chest.tryOpen(s.classKey, abilityMod(s.str), abilityMod(s.dex), s.level, ctx.currentFloor);
        if (result.message) ctx.status(result.message);

        if (result.trapTriggered) {
          const tx = Math.floor(chest.x / TILE_SIZE);
          const ty = Math.floor(chest.y / TILE_SIZE);
          ctx.traps.triggerTrap(result.trapTriggered, tx, ty, `${tx},${ty}`);
        }

        if (result.opened && result.loot) {
          ctx.bus.emit('chest_open');
          // Record chest as opened for persistence
          const chestTx = Math.round((chest.x - TILE_SIZE / 2) / TILE_SIZE);
          const chestTy = Math.round((chest.y - TILE_SIZE / 2) / TILE_SIZE);
          ctx.persist.openedChestKeys.add(`${chestTx},${chestTy}`);
          this.applyChestObjectiveProgress(chestTx, chestTy);

          // Quest progress: chest opened
          if (player.stats.activeQuests) {
            onChestOpened(player.stats.activeQuests);
          }

          const { gold, items } = result.loot;
          if (gold > 0) {
            const paidGold = ctx.hasRelic('chest_contract') ? gold * 2 : gold;
            ctx.addGold(paidGold);
            if (ctx.hasRelic('chest_contract')) {
              player.takeDamage(Math.max(1, Math.floor(player.stats.maxHp * 0.04)), true);
              ctx.floatText(chest.x, chest.y - 38, 'PACT PAID', 0xce93d8, 11);
            }
            ctx.floatText(chest.x, chest.y - 20, `+${paidGold} gold`, COLORS.GOLD_TEXT);
          }
          for (const lootItem of items) {
            this.applyLootItem(lootItem);
            ctx.bus.emit('item_pickup', { type: lootItem.type });
          }
          ctx.emitHUD();
        }
      }
    }
  }

  private applyLootItem(item: LootLike) {
    const ctx = this.ctx;
    const player = ctx.player;
    const s = player.stats;
    switch (item.type) {
      case 'HEALTH_POTION': player.heal(item.value ?? 30); ctx.status(`Found: ${item.label}`); break;
      case 'XP_ORB': player.gainXP(item.value ?? 40); ctx.status(`Found: ${item.label}`); break;
      case 'WEAPON':
        s.weaponBonus += item.bonus ?? 1; s.attack += item.bonus ?? 1;
        s.equippedWeaponLabel = item.label;
        s.weaponTrait = item.trait as WeaponTrait | undefined;
        ctx.status(`Equipped: ${item.label} (+${item.bonus} ATK${this.describeTrait(item.trait)})`);
        this.trackInventory(item, true);
        break;
      case 'ARMOR':
        s.armorBonus += item.bonus ?? 1; s.defense += item.bonus ?? 1;
        s.equippedArmorLabel = item.label;
        s.armorTrait = item.trait as ArmorTrait | undefined;
        player.refreshArmorWard();
        ctx.status(`Equipped: ${item.label} (+${item.bonus} DEF${this.describeTrait(item.trait)})`);
        this.trackInventory(item, true);
        break;
      case 'STAT_TOME':
        if (item.statKey) {
          const k = item.statKey as keyof typeof s;
          if (typeof s[k] === 'number') {
            (s as unknown as Record<string, number>)[item.statKey] += 1;
            player.recomputeDerived();
            ctx.status(`Read: ${item.label} (+1 ${item.statKey.toUpperCase()})`);
          }
        }
        this.trackInventory(item, false);
        break;
      case 'SCROLL':
        ctx.status(`Found scroll: ${item.label}`);
        this.trackInventory(item, false);
        break;
    }
    ctx.floatText(player.x, player.y - 20, item.label, COLORS.GOLD_TEXT, 11);
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

  private describeTrait(trait?: EquipmentTrait) {
    if (!trait) return '';
    const labels: Record<EquipmentTrait, string> = {
      cleaving: ', cleave on kill',
      quick: ', faster swings',
      vampiric: ', heal on kill',
      arcane: ', mana on kill',
      light: ', faster movement',
      reinforced: ', -1 damage taken',
      warded: ', first hit per room reduced',
    };
    return labels[trait];
  }

  /** Records an item in the legacy `stats.inventory` list (capped at 100). Also used by boons. */
  trackInventory(item: { type: string; label: string; bonus?: number; trait?: EquipmentTrait }, equipped: boolean) {
    const s = this.ctx.player.stats;
    if (!s.inventory) s.inventory = [];
    // Un-equip previous item of same type
    if (equipped) {
      const itemType = item.type as InventoryItem['type'];
      for (const inv of s.inventory) {
        if (inv.type === itemType && inv.equipped) inv.equipped = false;
      }
    }
    const typeMap: Record<string, InventoryItem['type']> = {
      'WEAPON': 'WEAPON', 'ARMOR': 'ARMOR', 'SCROLL': 'SCROLL', 'STAT_TOME': 'STAT_TOME',
    };
    s.inventory.push({
      id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      type: typeMap[item.type] ?? 'CONSUMABLE',
      label: item.label,
      bonus: item.bonus,
      equipped,
      floorFound: this.ctx.currentFloor,
      timestamp: Date.now(),
    });
    // Cap at 100
    if (s.inventory.length > 100) s.inventory = s.inventory.slice(-100);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private checkItemPickup() {
    const player = this.ctx.player;
    const range = TILE_SIZE * 0.8;
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const dx = player.x - item.x;
      const dy = player.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) < range) {
        const typed = item as Phaser.GameObjects.Sprite & { itemType: string; spawnKey?: string };
        if (typed.spawnKey) this.ctx.persist.pickedItemKeys.add(typed.spawnKey);
        this.applyItem(typed.itemType);
        this.ctx.bus.emit('item_pickup', { type: typed.itemType });
        item.destroy();
        this.items.splice(i, 1);
      }
    }
  }

  private applyItem(type: string) {
    const ctx = this.ctx;
    const player = ctx.player;
    switch (type) {
      case "CURSED_SHRINE": ctx.rooms.showCursedShrine(); break;
      case "HEALTH_POTION": player.heal(30); ctx.status("Health Potion +30 HP"); break;
      case "WEAPON":
        this.applyLootItem(this.rollFloorEquipment('WEAPON'));
        ctx.floatText(player.x, player.y - 30, "WEAPON", COLORS.WEAPON);
        ctx.emitHUD(); break;
      case "ARMOR":
        this.applyLootItem(this.rollFloorEquipment('ARMOR'));
        ctx.floatText(player.x, player.y - 30, "ARMOR", COLORS.ARMOR);
        ctx.emitHUD(); break;
      case "XP_ORB": player.gainXP(40); ctx.status("XP Orb +40 XP"); break;
    }
  }

  private rollFloorEquipment(type: 'WEAPON' | 'ARMOR'): LootLike {
    if (type === 'WEAPON') {
      const weapons: LootLike[] = [
        { type, label: 'Scout Dagger +2 [Quick]', bonus: 2, trait: 'quick' },
        { type, label: 'Hungry Mace +2 [Drain]', bonus: 2, trait: 'vampiric' },
        { type, label: 'Notched Axe +2 [Cleave]', bonus: 2, trait: 'cleaving' },
        { type, label: 'Runed Staff +2 [Arcane]', bonus: 2, trait: 'arcane' },
      ];
      return weapons[Phaser.Math.Between(0, weapons.length - 1)];
    }
    const armors: LootLike[] = [
      { type, label: 'Traveler Leather +1 [Light]', bonus: 1, trait: 'light' },
      { type, label: 'Guard Mail +1 [Guard]', bonus: 1, trait: 'reinforced' },
      { type, label: 'Warded Scale +1 [Ward]', bonus: 1, trait: 'warded' },
    ];
    return armors[Phaser.Math.Between(0, armors.length - 1)];
  }

  // ── Potions ────────────────────────────────────────────────────────────────

  private checkPotionInput() {
    const ctx = this.ctx;
    const scene = ctx.scene;
    const player = ctx.player;
    if (!this._fKey) this._fKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    if (!this._mKey) this._mKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.M);

    if (Phaser.Input.Keyboard.JustDown(this._fKey)) {
      if (player.stats.potions > 0) {
        player.stats.potions--;
        player.heal(50);
        if (ctx.hasRelic('swift_vial')) player.addEffect('RUSHED', 4500);
        ctx.floatText(player.x, player.y - 30, 'Potion! +50 HP', COLORS.HEAL_TEXT, 12);
        ctx.status(`Used Health Potion (${player.stats.potions} left)`);
        ctx.emitHUD();
      } else { ctx.status("No potions left!"); }
    }

    if (Phaser.Input.Keyboard.JustDown(this._mKey)) {
      if (player.stats.manaPotions > 0 && player.stats.maxMana > 0) {
        player.stats.manaPotions--;
        player.restoreMana(40);
        if (ctx.hasRelic('swift_vial')) player.addEffect('RUSHED', 4500);
        ctx.floatText(player.x, player.y - 30, '+40 Mana', COLORS.MANA_BAR, 12);
        ctx.status(`Used Mana Potion (${player.stats.manaPotions} left)`);
        ctx.emitHUD();
      } else if (player.stats.maxMana === 0) {
        ctx.status("Your class doesn't use mana!");
      } else { ctx.status("No mana potions left!"); }
    }
  }

  destroy() {
    this.items = [];
    this.chests = [];
  }
}
