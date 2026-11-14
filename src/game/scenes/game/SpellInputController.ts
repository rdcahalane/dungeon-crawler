import * as Phaser from "phaser";
import { CHARACTER_CLASSES, SpellKey, SPELLS } from "../../constants";
import { SpellSystem } from "../../systems/SpellSystem";
import type { GameContext } from "../../GameContext";

/** Spell hotkeys (1-4) and the legacy `SpellSystem` wiring. */
export class SpellInputController {
  spellSystem!: SpellSystem;
  private spellHotkeys: Phaser.Input.Keyboard.Key[] = [];
  /** Spell keys bound to hotkeys 1..4, in order. The HUD reads this through `emitHUD`. */
  spellHotkeyMap: SpellKey[] = [];

  constructor(private ctx: GameContext) {}

  create() {
    const scene = this.ctx.scene;
    this.spellSystem = new SpellSystem(scene);
    const classDef = CHARACTER_CLASSES[this.ctx.player.stats.classKey];
    const hotkeyKeyCodes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
    ];

    this.spellHotkeys = [];
    this.spellHotkeyMap = [];

    classDef.spellKeys.forEach((spellKey, i) => {
      if (i < hotkeyKeyCodes.length) {
        this.spellHotkeys.push(scene.input.keyboard!.addKey(hotkeyKeyCodes[i]));
        this.spellHotkeyMap.push(spellKey);
      }
    });
  }

  /** Hotkey presses. */
  update() {
    const ctx = this.ctx;
    if (!this.spellSystem) return;
    const ptr = ctx.scene.input.activePointer;

    this.spellHotkeys.forEach((key, i) => {
      if (!Phaser.Input.Keyboard.JustDown(key)) return;
      const spellKey = this.spellHotkeyMap[i];
      if (!spellKey) return;

      if (spellKey === 'TURN_UNDEAD') { ctx.combat.doTurnUndead(); return; }

      const cast = this.spellSystem.cast(
        spellKey, ctx.player, ctx.enemies, ctx.dungeon.tiles,
        ptr.worldX, ptr.worldY,
      );
      if (cast) {
        ctx.floatText(ctx.player.x, ctx.player.y - 30, `${SPELLS[spellKey].name}!`, SPELLS[spellKey].color, 12);
        ctx.bus.emit('spell_cast', { key: spellKey });
      } else {
        ctx.status("Not enough mana!");
        ctx.bus.emit('spell_fizzle');
      }
      ctx.emitHUD();
    });
  }

  /** Projectile and cooldown tick (end of the frame, as before). */
  tick(delta: number) {
    if (this.spellSystem) {
      this.spellSystem.update(delta, this.ctx.enemies, this.ctx.player);
    }
  }

  destroy() {
    // Keys and listeners are released with the scene.
  }
}
