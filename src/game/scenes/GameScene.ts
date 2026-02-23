import * as Phaser from "phaser";
import {
  TILE_SIZE, TILE, COLORS, MAP_WIDTH, MAP_HEIGHT, FOG_RADIUS,
  CHARACTER_CLASSES, SpellKey, SPELLS,
  TRAP_TYPES, TrapTypeKey,
  ENEMY_TYPES, EnemyTypeKey,
  abilityMod,
} from "../constants";
import { generateDungeon, DungeonData } from "../systems/DungeonGenerator";
import { Player, CharCreationData, PlayerStats } from "../entities/Player";
import { Enemy } from "../entities/Enemy";
import { TreasureChest } from "../entities/TreasureChest";
import { SpellSystem } from "../systems/SpellSystem";

interface FloatingText {
  obj: Phaser.GameObjects.Text;
  vy: number;
  life: number;
}

export class GameScene extends Phaser.Scene {
  private dungeon!: DungeonData;
  private player!: Player;
  private enemies: Enemy[] = [];
  private enemyGroup!: Phaser.Physics.Arcade.Group;
  private items: Phaser.GameObjects.Sprite[] = [];
  private chests: TreasureChest[] = [];
  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private currentFloor = 1;
  private floatingTexts: FloatingText[] = [];
  private spellSystem!: SpellSystem;

  // Secret door tracking
  private secretDoorSet = new Set<string>(); // "tx,ty"
  private secretDoorSprites = new Map<string, Phaser.GameObjects.Image>();

  // Trap tracking
  private trapMap = new Map<string, TrapTypeKey>(); // "tx,ty" → type

  // Fog of war
  private fogRT!: Phaser.GameObjects.RenderTexture;
  private fogBrushImg!: Phaser.GameObjects.Image;
  private fogState!: Uint8Array;
  private lastFogTile = { tx: -1, ty: -1 };

  // Torch glow
  private torchInner!: Phaser.GameObjects.Image;
  private torchOuter!: Phaser.GameObjects.Image;

  // HUD keys (Q/W/E/R for spells)
  private spellHotkeys: Phaser.Input.Keyboard.Key[] = [];
  private spellHotkeyMap: SpellKey[] = [];

  private kills = 0;
  private initData: {
    floor?: number;
    charData?: CharCreationData;
    persistedStats?: PlayerStats;
  } = {};

  // Ranged attack projectiles (enemy bolts)
  private enemyProjectiles: {
    obj: Phaser.GameObjects.Rectangle;
    vx: number; vy: number;
    dmg: number;
    life: number;
  }[] = [];

  constructor() {
    super({ key: "GameScene" });
  }

  init(data: { floor?: number; charData?: CharCreationData; persistedStats?: PlayerStats }) {
    this.currentFloor = data?.floor ?? 1;
    this.kills = 0;
    this.initData = data ?? {};
    this.secretDoorSet.clear();
    this.secretDoorSprites.clear();
    this.trapMap.clear();
    this.enemyProjectiles = [];
  }

  create() {
    this.dungeon = generateDungeon(this.currentFloor);

    this.physics.world.setBounds(0, 0, MAP_WIDTH * TILE_SIZE, MAP_HEIGHT * TILE_SIZE);

    this.buildTilemap();
    this.spawnPlayer();
    this.spawnTorchGlow();
    this.spawnEnemies();
    this.spawnItems();
    this.spawnChests();
    this.initFog();
    this.setupCamera();
    this.setupSpells();

    if (!this.scene.isActive("HUDScene")) {
      this.scene.launch("HUDScene");
    }
    this.emitHUD();
  }

  // ── Tilemap ───────────────────────────────────────────────────────────────

  private buildTilemap() {
    const { tiles } = this.dungeon;
    this.wallGroup = this.physics.add.staticGroup();

    for (let ty = 0; ty < MAP_HEIGHT; ty++) {
      for (let tx = 0; tx < MAP_WIDTH; tx++) {
        const t = tiles[ty][tx];
        const wx = tx * TILE_SIZE + TILE_SIZE / 2;
        const wy = ty * TILE_SIZE + TILE_SIZE / 2;

        if (t === TILE.WALL) {
          this.add.image(wx, wy, "wall").setDepth(1);
          const rect = this.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          this.physics.add.existing(rect, true);
          this.wallGroup.add(rect);
        } else if (t === TILE.SECRET_DOOR) {
          // Render as wall (with faint crack), add physics body
          const img = this.add.image(wx, wy, "secret_door").setDepth(1);
          this.secretDoorSprites.set(`${tx},${ty}`, img);
          this.secretDoorSet.add(`${tx},${ty}`);
          const rect = this.add.rectangle(wx, wy, TILE_SIZE, TILE_SIZE);
          this.physics.add.existing(rect, true);
          this.wallGroup.add(rect);
        } else if (t === TILE.STAIRS) {
          this.add.image(wx, wy, "floor").setDepth(1);
          this.add.image(wx, wy, "stairs").setDepth(2);
        } else if (t === TILE.TRAP) {
          this.add.image(wx, wy, "floor").setDepth(1);
          // Trap overlay will be toggled when detected
        } else {
          this.add.image(wx, wy, "floor").setDepth(1);
        }
      }
    }

    // Build trap map
    for (const trap of this.dungeon.traps) {
      this.trapMap.set(`${trap.tx},${trap.ty}`, trap.type);
    }
  }

  // ── Player ────────────────────────────────────────────────────────────────

  private spawnPlayer() {
    const { tx, ty } = this.dungeon.playerStart;
    const px = tx * TILE_SIZE + TILE_SIZE / 2;
    const py = ty * TILE_SIZE + TILE_SIZE / 2;

    // Build player: carry over stats between floors
    let persistedStats: PlayerStats | undefined;
    if (this.initData.persistedStats) {
      persistedStats = { ...this.initData.persistedStats, floor: this.currentFloor };
    }

    this.player = new Player(this, px, py, this.initData.charData, persistedStats);

    this.player.setCallbacks({
      onDamage: (dmg) => {
        this.spawnFloatingText(this.player.x, this.player.y - 20, `-${dmg}`, COLORS.DAMAGE_TEXT);
        this.emitHUD();
        this.cameras.main.shake(80, 0.005);
      },
      onHeal: (amount) => {
        this.spawnFloatingText(this.player.x, this.player.y - 20, `+${amount}`, COLORS.HEAL_TEXT);
        this.emitHUD();
      },
      onDead: () => this.handlePlayerDeath(),
      onXP: (gained) => {
        this.spawnFloatingText(this.player.x, this.player.y - 30, `+${gained} XP`, COLORS.XP_TEXT, 12);
        this.emitHUD();
      },
      onLevelUp: (level) => {
        this.spawnFloatingText(this.player.x, this.player.y - 50, `LEVEL UP! ${level}`, 0xffd700, 18);
        this.cameras.main.flash(200, 80, 80, 20);
        this.emitHUD();
      },
      onTurnUndead: () => this.doTurnUndead(),
    });

    this.physics.add.collider(this.player, this.wallGroup);
  }

  // ── Enemies ───────────────────────────────────────────────────────────────

  private spawnEnemies() {
    this.enemyGroup = this.physics.add.group();

    for (const spawn of this.dungeon.enemies) {
      const ex = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const ey = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const enemy = new Enemy(this, ex, ey, spawn.type);
      this.enemies.push(enemy);
      this.enemyGroup.add(enemy);
      this.physics.add.collider(enemy, this.wallGroup);
    }

    this.physics.add.collider(this.player, this.enemyGroup);
    this.physics.add.collider(this.enemyGroup, this.enemyGroup);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private spawnItems() {
    for (const spawn of this.dungeon.items) {
      const ix = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const iy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;
      const textureKey = `item_${spawn.type.toLowerCase()}`;
      const sprite = this.add.sprite(ix, iy, textureKey).setDepth(3);
      (sprite as Phaser.GameObjects.Sprite & { itemType: string }).itemType = spawn.type;
      this.items.push(sprite);

      this.tweens.add({
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

  private spawnChests() {
    for (const spawn of this.dungeon.chests) {
      const cx = spawn.tx * TILE_SIZE + TILE_SIZE / 2;
      const cy = spawn.ty * TILE_SIZE + TILE_SIZE / 2;

      const chest = new TreasureChest(this, cx, cy, spawn.tier, spawn.trapped, spawn.isMimic);

      if (spawn.isMimic) {
        // When mimic reveals, spawn actual enemy
        chest.onMimicReveal = (mx, my) => {
          const enemy = new Enemy(this, mx, my, 'MIMIC');
          this.enemies.push(enemy);
          this.enemyGroup.add(enemy);
          this.physics.add.collider(enemy, this.wallGroup);
          // Force mimic into chase state immediately
          const body = enemy.body as Phaser.Physics.Arcade.Body;
          body.setVelocity(50, 50);
          this.spawnFloatingText(mx, my - 30, 'MIMIC!', 0xffd700, 16);
          this.cameras.main.shake(120, 0.008);
        };
      }

      this.chests.push(chest);
    }
  }

  // ── Torch glow ────────────────────────────────────────────────────────────

  private spawnTorchGlow() {
    const px = this.player.x;
    const py = this.player.y;

    this.torchOuter = this.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(2.8).setAlpha(0.35).setDepth(47);

    this.torchInner = this.add
      .image(px, py, "torch_glow")
      .setBlendMode(Phaser.BlendModes.ADD)
      .setScale(1.6).setAlpha(0.55).setDepth(48);
  }

  // ── Fog of war ────────────────────────────────────────────────────────────

  private initFog() {
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;

    this.fogState = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    this.fogRT = this.add.renderTexture(0, 0, totalW, totalH);
    this.fogRT.setOrigin(0, 0);
    this.fogRT.fill(0x000000, 1);
    this.fogRT.setDepth(50);

    const brushSize = FOG_RADIUS * TILE_SIZE * 2;
    this.fogBrushImg = this.add.image(0, 0, "fog_brush")
      .setOrigin(0, 0)
      .setDisplaySize(brushSize, brushSize)
      .setVisible(false);

    const { tx, ty } = this.dungeon.playerStart;
    this.revealFog(tx, ty);
    this.lastFogTile = { tx, ty };
  }

  private revealFog(ptx: number, pty: number) {
    const r = FOG_RADIUS;
    const brushRadius = r * TILE_SIZE;

    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r * r) continue;
        const tx = ptx + dx;
        const ty = pty + dy;
        if (tx < 0 || ty < 0 || tx >= MAP_WIDTH || ty >= MAP_HEIGHT) continue;
        this.fogState[ty * MAP_WIDTH + tx] = 1;
      }
    }

    const bx = ptx * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    const by = pty * TILE_SIZE + TILE_SIZE / 2 - brushRadius;
    this.fogRT.erase(this.fogBrushImg, bx, by);
  }

  // ── Camera ────────────────────────────────────────────────────────────────

  private setupCamera() {
    const totalW = MAP_WIDTH * TILE_SIZE;
    const totalH = MAP_HEIGHT * TILE_SIZE;
    this.cameras.main.setBounds(0, 0, totalW, totalH);
    this.cameras.main.startFollow(this.player, true, 0.08, 0.08);

    this.input.on("wheel", (_ptr: unknown, _objs: unknown, _dx: number, deltaY: number) => {
      this.adjustZoom(-deltaY * 0.001);
    });

    this.input.keyboard!.on("keydown-PLUS", () => this.adjustZoom(0.1));
    this.input.keyboard!.on("keydown-EQUALS", () => this.adjustZoom(0.1));
    this.input.keyboard!.on("keydown-MINUS", () => this.adjustZoom(-0.1));
  }

  private adjustZoom(delta: number) {
    const next = Phaser.Math.Clamp(this.cameras.main.zoom + delta, 0.4, 2.5);
    this.cameras.main.setZoom(next);
    this.events.emit("hud:zoom", next);
  }

  // ── Spells ────────────────────────────────────────────────────────────────

  private setupSpells() {
    this.spellSystem = new SpellSystem(this);

    const classDef = CHARACTER_CLASSES[this.player.stats.classKey];
    const hotkeyKeyCodes: number[] = [
      Phaser.Input.Keyboard.KeyCodes.Q,
      Phaser.Input.Keyboard.KeyCodes.W,
      Phaser.Input.Keyboard.KeyCodes.E,
      Phaser.Input.Keyboard.KeyCodes.R,
    ];

    this.spellHotkeys = [];
    this.spellHotkeyMap = [];

    classDef.spellKeys.forEach((spellKey, i) => {
      if (i < hotkeyKeyCodes.length) {
        const key = this.input.keyboard!.addKey(hotkeyKeyCodes[i]);
        this.spellHotkeys.push(key);
        this.spellHotkeyMap.push(spellKey);
      }
    });
  }

  // ── HUD ───────────────────────────────────────────────────────────────────

  emitHUD() {
    if (!this.player) return;
    const s = this.player.stats;
    this.events.emit("hud:update", {
      hp: s.hp, maxHp: s.maxHp,
      attack: s.attack, defense: s.defense,
      level: s.level, xp: s.xp, xpToNext: s.xpToNext,
      floor: this.currentFloor, kills: this.kills,
      mana: s.mana, maxMana: s.maxMana,
      classKey: s.classKey,
      effects: s.effects,
      spellKeys: this.spellHotkeyMap,
      spellCooldowns: this.spellHotkeyMap.map(k => this.spellSystem?.getRemainingCooldown(k) ?? 0),
      spellManaCosts: this.spellHotkeyMap.map(k => SPELLS[k]?.manaCost ?? 0),
    });
  }

  // ── Update loop ───────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    if (!this.player || this.player.stats.hp <= 0) return;

    this.player.update(delta);

    // Torch glow
    const flicker = 0.5 + Math.sin(this.time.now * 0.008) * 0.04 + (Math.random() - 0.5) * 0.025;
    this.torchInner.setPosition(this.player.x, this.player.y).setAlpha(flicker);
    this.torchOuter.setPosition(this.player.x, this.player.y).setAlpha(flicker * 0.55);

    // Fog of war
    const curTx = Math.floor(this.player.x / TILE_SIZE);
    const curTy = Math.floor(this.player.y / TILE_SIZE);
    if (curTx !== this.lastFogTile.tx || curTy !== this.lastFogTile.ty) {
      this.lastFogTile = { tx: curTx, ty: curTy };
      this.revealFog(curTx, curTy);
    }

    // Secret door search (all classes)
    this.checkSecretDoors(curTx, curTy);

    // Trap check
    this.checkTraps(curTx, curTy);

    // Turn undead (Cleric T key)
    this.player.tryTurnUndead();

    // Spell casting
    this.checkSpellInput();

    // Attack
    if (this.player.tryAttack()) {
      this.handlePlayerAttack();
    }

    // Enemy update
    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) {
        this.enemies.splice(i, 1);
        continue;
      }
      enemy.update(delta, this.player.x, this.player.y);

      if (enemy.canAttackPlayer(this.player.x, this.player.y)) {
        const dmg = enemy.doAttack();

        if (ENEMY_TYPES[enemy.typeKey].isRanged) {
          // Spawn a projectile rather than instant damage
          this.spawnEnemyBolt(enemy.x, enemy.y, this.player.x, this.player.y, dmg, enemy.typeKey);
        } else {
          this.player.takeDamage(dmg, enemy.ignoresArmor);
          if (enemy.poisonDmg > 0) {
            this.player.addEffect('POISONED', enemy.poisonDuration || 5000, enemy.poisonDmg);
          }
        }
      }
    }

    // Enemy projectiles
    this.updateEnemyProjectiles(delta);

    // Chest interaction (E key within range)
    this.checkChestInteraction();

    // Item pickup
    this.checkItemPickup();

    // Stairs check
    this.checkStairs();

    // Floating texts
    this.updateFloatingTexts(delta);

    // SpellSystem update
    if (this.spellSystem) {
      this.spellSystem.update(delta, this.enemies, this.player);
    }

    // Emit HUD each frame for mana/effects
    this.emitHUD();
  }

  // ── Secret Doors ──────────────────────────────────────────────────────────

  private checkSecretDoors(ptx: number, pty: number) {
    const { classKey } = this.player.stats;
    const searchRange = classKey === 'thief' ? 3 : 2;

    for (const key of this.secretDoorSet) {
      const [stx, sty] = key.split(',').map(Number);
      const dx = ptx - stx;
      const dy = pty - sty;

      if (Math.abs(dx) <= searchRange && Math.abs(dy) <= searchRange) {
        // Thief auto-detects (blue pulse tint)
        const sprite = this.secretDoorSprites.get(key);
        if (sprite) sprite.setTint(0x448aff);

        // Reveal if clicked within range
        if (this.input.activePointer.isDown) {
          const wx = this.input.activePointer.worldX;
          const wy = this.input.activePointer.worldY;
          const clickTx = Math.floor(wx / TILE_SIZE);
          const clickTy = Math.floor(wy / TILE_SIZE);

          if (clickTx === stx && clickTy === sty) {
            this.revealSecretDoor(stx, sty, key);
          }
        }
      } else {
        const sprite = this.secretDoorSprites.get(key);
        if (sprite) sprite.clearTint();
      }
    }
  }

  private revealSecretDoor(tx: number, ty: number, key: string) {
    // D20 search check
    const searchBonus = this.player.stats.searchBonus;
    const roll = Math.floor(Math.random() * 20) + 1 + searchBonus;

    if (roll >= 15) {
      // Success: remove wall, make passable
      this.dungeon.tiles[ty][tx] = TILE.FLOOR;

      const wx = tx * TILE_SIZE + TILE_SIZE / 2;
      const wy = ty * TILE_SIZE + TILE_SIZE / 2;

      // Remove physics body by finding and destroying the rect at this position
      // (approximate: iterate staticGroup members)
      const members = this.wallGroup.getChildren();
      for (const m of members) {
        const r = m as Phaser.GameObjects.Rectangle;
        if (Math.abs(r.x - wx) < 2 && Math.abs(r.y - wy) < 2) {
          r.destroy();
          break;
        }
      }

      // Update sprite
      const sprite = this.secretDoorSprites.get(key);
      if (sprite) {
        sprite.setTexture("secret_door_open");
        sprite.clearTint();
      }

      this.secretDoorSet.delete(key);
      this.secretDoorSprites.delete(key);

      this.spawnFloatingText(wx, wy - 20, 'Secret door found!', 0x448aff, 13);
      this.events.emit("hud:status", "Secret door revealed! (rolled " + roll + ")");
    } else {
      this.events.emit("hud:status", `Search failed (rolled ${roll}, need 15)`);
    }
  }

  // ── Traps ─────────────────────────────────────────────────────────────────

  private checkTraps(ptx: number, pty: number) {
    const { classKey } = this.player.stats;
    const trapKey = `${ptx},${pty}`;
    const trapType = this.trapMap.get(trapKey);

    if (trapType) {
      // Thief can detect nearby traps (within 4 tiles)
      if (classKey === 'thief') {
        // Mark detected (visual handled in buildTilemap — we add a glow)
        // For now, show HUD warning
        this.events.emit("hud:status", `⚠ TRAP detected: ${trapType}`);
      }

      // Trigger trap on step
      this.triggerTrap(trapType, ptx, pty, trapKey);
    }
  }

  private triggerTrap(type: TrapTypeKey, tx: number, ty: number, mapKey: string) {
    const def = TRAP_TYPES[type];
    const s = this.player.stats;

    // Remove trap from map
    this.trapMap.delete(mapKey);
    this.dungeon.tiles[ty][tx] = TILE.FLOOR;

    // Visual effect
    const wx = tx * TILE_SIZE + TILE_SIZE / 2;
    const wy = ty * TILE_SIZE + TILE_SIZE / 2;
    this.spawnFloatingText(wx, wy - 20, def.description, def.color, 12);
    this.cameras.main.shake(100, 0.006);

    // Saving throw
    let saveBonus: number;
    let saved = false;

    if (def.saveStat === 'reflex') {
      saveBonus = s.reflexSave;
    } else if (def.saveStat === 'fort') {
      saveBonus = s.fortSave;
    } else {
      // No save (ALARM)
      this.doAlarmEffect();
      return;
    }

    const roll = Math.floor(Math.random() * 20) + 1 + saveBonus;
    saved = roll >= def.dc;

    if (saved) {
      this.spawnFloatingText(this.player.x, this.player.y - 40, `SAVED! (${roll})`, 0x69f0ae, 12);
      return;
    }

    // Damage
    if (def.damage[0] > 0) {
      let dmg = 0;
      for (let i = 0; i < def.damage[1]; i++) dmg += Math.floor(Math.random() * def.damage[0]) + 1;
      this.player.takeDamage(dmg, false);
    }

    // Status effect
    if (def.effect === 'POISONED') {
      this.player.addEffect('POISONED', def.effectDuration ?? 5000, 3);
    } else if (def.effect === 'SLOWED') {
      this.player.addEffect('SLOWED', def.effectDuration ?? 4000);
    }

    this.events.emit("hud:status", `${def.description} FAILED save (rolled ${roll}, DC ${def.dc})`);
  }

  private doAlarmEffect() {
    // Aggro all enemies in the current room
    const px = this.player.x;
    const py = this.player.y;
    let count = 0;

    for (const enemy of this.enemies) {
      if (!enemy.active) continue;
      const dx = enemy.x - px;
      const dy = enemy.y - py;
      if (Math.sqrt(dx * dx + dy * dy) < 300) {
        // Force aggro (tap update once to set chase state)
        enemy.update(0, px, py);
        count++;
      }
    }

    this.cameras.main.shake(150, 0.01);
    this.events.emit("hud:status", `ALARM! ${count} enemies alerted!`);
  }

  // ── Turn Undead ────────────────────────────────────────────────────────────

  private doTurnUndead() {
    const turnRange = 200;
    let count = 0;

    for (const enemy of this.enemies) {
      if (!enemy.active || !enemy.isUndead) continue;
      const dx = enemy.x - this.player.x;
      const dy = enemy.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) <= turnRange) {
        // CHA modifier affects power
        const chaBonus = abilityMod(this.player.stats.cha);
        const roll = Math.floor(Math.random() * 20) + 1 + chaBonus;
        if (roll >= 10) {
          enemy.forceFleeFrom(this.player.x, this.player.y, 10000);
          count++;
        }
      }
    }

    this.spawnFloatingText(this.player.x, this.player.y - 40, `Turn Undead! (${count} fled)`, 0xfff9c4, 14);
    this.events.emit("hud:status", `Turn Undead — ${count} undead flee!`);
  }

  // ── Spell Input ────────────────────────────────────────────────────────────

  private checkSpellInput() {
    if (!this.spellSystem) return;
    const ptr = this.input.activePointer;
    const worldX = ptr.worldX;
    const worldY = ptr.worldY;

    this.spellHotkeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        const spellKey = this.spellHotkeyMap[i];
        if (!spellKey) return;

        // Special: Turn Undead is handled via class ability, skip
        if (spellKey === 'TURN_UNDEAD') {
          this.doTurnUndead();
          return;
        }

        const cast = this.spellSystem.cast(
          spellKey, this.player, this.enemies, this.dungeon.tiles,
          worldX, worldY,
        );

        if (cast) {
          this.spawnFloatingText(this.player.x, this.player.y - 30, `${SPELLS[spellKey].name}!`, SPELLS[spellKey].color, 12);
        } else {
          this.events.emit("hud:status", "Not enough mana!");
        }
        this.emitHUD();
      }
    });
  }

  // ── Combat ────────────────────────────────────────────────────────────────

  private handlePlayerAttack() {
    const attackBox = this.player.getAttackBox();

    for (let i = this.enemies.length - 1; i >= 0; i--) {
      const enemy = this.enemies[i];
      if (!enemy.active) continue;

      const enemyBounds = enemy.getBounds();
      if (Phaser.Geom.Intersects.RectangleToRectangle(attackBox, enemyBounds)) {
        // Thief sneak attack: if enemy isn't in chase state (not aggroed)
        const isSneakAttack = this.player.stats.classKey === 'thief' &&
          !enemy.canAttackPlayer(this.player.x, this.player.y);
        const dmg = this.player.getAttackDamage(isSneakAttack);

        const dealt = enemy.takeDamage(dmg);
        this.spawnFloatingText(enemy.x, enemy.y - 20, `-${dealt}`, 0xffffff);
        if (isSneakAttack) {
          this.spawnFloatingText(enemy.x, enemy.y - 36, 'SNEAK!', 0xffa726, 11);
        }

        if (enemy.hp <= 0) {
          this.player.gainXP(enemy.xp);
          this.kills++;
          this.emitHUD();

          // Fighter Cleave: attack adjacent enemies
          if (this.player.stats.classKey === 'fighter') {
            this.doCleave(enemy.x, enemy.y, i);
          }

          this.spawnDeathEffect(enemy.x, enemy.y, enemy.typeKey);
          enemy.destroy();
          this.enemies.splice(i, 1);
        }
      }
    }
  }

  private doCleave(killedX: number, killedY: number, killedIdx: number) {
    const cleaveRange = TILE_SIZE * 2;
    for (let j = this.enemies.length - 1; j >= 0; j--) {
      if (j === killedIdx) continue;
      const target = this.enemies[j];
      if (!target.active) continue;
      const dx = target.x - killedX;
      const dy = target.y - killedY;
      if (Math.sqrt(dx * dx + dy * dy) <= cleaveRange) {
        const dmg = this.player.getAttackDamage(false);
        const dealt = target.takeDamage(dmg);
        this.spawnFloatingText(target.x, target.y - 20, `CLEAVE -${dealt}`, COLORS.ENEMY_BASIC, 12);

        if (target.hp <= 0) {
          this.player.gainXP(target.xp);
          this.kills++;
          this.spawnDeathEffect(target.x, target.y, target.typeKey);
          target.destroy();
          this.enemies.splice(j, 1);
        }
        break; // Cleave only hits one additional enemy
      }
    }
  }

  private spawnEnemyBolt(fromX: number, fromY: number, toX: number, toY: number, dmg: number, typeKey: EnemyTypeKey) {
    const dx = toX - fromX;
    const dy = toY - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const speed = 300;

    const color = ENEMY_TYPES[typeKey].color;
    const bolt = this.add.rectangle(fromX, fromY, 5, 5, color).setDepth(16);
    this.enemyProjectiles.push({
      obj: bolt,
      vx: (dx / len) * speed,
      vy: (dy / len) * speed,
      dmg,
      life: 1500,
    });
  }

  private updateEnemyProjectiles(delta: number) {
    const dt = delta / 1000;
    for (let i = this.enemyProjectiles.length - 1; i >= 0; i--) {
      const proj = this.enemyProjectiles[i];
      proj.life -= delta;

      if (proj.life <= 0) {
        proj.obj.destroy();
        this.enemyProjectiles.splice(i, 1);
        continue;
      }

      proj.obj.x += proj.vx * dt;
      proj.obj.y += proj.vy * dt;

      // Check player hit
      const dx = proj.obj.x - this.player.x;
      const dy = proj.obj.y - this.player.y;
      if (Math.sqrt(dx * dx + dy * dy) < 20) {
        this.player.takeDamage(proj.dmg, false);
        proj.obj.destroy();
        this.enemyProjectiles.splice(i, 1);
      }
    }
  }

  private spawnDeathEffect(x: number, y: number, typeKey: EnemyTypeKey) {
    const color = ENEMY_TYPES[typeKey]?.color ?? 0xff0000;
    for (let i = 0; i < 6; i++) {
      const p = this.add.rectangle(x, y, 6, 6, color).setDepth(15);
      const angle = (i / 6) * Math.PI * 2;
      const speed = Phaser.Math.Between(60, 120);
      this.tweens.add({
        targets: p,
        x: x + Math.cos(angle) * speed * 0.4,
        y: y + Math.sin(angle) * speed * 0.4,
        alpha: 0,
        scaleX: 0,
        scaleY: 0,
        duration: 400,
        onComplete: () => p.destroy(),
      });
    }
  }

  // ── Chest Interaction ─────────────────────────────────────────────────────

  private _eKey?: Phaser.Input.Keyboard.Key;

  private checkChestInteraction() {
    if (!this._eKey) {
      this._eKey = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    }

    const interactRange = TILE_SIZE * 1.2;
    const s = this.player.stats;

    for (let i = this.chests.length - 1; i >= 0; i--) {
      const chest = this.chests[i];
      if (!chest.active) { this.chests.splice(i, 1); continue; }

      const dx = this.player.x - chest.x;
      const dy = this.player.y - chest.y;
      const dist = Math.sqrt(dx * dx + dy * dy);

      const inRange = dist <= interactRange;
      chest.setPromptVisible(inRange);

      if (inRange && Phaser.Input.Keyboard.JustDown(this._eKey)) {
        const strMod = abilityMod(s.str);
        const dexMod = abilityMod(s.dex);
        const result = chest.tryOpen(s.classKey, strMod, dexMod, s.level, this.currentFloor);

        if (result.message) {
          this.events.emit("hud:status", result.message);
        }

        if (result.trapTriggered) {
          const wx = chest.x;
          const wy = chest.y;
          const tx = Math.floor(wx / TILE_SIZE);
          const ty = Math.floor(wy / TILE_SIZE);
          this.triggerTrap(result.trapTriggered, tx, ty, `${tx},${ty}`);
        }

        if (result.opened && result.loot) {
          const { gold, items } = result.loot;

          if (gold > 0) {
            s.gold += gold;
            this.spawnFloatingText(chest.x, chest.y - 20, `+${gold} gold`, COLORS.GOLD_TEXT);
          }

          for (const lootItem of items) {
            this.applyLootItem(lootItem);
          }

          this.emitHUD();
        }
      }
    }
  }

  private applyLootItem(item: { type: string; label: string; bonus?: number; statKey?: string; value?: number }) {
    const s = this.player.stats;

    switch (item.type) {
      case 'HEALTH_POTION':
        this.player.heal(item.value ?? 30);
        this.events.emit("hud:status", `Found: ${item.label}`);
        break;
      case 'XP_ORB':
        this.player.gainXP(item.value ?? 40);
        this.events.emit("hud:status", `Found: ${item.label}`);
        break;
      case 'WEAPON':
        s.weaponBonus += item.bonus ?? 1;
        s.attack += item.bonus ?? 1;
        this.events.emit("hud:status", `Equipped: ${item.label} (+${item.bonus} ATK)`);
        break;
      case 'ARMOR':
        s.armorBonus += item.bonus ?? 1;
        s.defense += item.bonus ?? 1;
        this.events.emit("hud:status", `Equipped: ${item.label} (+${item.bonus} DEF)`);
        break;
      case 'STAT_TOME':
        if (item.statKey) {
          const k = item.statKey as keyof typeof s;
          if (typeof s[k] === 'number') {
            (s as unknown as Record<string, number>)[item.statKey] += 1;
            this.player.recomputeDerived();
            this.events.emit("hud:status", `Read: ${item.label} (+1 ${item.statKey.toUpperCase()})`);
          }
        }
        break;
      case 'SCROLL':
        this.events.emit("hud:status", `Found scroll: ${item.label} (auto-used)`);
        // Auto-cast if player can use it
        if (item.statKey && this.spellSystem) {
          // Simple: heal or deal damage
        }
        break;
    }
    this.spawnFloatingText(this.player.x, this.player.y - 20, item.label, COLORS.GOLD_TEXT, 11);
  }

  // ── Items ─────────────────────────────────────────────────────────────────

  private checkItemPickup() {
    const pickupRange = TILE_SIZE * 0.8;

    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      const dx = this.player.x - item.x;
      const dy = this.player.y - item.y;
      if (Math.sqrt(dx * dx + dy * dy) < pickupRange) {
        const type = (item as Phaser.GameObjects.Sprite & { itemType: string }).itemType;
        this.applyItem(type);
        item.destroy();
        this.items.splice(i, 1);
      }
    }
  }

  private applyItem(type: string) {
    const p = this.player.stats;
    switch (type) {
      case "HEALTH_POTION":
        this.player.heal(30);
        this.events.emit("hud:status", "Health Potion +30 HP");
        break;
      case "WEAPON":
        p.attack += 5;
        p.weaponBonus += 5;
        this.spawnFloatingText(this.player.x, this.player.y - 30, "ATK +5", COLORS.WEAPON);
        this.events.emit("hud:status", "Weapon Upgrade +5 ATK");
        this.emitHUD();
        break;
      case "ARMOR":
        p.defense += 2;
        p.armorBonus += 2;
        this.spawnFloatingText(this.player.x, this.player.y - 30, "DEF +2", COLORS.ARMOR);
        this.events.emit("hud:status", "Armor Shard +2 DEF");
        this.emitHUD();
        break;
      case "XP_ORB":
        this.player.gainXP(40);
        this.events.emit("hud:status", "XP Orb +40 XP");
        break;
    }
  }

  // ── Stairs ────────────────────────────────────────────────────────────────

  private checkStairs() {
    const { tx, ty } = this.dungeon.stairsPos;
    const sx = tx * TILE_SIZE + TILE_SIZE / 2;
    const sy = ty * TILE_SIZE + TILE_SIZE / 2;
    const dx = this.player.x - sx;
    const dy = this.player.y - sy;
    if (Math.sqrt(dx * dx + dy * dy) < TILE_SIZE * 0.7) {
      this.nextFloor();
    }
  }

  private nextFloor() {
    this.cameras.main.fade(300, 0, 0, 0, false, (_cam: Phaser.Cameras.Scene2D.Camera, t: number) => {
      if (t === 1) {
        const persistedStats = this.player.getSerializable();
        persistedStats.floor = this.currentFloor + 1;
        this.scene.restart({
          floor: this.currentFloor + 1,
          persistedStats,
        });
      }
    });
  }

  // ── Death ─────────────────────────────────────────────────────────────────

  private handlePlayerDeath() {
    this.player.setTint(0x888888);
    this.time.delayedCall(800, () => {
      this.scene.start("GameOverScene", {
        floor: this.currentFloor,
        kills: this.kills,
        level: this.player.stats.level,
      });
    });
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private spawnFloatingText(x: number, y: number, text: string, color: number, size = 14) {
    const hex = `#${color.toString(16).padStart(6, "0")}`;
    const obj = this.add.text(x, y, text, {
      fontSize: `${size}px`,
      color: hex,
      fontFamily: "monospace",
      stroke: "#000",
      strokeThickness: 2,
    }).setDepth(20).setOrigin(0.5);

    this.floatingTexts.push({ obj, vy: -60, life: 900 });
  }

  private updateFloatingTexts(delta: number) {
    const dt = delta / 1000;
    for (let i = this.floatingTexts.length - 1; i >= 0; i--) {
      const ft = this.floatingTexts[i];
      ft.life -= delta;
      ft.obj.y += ft.vy * dt;
      ft.vy *= 0.95;
      ft.obj.setAlpha(Math.max(0, ft.life / 900));
      if (ft.life <= 0) {
        ft.obj.destroy();
        this.floatingTexts.splice(i, 1);
      }
    }
  }
}
