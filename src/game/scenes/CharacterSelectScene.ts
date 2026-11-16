import { setTextEntry } from "../textEntry";
import { DomTextField } from "../domTextInput";
import { isTouchDevice } from "../touch";
import * as Phaser from "phaser";
import { CHARACTER_CLASSES, ClassKey } from "../constants";
import { CharCreationData } from "../entities/Player";
import { thac0For, saveTarget, hitDie, titleFor, spellSlots, SAVE_CATEGORIES, mathRng } from "../rules";
import { primeRequisite, type AbilityKey } from "../rules";
import { ChargenSession, CHARGEN_ORDER, reportScores, xpBonusLabel } from "../rules/chargen";
import { starterKit, displayName } from "../items";
import { playerArmorClass, playerThac0, startingHp } from "./game/AdndCombat";
import { CLASS_COL, COL, flatPanel, uiText } from "../gfx/retroUi";
import { LINE, wrap } from "./ui/theme";
import { Sfx } from "../audio/Sfx";

const ABILITY_DESCRIPTIONS: Record<AbilityKey, string> = {
  str: 'Strength: melee to-hit and damage',
  dex: 'Dexterity: armor class, missiles, thieving',
  con: 'Constitution: hit points per level',
  int: 'Intelligence: wizard spells learned',
  wis: 'Wisdom: cleric bonus spells, saves',
  cha: 'Charisma: reaction of strangers',
};

export class CharacterSelectScene extends Phaser.Scene {
  /** 1 class, 2 rolled abilities, 3 name. */
  private step: 1 | 2 | 3 = 1;
  private selectedClass: ClassKey = 'fighter';
  private saveSlot = 1; // which slot to save to

  // Rolled abilities (4d6, drop the lowest, six times; reroll as often as you like; one swap per roll)
  private session = new ChargenSession(mathRng);
  private arranging = false;
  /** While arranging: the first score picked, waiting for the second. */
  private arrangePick: AbilityKey | null = null;

  // Name input (Step 3)
  private characterName = '';
  private _nameInputActive = false;
  private _cursorVisible = true;
  private _cursorTimer?: Phaser.Time.TimerEvent;
  private _nameKeydownHandler?: (e: KeyboardEvent) => void;
  /** The phone keyboard's input, alive for the whole name step so a re-draw does not lower the keyboard. */
  private _nameField?: DomTextField;

  private container!: Phaser.GameObjects.Container;
  private _abilityHint?: Phaser.GameObjects.BitmapText;

  init(data: { saveSlot?: number }) {
    this.saveSlot = data?.saveSlot ?? 1;
    // Reset state on re-entry
    this.step = 1;
    this.selectedClass = 'fighter';
    this.session = new ChargenSession(mathRng);
    this.arranging = false;
    this.arrangePick = null;
    this.characterName = '';
  }

  constructor() {
    super({ key: 'CharacterSelectScene' });
  }

  create() {
    const { width, height } = this.scale;

    // Flat dark backdrop, no gradients.
    this.add.rectangle(width / 2, height / 2, width, height, COL.black);

    uiText(this, width / 2, 12, '"THE DUNGEON AWAITS. FEW RETURN."', { size: 16, color: COL.grey, originX: 0.5 });

    this.container = this.add.container(0, 0);
    this.renderStep();

    // Keyboard for steps 1 and 2 (the name step listens on the page itself, so letters can be typed).
    this.input.keyboard!.on('keydown', this._onKey, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.keyboard?.off('keydown', this._onKey, this);
      this._cleanupNameInput();
      this._destroyNameField();
    });
  }

  private clearContainer() {
    this.container.removeAll(true);
  }

  // ── Step 1: Class Picker ───────────────────────────────────────────────────

  private renderStep() {
    this._cleanupNameInput();
    if (this.step !== 3) this._destroyNameField();
    this.clearContainer();
    switch (this.step) {
      case 1: this.renderClassPicker(); break;
      case 2: this.renderAbilityRoll(); break;
      case 3: this.renderNameInput(); break;
    }
  }

  private _goTo(step: 1 | 2 | 3) {
    this.step = step;
    this.arranging = false;
    this.arrangePick = null;
    this.renderStep();
  }

  private _onKey(e: KeyboardEvent) {
    if (this.step === 1) {
      const keys = Object.keys(CHARACTER_CLASSES) as ClassKey[];
      const i = keys.indexOf(this.selectedClass);
      if (e.code === 'ArrowLeft') { this.selectedClass = keys[(i + keys.length - 1) % keys.length]; Sfx.play('ui_select'); this.renderStep(); }
      else if (e.code === 'ArrowRight') { this.selectedClass = keys[(i + 1) % keys.length]; Sfx.play('ui_select'); this.renderStep(); }
      else if (/^Digit[1-4]$/.test(e.code)) { this.selectedClass = keys[Number(e.code.slice(5)) - 1] ?? this.selectedClass; Sfx.play('ui_select'); this.renderStep(); }
      else if (e.code === 'Enter' || e.code === 'NumpadEnter') { this._goTo(2); }
      return;
    }
    if (this.step !== 2) return;
    if (e.code === 'KeyR') this._rollAgain();
    else if (e.code === 'KeyA') this._toggleArrange();
    else if (/^Digit[1-6]$/.test(e.code) && this.arranging) this._pickForSwap(CHARGEN_ORDER[Number(e.code.slice(5)) - 1]);
    else if (e.code === 'Enter' || e.code === 'NumpadEnter') this._goTo(3);
    else if (e.code === 'Escape') {
      if (this.arranging) { this.arranging = false; this.arrangePick = null; this.renderStep(); }
      else this._goTo(1);
    }
  }

  private renderClassPicker() {
    const { width, height } = this.scale;
    this._heading('CHOOSE YOUR CLASS', 'STEP 1 OF 3  (LEFT/RIGHT, ENTER)', COL.gold);

    const classKeys = Object.keys(CHARACTER_CLASSES) as ClassKey[];
    const cardW = 216;
    const cardH = 440;
    const gap = 12;
    const startX = (width - (cardW * 4 + gap * 3)) / 2 + cardW / 2;
    const cy = 100 + cardH / 2;

    classKeys.forEach((key, i) => {
      const cls = CHARACTER_CLASSES[key];
      const cx = startX + i * (cardW + gap);
      const isSelected = key === this.selectedClass;
      const tone = CLASS_COL[key] ?? COL.silver;
      const bgColor = isSelected ? COL.dusk : COL.ink;

      const bg = flatPanel(this, cx, cy, cardW, cardH, { fill: bgColor, border: isSelected ? tone : COL.slate })
        .setInteractive({ useHandCursor: true });
      this.container.add(bg);

      // The class sprite, 3x (the sprite is 32px, so 96px on screen, nearest-neighbour).
      const sprite = this.add.image(cx, cy - cardH / 2 + 54, `player_${key}`).setScale(3);
      this.container.add(sprite);

      this.container.add(uiText(this, cx, cy - cardH / 2 + 106, cls.name.toUpperCase(), {
        size: 24, color: tone, originX: 0.5,
      }));

      // First-edition numbers: hit die, THAC0, level title, the death save, gold and slots, starting kit.
      const kit = starterKit(key);
      const slots = spellSlots(key, 1).reduce((a, b) => a + b, 0);
      const lines = [
        `D${hitDie(key)}  THAC0 ${thac0For(key, 1)}`,
        titleFor(key, 1).toUpperCase().slice(0, 16),
        `DEATH SAVE ${saveTarget(key, 1, 'death')}`,
        `${kit.gold} GP${slots > 0 ? `  ${slots} SLOT${slots > 1 ? 'S' : ''}` : ''}`,
      ];
      this._lines(cx, cy - cardH / 2 + 142, lines, COL.silver, true);

      const gear = kit.equipped().filter(it => it.defKey !== 'torch').map(it => displayName(it)).join(', ');
      this._lines(cx, cy - cardH / 2 + 226, wrap(gear.toUpperCase(), 16).slice(0, 4), COL.grey, true);

      // Class ability
      this._lines(cx, cy - cardH / 2 + 316, wrap(cls.classAbility.toUpperCase(), 16).slice(0, 6), COL.cream, true);

      bg.on('pointerover', () => { if (!isSelected) bg.setFillStyle(COL.dusk); });
      bg.on('pointerout', () => { if (!isSelected) bg.setFillStyle(bgColor); });
      bg.on('pointerdown', () => {
        this.selectedClass = key;
        Sfx.play('ui_select');
        this.renderStep();
      });
    });

    // Next button
    const nextBtn = this._makeButton(width / 2, height - 50, 'NEXT >', 200, 44);
    nextBtn.bg.on('pointerdown', () => {
      this.step = 2;
      this.renderStep();
    });
    this.container.add([nextBtn.bg, nextBtn.text]);
  }

  /** A block of text, one 16px line per label at the standard 18px pitch (a single bitmap text stacks lines at 16). */
  private _lines(x: number, y: number, lines: string[], color: number, centre: boolean) {
    lines.forEach((line, i) => {
      this.container.add(uiText(this, x, y + i * LINE, line, { size: 16, color, originX: centre ? 0.5 : 0 }));
    });
  }

  /** Title and step line, centred at the top of every step. */
  private _heading(title: string, sub: string, color: number) {
    const { width } = this.scale;
    this.container.add(uiText(this, width / 2, 36, title, { size: 24, color, originX: 0.5 }));
    this.container.add(uiText(this, width / 2, 68, sub, { size: 16, color: COL.grey, originX: 0.5 }));
  }

  // ── Step 2: Rolled abilities ───────────────────────────────────────────────

  private _rollAgain() {
    this.session.reroll();
    this.arranging = false;
    this.arrangePick = null;
    Sfx.play('ui_select');
    this.renderStep();
  }

  private _toggleArrange() {
    if (this.session.swapped) return;
    this.arranging = !this.arranging;
    this.arrangePick = null;
    Sfx.play('ui_select');
    this.renderStep();
  }

  /** Arrange mode: the first pick waits, the second swaps (once per roll). */
  private _pickForSwap(key: AbilityKey) {
    if (!this.arranging || this.session.swapped) return;
    if (this.arrangePick === null) {
      this.arrangePick = key;
    } else if (this.arrangePick === key) {
      this.arrangePick = null;
    } else {
      this.session.swap(this.arrangePick, key);
      this.arrangePick = null;
      this.arranging = false;
    }
    Sfx.play('ui_select');
    this.renderStep();
  }

  private renderAbilityRoll() {
    const { width, height } = this.scale;
    const cls = CHARACTER_CLASSES[this.selectedClass];
    const tone = CLASS_COL[this.selectedClass] ?? COL.gold;
    this._heading(`ROLL ABILITIES - ${cls.name.toUpperCase()}`, 'STEP 2 OF 3 - FOUR DICE, DROP THE LOWEST', tone);

    // What the pointer is over: a one-line description of the ability, at the foot of the screen.
    this._abilityHint = uiText(this, width / 2, height - 118, '', { size: 16, color: COL.grey, originX: 0.5 });
    this.container.add(this._abilityHint);

    const scores = this.session.scores;
    const prime = primeRequisite(cls.key);
    const reports = reportScores(scores, this.selectedClass);
    const rowX = 280;
    reports.forEach((r, i) => {
      const y = 126 + i * 56;
      const picked = this.arrangePick === r.key;
      const border = picked ? COL.gold : this.arranging ? COL.sky : r.key === prime ? COL.brown : COL.slate;
      const row = flatPanel(this, rowX, y, 500, 48, { fill: picked ? COL.navy : COL.ink, border })
        .setInteractive({ useHandCursor: this.arranging });
      this.container.add(row);

      const modColor = r.tone > 0 ? COL.lime : r.tone < 0 ? COL.red : COL.grey;
      this.container.add(uiText(this, rowX - 236, y, `${this.arranging ? `${i + 1} ` : ''}${r.label}`, {
        size: 16, color: r.key === prime ? COL.gold : COL.silver, originY: 0.5,
      }));
      this.container.add(uiText(this, rowX - 120, y, `${r.score}`, { size: 24, color: COL.white, originY: 0.5 }));
      this.container.add(uiText(this, rowX - 60, y, r.mods, { size: 16, color: modColor, originY: 0.5 }));
      if (r.key === prime) {
        this.container.add(uiText(this, rowX + 236, y, 'PRIME', { size: 16, color: COL.gold, originX: 1, originY: 0.5 }));
      }

      row.on('pointerover', () => this._abilityHint?.setText(ABILITY_DESCRIPTIONS[r.key].toUpperCase()));
      row.on('pointerout', () => this._abilityHint?.setText(''));
      row.on('pointerdown', () => this._pickForSwap(r.key));
    });

    const sub = this.arranging
      ? (this.arrangePick ? 'NOW PICK THE SCORE TO TRADE IT WITH.' : 'PICK A SCORE TO MOVE. ESC CANCELS.')
      : this.session.swapped ? 'YOU HAVE ARRANGED THIS ROLL. ROLL AGAIN FOR A NEW SET.' : 'ARRANGE LETS YOU SWAP ANY TWO ONCE.';
    this.container.add(uiText(this, 40, 466, `ROLLS: ${this.session.rolls}`, { size: 16, color: COL.silver }));
    this.container.add(uiText(this, 40, 490, sub, { size: 16, color: this.arranging ? COL.gold : COL.grey }));
    this.container.add(uiText(this, width / 2, height - 98, 'R ROLL AGAIN   A ARRANGE   ENTER NEXT   ESC BACK', {
      size: 16, color: COL.slate, originX: 0.5,
    }));

    this._renderPreview(580, 104);

    // Buttons
    const backBtn = this._makeButton(120, height - 50, '< BACK', 180, 44);
    backBtn.bg.on('pointerdown', () => this._goTo(1));
    this.container.add([backBtn.bg, backBtn.text]);

    const rollBtn = this._makeButton(340, height - 50, 'ROLL AGAIN', 200, 44);
    rollBtn.bg.on('pointerdown', () => this._rollAgain());
    this.container.add([rollBtn.bg, rollBtn.text]);

    const arrTone = this.session.swapped ? 'off' : 'normal';
    const arrBtn = this._makeButton(570, height - 50, this.arranging ? 'CANCEL' : 'ARRANGE', 200, 44, arrTone);
    if (!this.session.swapped) arrBtn.bg.on('pointerdown', () => this._toggleArrange());
    this.container.add([arrBtn.bg, arrBtn.text]);

    const nextBtn = this._makeButton(810, height - 50, 'NEXT >', 180, 44, 'go');
    nextBtn.bg.on('pointerdown', () => this._goTo(3));
    this.container.add([nextBtn.bg, nextBtn.text]);
  }

  private _renderPreview(x: number, y: number) {
    const cls = CHARACTER_CLASSES[this.selectedClass];
    const scores = this.session.scores;
    const tone = CLASS_COL[cls.key] ?? COL.silver;

    this.container.add(uiText(this, x, y, `${cls.name.toUpperCase()} SHEET`, { size: 16, color: tone }));
    this.container.add(this.add.image(x + 280, y + 4, `player_${cls.key}`).setScale(2));

    const kit = starterKit(cls.key);
    const sheet = { classKey: cls.key, level: 1, scores, inventory: kit };
    const hp = startingHp(cls.key, scores.con);
    const ac = playerArmorClass(sheet);
    const thac0 = playerThac0(sheet);
    const sv = (c: typeof SAVE_CATEGORIES[number]) => saveTarget(cls.key, 1, c);
    const bonus = xpBonusLabel(cls.key, scores);

    const lines: Array<[string, number]> = [
      [`HP ${hp}  AC ${ac}  THAC0 ${thac0}`, COL.white],
      [titleFor(cls.key, 1).toUpperCase().slice(0, 24), COL.gold],
      [bonus ? `${bonus}  (PRIME ${primeRequisite(cls.key).toUpperCase()} ${scores[primeRequisite(cls.key)]})` : 'NO XP BONUS (PRIME UNDER 16)', bonus ? COL.lime : COL.slate],
      ['SAVES (D20, AT OR OVER)', COL.grey],
      [`DEATH ${sv('death')}  PETR ${sv('petrify')}`, COL.sky],
      [`WAND ${sv('wands')}  BRTH ${sv('breath')}`, COL.sky],
      [`SPELLS ${sv('spells')}`, COL.sky],
    ];
    lines.forEach(([t, color], i) => {
      this.container.add(uiText(this, x, y + 34 + i * 22, t, { size: 16, color }));
    });
    const gear = kit.equipped().filter(i => i.defKey !== 'torch').map(i => displayName(i)).join(', ');
    this._lines(x, y + 34 + lines.length * 22 + 10, wrap(`KIT: ${gear.toUpperCase()}`, 25).slice(0, 4), COL.grey, false);
  }

  private renderNameInput() {
    const { width, height } = this.scale;
    const cls = CHARACTER_CLASSES[this.selectedClass];
    const tone = CLASS_COL[this.selectedClass] ?? COL.gold;
    this._heading('NAME YOUR CHARACTER', 'STEP 3 OF 3 - A NAME, OR LEAVE IT BLANK', COL.gold);

    // Class avatar preview, 3x
    const avatar = this.add.image(width / 2, height / 2 - 96, `player_${this.selectedClass}`).setScale(3);
    this.container.add(avatar);

    this.container.add(uiText(this, width / 2, height / 2 - 36, cls.name.toUpperCase(), {
      size: 24, color: tone, originX: 0.5,
    }));

    // Input field background
    const inputW = 400;
    const inputH = 52;
    const inputY = height / 2 + 36;
    this.container.add(flatPanel(this, width / 2, inputY, inputW, inputH, { fill: COL.ink, border: COL.sky }));

    // Name display with blinking cursor
    const cursorChar = this._cursorVisible ? '_' : '';
    const nameText = uiText(this, width / 2, inputY, this.characterName + cursorChar, {
      size: 24, color: COL.white, originX: 0.5, originY: 0.5,
    });
    this.container.add(nameText);

    // Hint text
    const touch = isTouchDevice();
    this.container.add(uiText(this, width / 2, inputY + 40, touch ? 'MAX 16 CHARACTERS. TAP THE BOX TO TYPE.' : 'MAX 16 CHARACTERS. PRESS ENTER TO CONFIRM.', {
      size: 16, color: COL.grey, originX: 0.5,
    }));
    this.container.add(uiText(this, width / 2, inputY + 62, `DEFAULT: ${cls.name.toUpperCase()}`, {
      size: 16, color: COL.slate, originX: 0.5,
    }));

    // A phone has no keyboard until an input has focus: lay a real one over the name box and mirror it into the box.
    if (touch) this._ensureNameField(width / 2 - inputW / 2, inputY - inputH / 2, inputW, inputH);

    // Set up keyboard listener for name input
    this._nameInputActive = true;
    setTextEntry(true);
    this._nameKeydownHandler = (e: KeyboardEvent) => this._onNameKeydown(e);
    this.input.keyboard!.manager.target.addEventListener('keydown', this._nameKeydownHandler);

    // Blinking cursor timer
    this._cursorTimer = this.time.addEvent({
      delay: 500,
      loop: true,
      callback: () => {
        this._cursorVisible = !this._cursorVisible;
        nameText.setText(this.characterName + (this._cursorVisible ? '_' : ''));
      },
    });

    // Back button
    const backBtn = this._makeButton(width / 2 - 130, height - 50, '< BACK', 180, 44);
    backBtn.bg.on('pointerdown', () => this._goTo(2));
    this.container.add([backBtn.bg, backBtn.text]);

    // Begin button
    const beginBtn = this._makeButton(width / 2 + 130, height - 50, 'BEGIN!', 180, 44, 'go');
    beginBtn.bg.on('pointerdown', () => this._startGame());
    this.container.add([beginBtn.bg, beginBtn.text]);
  }

  private _ensureNameField(x: number, y: number, w: number, h: number) {
    if (this._nameField) { this._nameField.place({ x, y, w, h }); return; }
    this._nameField = new DomTextField({
      canvas: this.game.canvas,
      rect: { x, y, w, h },
      gameW: this.scale.width,
      gameH: this.scale.height,
      value: this.characterName,
      maxLength: 16,
      allowed: /[a-zA-Z0-9 '-]/,
      onChange: (v) => { this.characterName = v; this.renderStep(); },
      onSubmit: () => this._startGame(),
      onCancel: () => this._goTo(2),
      enterHint: 'go',
    });
    this._nameField.focus();
  }

  private _destroyNameField() {
    this._nameField?.destroy();
    this._nameField = undefined;
  }

  private _onNameKeydown(e: KeyboardEvent) {
    if (!this._nameInputActive) return;
    // Keys typed into the phone's input are handled by the input itself.
    if (this._nameField && e.target === this._nameField.el) return;

    if (e.key === 'Enter') {
      this._startGame();
      return;
    }
    if (e.key === 'Escape') {
      this._goTo(2);
      return;
    }
    if (e.key === 'Backspace') {
      this.characterName = this.characterName.slice(0, -1);
      this.renderStep();
      return;
    }
    // Allow letters, numbers, spaces, hyphens, apostrophes
    if (e.key.length === 1 && /[a-zA-Z0-9 '\-]/.test(e.key) && this.characterName.length < 16) {
      this.characterName += e.key;
      this.renderStep();
    }
  }

  private _cleanupNameInput() {
    this._nameInputActive = false;
    setTextEntry(false);
    if (this._nameKeydownHandler) {
      this.input.keyboard!.manager.target.removeEventListener('keydown', this._nameKeydownHandler);
      this._nameKeydownHandler = undefined;
    }
    if (this._cursorTimer) {
      this._cursorTimer.destroy();
      this._cursorTimer = undefined;
    }
  }

  private _startGame() {
    this._cleanupNameInput();
    this._destroyNameField();
    const scores = this.session.scores;

    const cls = CHARACTER_CLASSES[this.selectedClass];
    const finalName = this.characterName.trim() || cls.name;

    const charData: CharCreationData = {
      classKey: this.selectedClass,
      name: finalName,
      ...scores,
    };

    // Go to tavern first (hub before dungeon)
    this.scene.start('TavernScene', { charData, saveSlot: this.saveSlot });
  }

  /** A flat bordered button: `go` is green (ready), `off` is dimmed and does nothing. */
  private _makeButton(x: number, y: number, label: string, w: number, h: number, tone: 'normal' | 'go' | 'off' = 'normal') {
    const fill = tone === 'go' ? COL.pine : tone === 'off' ? COL.ink : COL.dusk;
    const border = tone === 'go' ? COL.lime : tone === 'off' ? COL.slate : COL.sky;
    const color = tone === 'go' ? COL.lime : tone === 'off' ? COL.slate : COL.sky;
    const bg = flatPanel(this, x, y, w, h, { fill, border });
    const text = uiText(this, x, y, label, { size: 16, color, originX: 0.5, originY: 0.5 });
    bg.setInteractive({ useHandCursor: tone !== 'off' });
    if (tone !== 'off') {
      bg.on('pointerover', () => { bg.setFillStyle(tone === 'go' ? COL.green : COL.slate); text.setTint(COL.white); });
      bg.on('pointerout', () => { bg.setFillStyle(fill); text.setTint(color); });
    }
    return { bg, text };
  }
}
