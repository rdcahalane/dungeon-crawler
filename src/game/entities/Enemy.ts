import * as Phaser from "phaser";
import { TILE_SIZE, ENEMY_TYPES, EnemyTypeKey } from "../constants";
import { MONSTERS, hasSpecial, mathRng, rollMonsterHp, isTurnable } from "../rules";
import type { BossPhase, MonsterDef } from "../rules";

export type EnemyStatus = "asleep" | "held" | "webbed";

/**
 * A monster. Hit points, armor class, THAC0, attacks, XP and specials come from the bestiary (`rules/bestiary`);
 * this class owns movement, the AI state machine and the timers. Rolling to hit lives in `CombatController`.
 */
export class Enemy extends Phaser.Physics.Arcade.Sprite {
  public typeKey: EnemyTypeKey;
  public def: MonsterDef;
  public hp: number;
  public maxHp: number;
  /** Descending armor class. */
  public ac: number;
  public thac0: number;
  public speed: number;
  public xp: number;
  public attackRange: number;
  public aggroRange: number;
  public attackCooldown: number;
  public isElite: boolean;
  /** Set on monsters a boss summoned, so the boss can count them. */
  public summonedBy?: Enemy;

  /** Magical status: asleep and held creatures are struck automatically, webbed ones cannot move or attack. */
  public status: EnemyStatus | null = null;
  private _statusMs = 0;
  /** Has attacked or been hurt: no longer caught off guard. */
  private _engaged = false;

  private _attackTimer = 0;
  private _aiState: "idle" | "chase" | "attack" | "flee" = "idle";
  private hpBar!: Phaser.GameObjects.Rectangle;
  private hpBarBg!: Phaser.GameObjects.Rectangle;
  private nameTag!: Phaser.GameObjects.Text;
  private threatRing!: Phaser.GameObjects.Arc;

  // Regeneration (troll): fire and acid stop it for a few seconds.
  private _regenTimer = 0;
  private _regenBlockedMs = 0;

  // Flee state (Turn Undead)
  private _fleeTimer = 0;
  private _fleeDir = { x: 0, y: 0 };

  // Mimic: hidden until revealed
  private _mimicRevealed = false;

  // Special behavior timers
  private _specialTimer = 0;
  private _reformed = false;
  private _casterTimer = 0;
  private _summonTimer = 0;
  private _phaseIdx = 0;
  private _erraticTimer = 0;
  private _erraticAngle = 0;

  constructor(scene: Phaser.Scene, x: number, y: number, typeKey: EnemyTypeKey, elite = false) {
    const def = MONSTERS[typeKey];
    const look = ENEMY_TYPES[typeKey];
    // A texture the art lane has not delivered yet falls back to the generic enemy sprite.
    super(scene, x, y, scene.textures.exists(def.textureKey) ? def.textureKey : "enemy");
    scene.add.existing(this);
    scene.physics.add.existing(this);

    this.typeKey = typeKey;
    this.def = def;
    this.isElite = elite;

    this.maxHp = Math.max(1, Math.ceil(rollMonsterHp(def, mathRng) * (elite ? 1.5 : 1)));
    this.hp = this.maxHp;
    this.ac = def.ac;
    this.thac0 = def.thac0 - (elite ? 1 : 0);
    this.speed = def.speed * (elite ? 1.08 : 1);
    this.xp = Math.ceil(def.xp * (elite ? 2.4 : 1));
    this.attackRange = def.attackRange;
    this.aggroRange = def.aggroRange;
    this.attackCooldown = def.attackCooldownMs;
    this._casterTimer = (hasSpecial(def, "caster")?.cooldownMs ?? 0) * 0.6;
    this._summonTimer = (hasSpecial(def, "summon")?.everyMs ?? 0) * 0.5;

    const size = elite ? Math.ceil(def.size * 1.25) : def.size;
    this.setDisplaySize(size, size);
    this.setDepth(9);

    const body = this.body as Phaser.Physics.Arcade.Body;
    body.setSize(size - 12, size - 12);

    // Mimic starts invisible (disguised as chest in the loot controller)
    if (this.isMimic) {
      this.setAlpha(0);
      this.setActive(false);
    } else {
      this.setTint(look.color);
    }

    // Incorporeal things are translucent.
    if (hasSpecial(def, "incorporeal")) this.setAlpha(0.7);

    this.threatRing = scene.add.arc(x, y, size * (elite ? 0.9 : 0.72), 0, 360, false, elite ? 0xffd166 : look.color, elite ? 0.42 : 0.2)
      .setDepth(8);

    // HP bar
    this.hpBarBg = scene.add.rectangle(x, y - size / 2 - 6, size, 4, 0x333333).setDepth(11);
    this.hpBar = scene.add.rectangle(x - size / 2, y - size / 2 - 6, size, 4, 0x4caf50)
      .setOrigin(0, 0.5).setDepth(12);
    const label = this._shortName();
    this.nameTag = scene.add.text(x, y + size / 2 + 5, elite ? `*${label}*` : label, {
      fontSize: '8px',
      color: `#${(elite ? 0xffd166 : look.color).toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace',
      stroke: '#000',
      strokeThickness: 2,
    }).setOrigin(0.5, 0).setDepth(12);

    if (elite) {
      this.setTint(0xffd166);
      scene.tweens.add({
        targets: this.threatRing,
        alpha: 0.12,
        scaleX: 1.25,
        scaleY: 1.25,
        duration: 800,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  private get baseColor(): number {
    return this.isElite ? 0xffd166 : ENEMY_TYPES[this.typeKey].color;
  }

  // ── Per-frame ───────────────────────────────────────────────────────────

  update(delta: number, playerX: number, playerY: number) {
    if (this.hp <= 0) return;

    // Mimic: stay hidden until aggro range
    if (this.isMimic && !this._mimicRevealed) {
      const dx = playerX - this.x;
      const dy = playerY - this.y;
      if (Math.sqrt(dx * dx + dy * dy) <= this.aggroRange) {
        this._revealMimic();
      } else {
        return; // don't do anything until revealed
      }
    }

    this._attackTimer = Math.max(0, this._attackTimer - delta);
    this._specialTimer = Math.max(0, this._specialTimer - delta);
    this._casterTimer = Math.max(0, this._casterTimer - delta);
    this._summonTimer = Math.max(0, this._summonTimer - delta);
    this._regenBlockedMs = Math.max(0, this._regenBlockedMs - delta);

    const body = this.body as Phaser.Physics.Arcade.Body;

    // Status: asleep, held and webbed creatures do nothing until it runs out.
    if (this.status) {
      this._statusMs -= delta;
      if (this._statusMs <= 0) this.clearStatus();
      else {
        body.setVelocity(0, 0);
        this.updateHpBar();
        return;
      }
    }

    // Regeneration: hp per second, stopped for a while by fire or acid.
    const regen = hasSpecial(this.def, "regen");
    if (regen && this._regenBlockedMs <= 0 && this.hp < this.maxHp) {
      this._regenTimer += delta;
      if (this._regenTimer >= 1000) {
        this._regenTimer -= 1000;
        this.hp = Math.min(this.maxHp, this.hp + regen.hpPerSec);
      }
    }

    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const distToPlayer = Math.sqrt(dx * dx + dy * dy);
    const moveLen = distToPlayer || 1;

    // Flee state (Turn Undead)
    if (this._aiState === 'flee') {
      this._fleeTimer = Math.max(0, this._fleeTimer - delta);
      if (this._fleeTimer <= 0) {
        this._aiState = 'idle';
      } else {
        body.setVelocity(this._fleeDir.x * this.speed, this._fleeDir.y * this.speed);
        this.updateHpBar();
        return;
      }
    }

    // Aggro check
    if (distToPlayer <= this.aggroRange) {
      this._aiState = 'chase';
    }

    if (this._aiState === 'chase') {
      if (this.typeKey === 'FAST' && this._specialTimer <= 0 && distToPlayer > 55 && distToPlayer < 170) {
        this._specialTimer = this.isElite ? 900 : 1300;
        body.setVelocity((dx / moveLen) * this.speed * 2.35, (dy / moveLen) * this.speed * 2.35);
        this.scene.tweens.add({ targets: this, alpha: 0.45, duration: 70, yoyo: true });
        this.updateHpBar();
        return;
      }

      if (this.typeKey === 'DARK_ELF' && distToPlayer < 85 && this._specialTimer <= 0) {
        this._specialTimer = 2400;
        const bounds = this.scene.physics.world.bounds;
        const blinkX = Phaser.Math.Clamp(this.x - (dx / moveLen) * 96, bounds.x + 24, bounds.right - 24);
        const blinkY = Phaser.Math.Clamp(this.y - (dy / moveLen) * 96, bounds.y + 24, bounds.bottom - 24);
        this.setPosition(blinkX, blinkY);
        this.setTint(0xce93d8);
        this.scene.time.delayedCall(120, () => {
          if (this.active) this.setTint(this.baseColor);
        });
      }

      const ranged = hasSpecial(this.def, "ranged");
      if (ranged) {
        if (ranged.keepsDistance && distToPlayer < 100) {
          body.setVelocity(-(dx / moveLen) * this.speed, -(dy / moveLen) * this.speed);
        } else if (distToPlayer > this.attackRange) {
          body.setVelocity((dx / moveLen) * this.speed * 0.6, (dy / moveLen) * this.speed * 0.6);
        } else {
          body.setVelocity(0, 0);
        }
      } else if (hasSpecial(this.def, "erratic") && distToPlayer > this.attackRange) {
        // Bats flutter: re-pick a wobble every so often and drift toward the player.
        this._erraticTimer -= delta;
        if (this._erraticTimer <= 0) {
          this._erraticTimer = 180 + Math.random() * 220;
          this._erraticAngle = (Math.random() - 0.5) * 2.2;
        }
        const base = Math.atan2(dy, dx) + this._erraticAngle;
        body.setVelocity(Math.cos(base) * this.speed, Math.sin(base) * this.speed);
      } else {
        if (distToPlayer > this.attackRange + 8) {
          body.setVelocity((dx / moveLen) * this.speed, (dy / moveLen) * this.speed);
        } else {
          body.setVelocity(0, 0);
        }
      }
    } else {
      body.setVelocity(0, 0);
    }

    this.updateHpBar();
  }

  // ── Status ──────────────────────────────────────────────────────────────

  applyStatus(kind: EnemyStatus, ms: number) {
    this.status = kind;
    this._statusMs = ms;
    this.setTint(kind === 'asleep' ? 0x8899ff : kind === 'held' ? 0xcfd8dc : 0xeeeeee);
  }

  clearStatus() {
    this.status = null;
    this._statusMs = 0;
    if (this.active) this.setTint(this.baseColor);
  }

  /**
   * Caught off guard: asleep, held, or not yet in the fight (it has neither attacked nor been struck). A thief
   * gets a backstab on the first blow, and any blow at all on a sleeper.
   */
  get isUnaware(): boolean {
    if (this.status === 'asleep' || this.status === 'held') return true;
    return !this._engaged && this._aiState !== 'flee' && !(this.isMimic && !this._mimicRevealed);
  }

  /** Asleep or held: every blow lands. */
  get isHelpless(): boolean {
    return this.status === 'asleep' || this.status === 'held';
  }

  get fleeing(): boolean {
    return this._aiState === 'flee';
  }

  // ── Skeletons, mimics, turning ──────────────────────────────────────────

  tryReform(): boolean {
    if (this.typeKey !== 'SKELETON' || this._reformed || this.isElite) return false;
    if (Math.random() > 0.45) return false;
    this._reformed = true;
    this.hp = Math.max(2, Math.ceil(this.maxHp * 0.5));
    this.updateHpBar();
    this.setTint(0xe0e0e0);
    this.scene.tweens.add({ targets: this, scaleX: 1.25, scaleY: 1.25, duration: 90, yoyo: true });
    return true;
  }

  /** A chest turned out to be a mimic: show it and send it after the player. */
  revealMimic() {
    this._revealMimic();
  }

  private _revealMimic() {
    this._mimicRevealed = true;
    this._aiState = 'chase';
    this.setAlpha(1);
    this.setActive(true);
    this.setTint(0xff4444);
    this.scene.time.delayedCall(200, () => {
      if (this.active) this.setTint(this.baseColor);
    });
  }

  /** Turn Undead sends turnable undead running. Returns false for things that ignore it. */
  forceFleeFrom(fromX: number, fromY: number, duration = 10000): boolean {
    if (!isTurnable(this.def)) return false;
    this._aiState = 'flee';
    this._fleeTimer = duration;
    const dx = this.x - fromX;
    const dy = this.y - fromY;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    this._fleeDir = { x: dx / len, y: dy / len };
    return true;
  }

  // ── Attacking ───────────────────────────────────────────────────────────

  canAttackPlayer(playerX: number, playerY: number): boolean {
    if (this._attackTimer > 0 || this.hp <= 0 || this._aiState === 'flee' || this.status) return false;
    if (this.isMimic && !this._mimicRevealed) return false;
    const dx = playerX - this.x;
    const dy = playerY - this.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    return dist <= this.attackRange + TILE_SIZE / 2;
  }

  /** Start the cooldown and flash. The combat controller rolls the attacks. */
  beginAttack() {
    this._engaged = true;
    this._attackTimer = this.attackCooldown;
    this.setTint(0xffffff);
    this.scene.time.delayedCall(80, () => {
      if (this.active) this.setTint(this.baseColor);
    });
  }

  /** A caster that is ready to cast returns the spell key it picked and restarts its timer. */
  takeSpellTurn(distToPlayer: number): string | null {
    const caster = hasSpecial(this.def, "caster");
    if (!caster || this._casterTimer > 0 || this.status || this._aiState === 'flee') return null;
    if (this.isMimic && !this._mimicRevealed) return null;
    if (distToPlayer > 230 || this._aiState !== 'chase') return null;
    this._casterTimer = caster.cooldownMs;
    return caster.spells[Math.floor(Math.random() * caster.spells.length)] ?? null;
  }

  /** True once per summon interval for bosses that call help. */
  summonDue(): boolean {
    const summon = hasSpecial(this.def, "summon");
    if (!summon || this.status || this._aiState !== 'chase') return false;
    if (this._summonTimer > 0) return false;
    this._summonTimer = summon.everyMs;
    return true;
  }

  /** The boss phase just crossed by the last blow, if any. Applies its speed and cooldown changes. */
  checkPhase(): BossPhase | null {
    const phases = hasSpecial(this.def, "phases")?.phases;
    if (!phases || this._phaseIdx >= phases.length) return null;
    const next = phases[this._phaseIdx];
    if (this.hp / this.maxHp * 100 > next.hpBelowPct) return null;
    this._phaseIdx++;
    if (next.speedMult) this.speed *= next.speedMult;
    if (next.cooldownMult) this.attackCooldown *= next.cooldownMult;
    this.scene.tweens.add({ targets: this, scaleX: 1.3, scaleY: 1.3, duration: 140, yoyo: true });
    return next;
  }

  get isRanged(): boolean {
    return !!hasSpecial(this.def, "ranged");
  }

  get isMimic(): boolean {
    return !!hasSpecial(this.def, "mimic");
  }

  get mimicRevealed(): boolean {
    return this._mimicRevealed;
  }

  get isUndead(): boolean {
    return !!this.def.undead;
  }

  // ── Taking hits ─────────────────────────────────────────────────────────

  /** Subtract damage that has already passed to-hit (and the immunity check). Returns what was dealt. */
  takeDamage(amount: number, opts: { fire?: boolean; acid?: boolean } = {}): number {
    const dmg = Math.max(1, Math.round(amount));
    this.hp = Math.max(0, this.hp - dmg);
    this._engaged = true;
    const regen = hasSpecial(this.def, "regen");
    if (regen?.stoppedBy && ((regen.stoppedBy === 'fire' && opts.fire) || (regen.stoppedBy === 'acid' && opts.acid))) {
      this._regenBlockedMs = 6000;
    }
    // Fire burns webs away.
    if (opts.fire && this.status === 'webbed') this.clearStatus();
    this.updateHpBar();

    this.setTint(0xffffff);
    this.scene.time.delayedCall(100, () => {
      if (this.active && this.hp > 0) this.setTint(this.status ? 0xcfd8dc : this.baseColor);
    });

    return dmg;
  }

  private updateHpBar() {
    const size = this.def.size;
    const pct = Math.max(0, this.hp / this.maxHp);

    // Hide HP bar for unrevealed mimics
    const visible = !(this.isMimic && !this._mimicRevealed);
    this.hpBarBg.setVisible(visible);
    this.hpBar.setVisible(visible);
    this.nameTag.setVisible(visible);
    this.threatRing.setVisible(visible);

    this.threatRing.setPosition(this.x, this.y);
    this.hpBarBg.setPosition(this.x, this.y - size / 2 - 6);
    this.hpBar.setPosition(this.x - size / 2, this.y - size / 2 - 6);
    this.nameTag.setPosition(this.x, this.y + size / 2 + 5);
    this.hpBar.setDisplaySize(size * pct, 4);
    this.hpBar.setFillStyle(pct > 0.5 ? 0x4caf50 : pct > 0.25 ? 0xffa726 : 0xf44336);
  }

  private _shortName(): string {
    const labels: Partial<Record<EnemyTypeKey, string>> = {
      BASIC: 'GOB', FAST: 'KOB', TANK: 'ORC', SKELETON: 'SKL', ZOMBIE: 'ZOM', GIANT_RAT: 'RAT',
      GIANT_SPIDER: 'SPD', TROLL: 'TRL', DARK_ELF: 'ELF', GHOST: 'GST', MIMIC: 'MIM',
      GHOUL: 'GHL', WIGHT: 'WGT', WRAITH: 'WRT', GARGOYLE: 'GRG', OOZE: 'OOZ', CULTIST: 'CLT',
      BONE_KNIGHT: 'BKN', GIANT_BAT: 'BAT', HOLLOW_KING: 'KING',
    };
    return labels[this.typeKey] ?? this.def.name.slice(0, 3).toUpperCase();
  }

  destroy(fromScene?: boolean) {
    this.hpBar?.destroy();
    this.hpBarBg?.destroy();
    this.nameTag?.destroy();
    this.threatRing?.destroy();
    super.destroy(fromScene);
  }
}
