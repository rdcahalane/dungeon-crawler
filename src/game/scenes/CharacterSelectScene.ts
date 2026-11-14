import * as Phaser from "phaser";
import {
  CHARACTER_CLASSES, ClassKey,
  abilityMod,
} from "../constants";
import { CharCreationData } from "../entities/Player";
import { thac0For, saveTarget, hitDie, titleFor, spellSlots, SAVE_CATEGORIES } from "../rules";
import { starterKit, displayName } from "../items";
import { playerArmorClass, playerThac0, startingHp } from "./game/AdndCombat";
import { CLASS_COL, COL, flatPanel, uiText } from "../gfx/retroUi";
import { wrap } from "./ui/theme";
import { Sfx } from "../audio/Sfx";

type ScoreMethod = 'standard' | 'pointbuy' | 'roll';

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITY_NAMES: (keyof CharCreationData)[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABELS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ABILITY_DESCRIPTIONS = [
  'Strength: melee damage, bashing',
  'Dexterity: armor class, missiles, thieving',
  'Constitution: hit points per level',
  'Intelligence: wizard spells known',
  'Wisdom: cleric bonus spells, saves',
  'Charisma: reaction of strangers',
];

const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

export class CharacterSelectScene extends Phaser.Scene {
  private step: 1 | 2 | 3 | 4 = 1;
  private selectedClass: ClassKey = 'fighter';
  private scoreMethod: ScoreMethod = 'standard';
  private saveSlot = 1; // which slot to save to

  // Ability assignment
  private scores: number[] = [...STANDARD_ARRAY];
  private assigned: (number | null)[] = [null, null, null, null, null, null];
  private selectedScoreIdx = -1; // which generated score is being dragged/clicked
  private pointBuyScores: number[] = [10, 10, 10, 10, 10, 10];
  private pointsRemaining = 27;
  private rollResults: number[][] = []; // raw 4d6-drop-lowest rolls

  // Name input (Step 4)
  private characterName = '';
  private _nameInputActive = false;
  private _cursorVisible = true;
  private _cursorTimer?: Phaser.Time.TimerEvent;
  private _nameKeydownHandler?: (e: KeyboardEvent) => void;

  private container!: Phaser.GameObjects.Container;

  init(data: { saveSlot?: number }) {
    this.saveSlot = data?.saveSlot ?? 1;
    // Reset state on re-entry
    this.step = 1;
    this.selectedClass = 'fighter';
    this.scoreMethod = 'standard';
    this._scoreToAbilityMap = new Map();
    this.assigned = [null, null, null, null, null, null];
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
  }

  private clearContainer() {
    this.container.removeAll(true);
  }

  // ── Step 1: Class Picker ───────────────────────────────────────────────────

  private renderStep() {
    this._cleanupNameInput();
    this.clearContainer();
    switch (this.step) {
      case 1: this.renderClassPicker(); break;
      case 2: this.renderScoreMethod(); break;
      case 3: this.renderAssignScores(); break;
      case 4: this.renderNameInput(); break;
    }
  }

  private renderClassPicker() {
    const { width, height } = this.scale;
    this._heading('CHOOSE YOUR CLASS', 'STEP 1 OF 4', COL.gold);

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
      const sprite = this.add.image(cx, cy - cardH / 2 + 62, `player_${key}`).setScale(3);
      this.container.add(sprite);

      this.container.add(uiText(this, cx, cy - cardH / 2 + 124, cls.name.toUpperCase(), {
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
      this.container.add(uiText(this, cx, cy - cardH / 2 + 158, lines.join('\n'), {
        size: 16, color: COL.silver, originX: 0.5, center: true,
      }));

      const gear = kit.equipped().filter(it => it.defKey !== 'torch').map(it => displayName(it)).join(', ');
      this.container.add(uiText(this, cx, cy - cardH / 2 + 246, wrap(gear.toUpperCase(), 16).slice(0, 3).join('\n'), {
        size: 16, color: COL.grey, originX: 0.5, center: true,
      }));

      // Class ability
      this.container.add(uiText(this, cx, cy - cardH / 2 + 312, wrap(cls.classAbility.toUpperCase(), 16).slice(0, 7).join('\n'), {
        size: 16, color: COL.cream, originX: 0.5, center: true,
      }));

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

  /** Title and step line, centred at the top of every step. */
  private _heading(title: string, sub: string, color: number) {
    const { width } = this.scale;
    this.container.add(uiText(this, width / 2, 36, title, { size: 24, color, originX: 0.5 }));
    this.container.add(uiText(this, width / 2, 68, sub, { size: 16, color: COL.grey, originX: 0.5 }));
  }

  // ── Step 2: Score Method ───────────────────────────────────────────────────

  private renderScoreMethod() {
    const { width, height } = this.scale;
    this._heading('ABILITY SCORES', 'STEP 2 OF 4 - HOW TO MAKE THEM', COL.gold);

    const methods: { key: ScoreMethod; label: string; desc: string }[] = [
      { key: 'standard', label: 'STANDARD ARRAY', desc: '15, 14, 13, 12, 10, 8\nASSIGN TO ANY ABILITY.\nSIMPLE AND BALANCED.' },
      { key: 'pointbuy', label: 'POINT BUY', desc: '27 POINTS TO SPEND.\nSCORES RANGE 8-15.\nCUSTOMISE YOUR BUILD.' },
      { key: 'roll', label: 'ROLL 4D6', desc: 'ROLL FOUR D6, DROP\nTHE LOWEST. RANDOM:\nHIGH RISK, HIGH REWARD.' },
    ];

    const cardW = 290;
    const cardH = 220;
    const spacing = 300;
    const startX = width / 2 - spacing;

    methods.forEach(({ key, label, desc }, i) => {
      const cx = startX + i * spacing;
      const cy = height / 2 - 10;
      const isSelected = key === this.scoreMethod;

      const bg = flatPanel(this, cx, cy, cardW, cardH, { fill: isSelected ? COL.dusk : COL.ink, border: isSelected ? COL.sky : COL.slate })
        .setInteractive({ useHandCursor: true });
      this.container.add(bg);

      this.container.add(uiText(this, cx, cy - 74, label, { size: 16, color: isSelected ? COL.sky : COL.silver, originX: 0.5 }));
      this.container.add(uiText(this, cx, cy - 32, desc, { size: 16, color: COL.grey, originX: 0.5, center: true }));

      bg.on('pointerdown', () => {
        this.scoreMethod = key;
        this._prepareScoreMethod(key);
        Sfx.play('ui_select');
        this.renderStep();
      });
    });

    // Back
    const backBtn = this._makeButton(width / 2 - 120, height - 50, '< BACK', 180, 44);
    backBtn.bg.on('pointerdown', () => { this.step = 1; this.renderStep(); });
    this.container.add([backBtn.bg, backBtn.text]);

    // Next
    const nextBtn = this._makeButton(width / 2 + 120, height - 50, 'NEXT >', 180, 44);
    nextBtn.bg.on('pointerdown', () => {
      this._prepareScoreMethod(this.scoreMethod);
      this.step = 3;
      this.renderStep();
    });
    this.container.add([nextBtn.bg, nextBtn.text]);
  }

  private _prepareScoreMethod(method: ScoreMethod) {
    this.assigned = [null, null, null, null, null, null];
    this.selectedScoreIdx = -1;
    this._scoreToAbilityMap.clear();

    if (method === 'standard') {
      this.scores = [...STANDARD_ARRAY];
      this._autoAssignScores();
    } else if (method === 'pointbuy') {
      this.pointBuyScores = [10, 10, 10, 10, 10, 10];
      this.pointsRemaining = 27;
    } else if (method === 'roll') {
      this.rollResults = [];
      for (let i = 0; i < 6; i++) {
        const dice = [d6(), d6(), d6(), d6()];
        dice.sort((a, b) => a - b);
        this.rollResults.push(dice);
      }
      this.scores = this.rollResults.map(dice => dice[1] + dice[2] + dice[3]);
      this._autoAssignScores();
    }
  }

  private _autoAssignScores() {
    const classPriority: Record<ClassKey, number[]> = {
      fighter: [0, 2, 1, 4, 3, 5],
      thief: [1, 3, 0, 2, 4, 5],
      wizard: [3, 1, 2, 4, 0, 5],
      cleric: [4, 2, 0, 1, 5, 3],
    };
    const sorted = this.scores
      .map((score, idx) => ({ score, idx }))
      .sort((a, b) => b.score - a.score);

    this.assigned = [null, null, null, null, null, null];
    this._scoreToAbilityMap.clear();

    classPriority[this.selectedClass].forEach((abilityIdx, rank) => {
      const score = sorted[rank];
      if (!score) return;
      this.assigned[abilityIdx] = score.score;
      this._scoreToAbilityMap.set(score.idx, abilityIdx);
    });
  }

  // ── Step 3: Assign Scores ─────────────────────────────────────────────────

  private renderAssignScores() {
    const { width, height } = this.scale;
    const cls = CHARACTER_CLASSES[this.selectedClass];
    this._heading(`ASSIGN SCORES - ${cls.name.toUpperCase()}`, 'STEP 3 OF 4 - GIVE EACH SCORE AN ABILITY', CLASS_COL[this.selectedClass] ?? COL.gold);

    // What the pointer is over: a one-line description of the ability, at the foot of the screen.
    this._abilityHint = uiText(this, width / 2, height - 98, '', { size: 16, color: COL.grey, originX: 0.5 });
    this.container.add(this._abilityHint);

    if (this.scoreMethod === 'pointbuy') {
      this._renderPointBuy();
    } else {
      this._renderDragAssign();
      const autoBtn = this._makeButton(width / 2 - 100, height - 134, 'AUTO ASSIGN', 200, 32);
      autoBtn.bg.on('pointerdown', () => {
        this._autoAssignScores();
        this.renderStep();
      });
      this.container.add([autoBtn.bg, autoBtn.text]);
    }

    // Live preview
    this._renderPreview(640, 104);

    // Back
    const backBtn = this._makeButton(width / 2 - 130, height - 50, '< BACK', 180, 44);
    backBtn.bg.on('pointerdown', () => { this.step = 2; this.renderStep(); });
    this.container.add([backBtn.bg, backBtn.text]);

    // Next: only once every score has an ability
    const allAssigned = this.scoreMethod === 'pointbuy'
      ? true
      : this.assigned.every(v => v !== null);

    const nextBtn3 = this._makeButton(width / 2 + 130, height - 50, 'NEXT >', 180, 44, allAssigned ? 'go' : 'off');
    if (allAssigned) {
      nextBtn3.bg.on('pointerdown', () => { this.step = 4; this.renderStep(); });
    }
    this.container.add([nextBtn3.bg, nextBtn3.text]);
  }

  private _abilityHint?: Phaser.GameObjects.BitmapText;

  private _hint(i: number) {
    this._abilityHint?.setText((ABILITY_DESCRIPTIONS[i] ?? '').toUpperCase());
  }

  private _renderDragAssign() {
    const leftX = 40;

    // Score pool
    this.container.add(uiText(this, leftX, 108, 'SCORE POOL', { size: 16, color: COL.silver }));
    this.container.add(uiText(this, leftX, 128, 'PICK ONE, THEN A SLOT', { size: 16, color: COL.grey }));

    this.scores.forEach((score, i) => {
      const isUsed = this._isScoreUsedAt(i);
      const isSelected = this.selectedScoreIdx === i;
      const x = leftX + 28 + (i % 3) * 68;
      const y = 184 + Math.floor(i / 3) * 56;

      const bg = flatPanel(this, x, y, 60, 44, {
        fill: isSelected ? COL.navy : isUsed ? COL.black : COL.dusk,
        border: isSelected ? COL.sky : isUsed ? COL.dusk : COL.slate,
      }).setInteractive({ useHandCursor: !isUsed });
      this.container.add(bg);

      this.container.add(uiText(this, x, y, `${score}`, {
        size: 24, color: isUsed ? COL.slate : COL.white, originX: 0.5, originY: 0.5,
      }));

      if (!isUsed) {
        bg.on('pointerdown', () => {
          this.selectedScoreIdx = (this.selectedScoreIdx === i) ? -1 : i;
          this.renderStep();
        });
      }
    });

    // Ability assignment slots
    const slotX = 380;
    ABILITY_NAMES.forEach((abilityKey, i) => {
      const y = 134 + i * 56;
      const assignedScore = this.assigned[i];

      const slot = flatPanel(this, slotX, y, 300, 48, {
        fill: COL.ink, border: assignedScore !== null ? COL.sky : COL.slate,
      }).setInteractive({ useHandCursor: true });
      this.container.add(slot);

      this.container.add(uiText(this, slotX - 136, y, ABILITY_LABELS[i], { size: 16, color: COL.silver, originY: 0.5 }));
      this.container.add(uiText(this, slotX - 40, y, assignedScore !== null ? `${assignedScore}` : '-', {
        size: 24, color: assignedScore !== null ? COL.white : COL.slate, originY: 0.5,
      }));

      // Modifier
      if (assignedScore !== null) {
        const mod = abilityMod(assignedScore);
        const modStr = mod >= 0 ? `(+${mod})` : `(${mod})`;
        this.container.add(uiText(this, slotX + 40, y, modStr, { size: 16, color: mod >= 0 ? COL.lime : COL.red, originY: 0.5 }));
      }

      // Click to assign or unassign
      slot.on('pointerdown', () => {
        if (this.selectedScoreIdx >= 0) {
          // Assign selected score to this slot
          this.assigned[i] = this.scores[this.selectedScoreIdx];
          this._markScoreUsed(this.selectedScoreIdx, i);
          this.selectedScoreIdx = -1;
        } else if (assignedScore !== null) {
          // Unassign
          this.assigned[i] = null;
          this._unmarkAbility(i);
        }
        this.renderStep();
      });
      slot.on('pointerover', () => this._hint(i));
      slot.on('pointerout', () => this._abilityHint?.setText(''));
      void abilityKey;
    });
  }

  // Track which score index is assigned to which ability slot
  private _scoreToAbilityMap: Map<number, number> = new Map(); // scoreIdx → abilityIdx

  private _isScoreUsedAt(scoreIdx: number): boolean {
    return this._scoreToAbilityMap.has(scoreIdx);
  }

  private _markScoreUsed(scoreIdx: number, abilityIdx: number) {
    // Remove any previous mapping for this abilityIdx
    for (const [sIdx, aIdx] of this._scoreToAbilityMap) {
      if (aIdx === abilityIdx) { this._scoreToAbilityMap.delete(sIdx); break; }
    }
    this._scoreToAbilityMap.set(scoreIdx, abilityIdx);
  }

  private _unmarkAbility(abilityIdx: number) {
    for (const [sIdx, aIdx] of this._scoreToAbilityMap) {
      if (aIdx === abilityIdx) {
        this._scoreToAbilityMap.delete(sIdx);
        break;
      }
    }
  }

  private _renderPointBuy() {
    this.container.add(uiText(this, 380, 100, `POINTS LEFT: ${this.pointsRemaining}`, {
      size: 16, color: this.pointsRemaining >= 0 ? COL.gold : COL.red, originX: 0.5,
    }));

    ABILITY_NAMES.forEach((_key, i) => {
      const y = 140 + i * 56;
      const current = this.pointBuyScores[i];

      this.container.add(uiText(this, 250, y, ABILITY_LABELS[i], { size: 16, color: COL.silver, originX: 0.5, originY: 0.5 }));

      // Minus button
      const minus = flatPanel(this, 310, y, 36, 36, { fill: COL.dusk, border: COL.slate })
        .setInteractive({ useHandCursor: true });
      this.container.add(minus);
      this.container.add(uiText(this, 310, y, '-', { size: 24, color: COL.silver, originX: 0.5, originY: 0.5 }));

      // Score display
      this.container.add(uiText(this, 380, y, `${current}`, { size: 24, color: COL.white, originX: 0.5, originY: 0.5 }));

      const mod = abilityMod(current);
      this.container.add(uiText(this, 420, y, mod >= 0 ? `+${mod}` : `${mod}`, {
        size: 16, color: mod >= 0 ? COL.lime : COL.red, originY: 0.5,
      }));

      // Plus button
      const plus = flatPanel(this, 490, y, 36, 36, { fill: COL.dusk, border: COL.slate })
        .setInteractive({ useHandCursor: true });
      this.container.add(plus);
      this.container.add(uiText(this, 490, y, '+', { size: 24, color: COL.silver, originX: 0.5, originY: 0.5 }));

      for (const b of [minus, plus]) {
        b.on('pointerover', () => this._hint(i));
        b.on('pointerout', () => this._abilityHint?.setText(''));
      }

      minus.on('pointerdown', () => {
        if (current > 8) {
          const costDiff = (POINT_BUY_COSTS[current] ?? 0) - (POINT_BUY_COSTS[current - 1] ?? 0);
          this.pointBuyScores[i] = current - 1;
          this.pointsRemaining += costDiff;
          this.renderStep();
        }
      });

      plus.on('pointerdown', () => {
        if (current < 15) {
          const nextCost = POINT_BUY_COSTS[current + 1] ?? 0;
          const curCost = POINT_BUY_COSTS[current] ?? 0;
          const costDiff = nextCost - curCost;
          if (this.pointsRemaining >= costDiff) {
            this.pointBuyScores[i] = current + 1;
            this.pointsRemaining -= costDiff;
            this.renderStep();
          }
        }
      });
    });

    // Fill in assigned from point buy
    ABILITY_NAMES.forEach((_, i) => {
      this.assigned[i] = this.pointBuyScores[i];
    });
  }

  private _renderPreview(x: number, y: number) {
    const cls = CHARACTER_CLASSES[this.selectedClass];
    const scores = this._getEffectiveScores();
    const tone = CLASS_COL[cls.key] ?? COL.silver;

    this.container.add(uiText(this, x, y, `${cls.name.toUpperCase()} PREVIEW`, { size: 16, color: tone }));
    this.container.add(this.add.image(x + 270, y - 4, `player_${cls.key}`).setScale(2));

    if (!scores) {
      this.container.add(uiText(this, x, y + 34, 'ASSIGN ALL SCORES\nTO SEE THE PREVIEW.', { size: 16, color: COL.grey }));
      return;
    }
    const { str, dex, con, int: INT, wis, cha } = scores;
    const kit = starterKit(cls.key);
    const sheet = { classKey: cls.key, level: 1, scores: { str, dex, con, int: INT, wis, cha }, inventory: kit };
    const hp = startingHp(cls.key, con);
    const ac = playerArmorClass(sheet);
    const thac0 = playerThac0(sheet);
    const sv = (c: typeof SAVE_CATEGORIES[number]) => saveTarget(cls.key, 1, c);

    const lines: Array<[string, number]> = [
      [`HP ${hp}  AC ${ac}  THAC0 ${thac0}`, COL.white],
      [titleFor(cls.key, 1).toUpperCase().slice(0, 24), COL.gold],
      ['SAVES (D20, AT OR OVER)', COL.grey],
      [`DEATH ${sv('death')}  PETR ${sv('petrify')}`, COL.sky],
      [`WAND ${sv('wands')}  BRTH ${sv('breath')}`, COL.sky],
      [`SPELLS ${sv('spells')}`, COL.sky],
      [`STR ${str} DEX ${dex} CON ${con}`, COL.silver],
      [`INT ${INT} WIS ${wis} CHA ${cha}`, COL.silver],
    ];
    lines.forEach(([t, color], i) => {
      this.container.add(uiText(this, x, y + 34 + i * 20, t, { size: 16, color }));
    });
    const gear = kit.equipped().filter(i => i.defKey !== 'torch').map(i => displayName(i)).join(', ');
    this.container.add(uiText(this, x, y + 34 + lines.length * 20 + 8, `KIT: ${wrap(gear.toUpperCase(), 25).slice(0, 3).join('\n')}`, {
      size: 16, color: COL.grey,
    }));
  }

  private _getEffectiveScores(): { str: number; dex: number; con: number; int: number; wis: number; cha: number } | null {
    if (this.scoreMethod === 'pointbuy') {
      const [str, dex, con, int_, wis, cha] = this.pointBuyScores;
      return { str, dex, con, int: int_, wis, cha };
    }
    if (this.assigned.every(v => v !== null)) {
      const [str, dex, con, int_, wis, cha] = this.assigned as number[];
      return { str, dex, con, int: int_, wis, cha };
    }
    return null;
  }

  private renderNameInput() {
    const { width, height } = this.scale;
    const cls = CHARACTER_CLASSES[this.selectedClass];
    const tone = CLASS_COL[this.selectedClass] ?? COL.gold;
    this._heading('NAME YOUR CHARACTER', 'STEP 4 OF 4 - A NAME, OR LEAVE IT BLANK', COL.gold);

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
    this.container.add(uiText(this, width / 2, inputY + 40, 'MAX 16 CHARACTERS. PRESS ENTER TO CONFIRM.', {
      size: 16, color: COL.grey, originX: 0.5,
    }));
    this.container.add(uiText(this, width / 2, inputY + 62, `DEFAULT: ${cls.name.toUpperCase()}`, {
      size: 16, color: COL.slate, originX: 0.5,
    }));

    // Set up keyboard listener for name input
    this._nameInputActive = true;
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
    backBtn.bg.on('pointerdown', () => { this.step = 3; this.renderStep(); });
    this.container.add([backBtn.bg, backBtn.text]);

    // Begin button
    const beginBtn = this._makeButton(width / 2 + 130, height - 50, 'BEGIN!', 180, 44, 'go');
    beginBtn.bg.on('pointerdown', () => this._startGame());
    this.container.add([beginBtn.bg, beginBtn.text]);
  }

  private _onNameKeydown(e: KeyboardEvent) {
    if (!this._nameInputActive) return;

    if (e.key === 'Enter') {
      this._startGame();
      return;
    }
    if (e.key === 'Escape') {
      this.step = 3;
      this.renderStep();
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
    const scores = this._getEffectiveScores();
    if (!scores) return;

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

function d6(): number {
  return Math.floor(Math.random() * 6) + 1;
}
