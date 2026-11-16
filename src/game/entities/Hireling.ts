import * as Phaser from "phaser";
import { TILE_SIZE } from "../constants";
import { retroText } from "../gfx/font";
import { HIRELINGS, firstName, type HirelingDef, type HirelingState } from "../rules/hirelings";

const UI_RED = 0xd8382c;
const UI_GOLD = 0xf4c42c;
const UI_WHITE = 0xf4f0f8;

/** Seconds-per-step of the two-frame walk. */
const WALK_FRAME_MS = 180;

/**
 * A hired companion on the dungeon floor. A plain sprite with no physics body: it never blocks a corridor, the
 * player and the monsters walk through it, and `PartyController` moves it along tiles it has checked itself.
 * The state (`HirelingState`) is the same object saved on the character.
 */
export class Hireling extends Phaser.GameObjects.Sprite {
  readonly info: HirelingState;
  readonly def: HirelingDef;

  /** Remaining tile waypoints toward the goal (set by the controller). */
  path: Array<{ tx: number; ty: number }> = [];
  pathKey = "";
  repathMs = 0;
  /** Ms until the next spear thrust. */
  swingMs = 0;
  /** Ms left running from a fight after a failed morale check (man-at-arms). */
  fleeMs = 0;
  /** Set by the controller each frame the hireling actually moved. */
  moving = false;
  /** Ms spent unable to reach where he wants to be (the controller snaps him to the player after a while). */
  stuckMs = 0;

  private tag: Phaser.GameObjects.BitmapText;
  private walkMs = 0;
  private stepTwo = false;

  constructor(scene: Phaser.Scene, x: number, y: number, state: HirelingState) {
    const def = HIRELINGS[state.kind];
    super(scene, x, y, scene.textures.exists(def.textureKey) ? def.textureKey : "npc");
    scene.add.existing(this);
    this.info = state;
    this.def = def;
    this.setDisplaySize(TILE_SIZE, TILE_SIZE);
    // Under the player (49) and the fog (50), above the floor and the monsters.
    this.setDepth(48.8);
    this.tag = retroText(scene, x, y - TILE_SIZE / 2 - 2, "", { size: 16, color: UI_WHITE, originX: 0.5, originY: 1 })
      .setDepth(48.9);
    this.refreshLabel();
  }

  /** "ODO 3/3": first name and hit points, tinted by how he is doing. */
  refreshLabel(): void {
    const s = this.info;
    const text = `${firstName(s.name).toUpperCase()} ${Math.max(0, s.hp)}/${s.maxHp}`;
    if (this.tag.text !== text) this.tag.setText(text);
    const frac = s.maxHp > 0 ? s.hp / s.maxHp : 0;
    this.tag.setTint(frac <= 0.34 ? UI_RED : frac <= 0.67 ? UI_GOLD : UI_WHITE);
  }

  /** Per frame: keep the label on the head and run the two-frame walk. */
  tick(deltaMs: number): void {
    // The two labels sit at different heights so they stay readable when the hirelings stand together.
    this.tag.setPosition(Math.round(this.x), Math.round(this.y - TILE_SIZE / 2 - 2 - (this.def.fights ? 18 : 0)));
    this.swingMs = Math.max(0, this.swingMs - deltaMs);
    const second = `${this.def.textureKey}_f2`;
    if (this.moving && this.scene.textures.exists(second)) {
      this.walkMs += deltaMs;
      if (this.walkMs >= WALK_FRAME_MS) {
        this.walkMs = 0;
        this.stepTwo = !this.stepTwo;
        this.setTexture(this.stepTwo ? second : this.def.textureKey);
      }
    } else if (this.stepTwo) {
      this.stepTwo = false;
      this.setTexture(this.def.textureKey);
    }
  }

  /** Brief tint flash for a hit taken or a spear thrust. */
  flash(color: number): void {
    this.setTint(color);
    this.scene.time.delayedCall(110, () => {
      if (this.active) this.clearTint();
    });
  }

  /** A panicked hireling bolts into the dark: runs a little way off while fading, then is gone. */
  bolt(dx: number, dy: number): void {
    this.tag.setVisible(false);
    this.scene.tweens.add({
      targets: this,
      x: this.x + dx,
      y: this.y + dy,
      alpha: 0,
      duration: 600,
      onComplete: () => this.destroy(),
    });
  }

  /** Tile the sprite stands on. */
  get tileX(): number {
    return Math.floor(this.x / TILE_SIZE);
  }

  get tileY(): number {
    return Math.floor(this.y / TILE_SIZE);
  }

  destroy(fromScene?: boolean): void {
    this.tag?.destroy();
    super.destroy(fromScene);
  }
}
