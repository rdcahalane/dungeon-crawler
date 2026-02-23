import * as Phaser from "phaser";
import {
  CHARACTER_CLASSES, ClassKey, ClassDef,
  abilityMod, goodSave, poorSave, calcBAB,
} from "../constants";
import { CharCreationData } from "../entities/Player";

type ScoreMethod = 'standard' | 'pointbuy' | 'roll';

const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8];
const ABILITY_NAMES: (keyof CharCreationData)[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];
const ABILITY_LABELS = ['STR', 'DEX', 'CON', 'INT', 'WIS', 'CHA'];
const ABILITY_DESCRIPTIONS = [
  'Strength — melee damage, bashing',
  'Dexterity — AC, reflex, thieving',
  'Constitution — HP, fort save',
  'Intelligence — search, wizard power',
  'Wisdom — cleric power, perception',
  'Charisma — turn undead power',
];

const POINT_BUY_COSTS: Record<number, number> = {
  8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9,
};

export class CharacterSelectScene extends Phaser.Scene {
  private step: 1 | 2 | 3 = 1;
  private selectedClass: ClassKey = 'fighter';
  private scoreMethod: ScoreMethod = 'standard';

  // Ability assignment
  private scores: number[] = [...STANDARD_ARRAY];
  private assigned: (number | null)[] = [null, null, null, null, null, null];
  private selectedScoreIdx = -1; // which generated score is being dragged/clicked
  private pointBuyScores: number[] = [10, 10, 10, 10, 10, 10];
  private pointsRemaining = 27;
  private rollResults: number[][] = []; // raw 4d6-drop-lowest rolls

  private container!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'CharacterSelectScene' });
  }

  create() {
    const { width, height } = this.scale;

    // Dim background
    this.add.rectangle(width / 2, height / 2, width, height, 0x0a0a14);

    // Flavour text
    this.add.text(width / 2, 18, '"The dungeon awaits. Few return."', {
      fontSize: '13px', color: '#666688', fontFamily: 'monospace', fontStyle: 'italic',
    }).setOrigin(0.5);

    this.container = this.add.container(0, 0);
    this.renderStep();
  }

  private clearContainer() {
    this.container.removeAll(true);
  }

  // ── Step 1: Class Picker ───────────────────────────────────────────────────

  private renderStep() {
    this.clearContainer();
    switch (this.step) {
      case 1: this.renderClassPicker(); break;
      case 2: this.renderScoreMethod(); break;
      case 3: this.renderAssignScores(); break;
    }
  }

  private renderClassPicker() {
    const { width, height } = this.scale;

    const title = this.add.text(width / 2, 55, 'CHOOSE YOUR CLASS', {
      fontSize: '28px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add(title);

    const step = this.add.text(width / 2, 90, 'Step 1 of 3', {
      fontSize: '12px', color: '#666666', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.container.add(step);

    const classKeys = Object.keys(CHARACTER_CLASSES) as ClassKey[];
    const cardW = 190;
    const cardH = 280;
    const spacing = 210;
    const startX = width / 2 - (spacing * 1.5);

    classKeys.forEach((key, i) => {
      const cls = CHARACTER_CLASSES[key];
      const cx = startX + i * spacing;
      const cy = height / 2 + 20;

      const isSelected = key === this.selectedClass;
      const borderColor = isSelected ? cls.color : 0x333355;
      const bgColor = isSelected ? 0x151530 : 0x0e0e1e;

      const bg = this.add.rectangle(cx, cy, cardW, cardH, bgColor)
        .setInteractive()
        .setStrokeStyle(2, borderColor);
      this.container.add(bg);

      // Class name
      const nameText = this.add.text(cx, cy - cardH / 2 + 22, cls.name, {
        fontSize: '18px', color: `#${cls.color.toString(16).padStart(6, '0')}`,
        fontFamily: 'monospace', fontStyle: 'bold',
      }).setOrigin(0.5);
      this.container.add(nameText);

      // Stats summary
      const babStr = cls.babFormula === 'full' ? '+1/lvl' : cls.babFormula === 'threequarters' ? '+3/4' : '+1/2';
      const hd = `d${cls.hitDie}`;
      const saves = [
        cls.fortGood ? 'Fort✓' : 'Fort',
        cls.refGood ? 'Ref✓' : 'Ref',
        cls.willGood ? 'Will✓' : 'Will',
      ].join('  ');

      const stats = [
        `HD: ${hd}`,
        `BAB: ${babStr}`,
        saves,
      ].join('\n');

      const statsText = this.add.text(cx, cy - cardH / 2 + 70, stats, {
        fontSize: '11px', color: '#aaaaaa', fontFamily: 'monospace',
        align: 'center', lineSpacing: 4,
      }).setOrigin(0.5);
      this.container.add(statsText);

      // Gear
      const gearText = this.add.text(cx, cy + 10, cls.startingEquipment, {
        fontSize: '10px', color: '#888888', fontFamily: 'monospace',
        align: 'center', wordWrap: { width: cardW - 16 },
      }).setOrigin(0.5);
      this.container.add(gearText);

      // Class ability
      const abilityText = this.add.text(cx, cy + cardH / 2 - 50, cls.classAbility, {
        fontSize: '10px', color: '#cccc88', fontFamily: 'monospace',
        align: 'center', wordWrap: { width: cardW - 16 },
      }).setOrigin(0.5);
      this.container.add(abilityText);

      bg.on('pointerover', () => { if (!isSelected) bg.setFillStyle(0x121228); });
      bg.on('pointerout', () => { if (!isSelected) bg.setFillStyle(bgColor); });
      bg.on('pointerdown', () => {
        this.selectedClass = key;
        this.renderStep();
      });
    });

    // Next button
    const nextBtn = this._makeButton(width / 2, height - 55, 'NEXT →', 200, 42);
    nextBtn.bg.on('pointerdown', () => {
      this.step = 2;
      this.renderStep();
    });
    this.container.add([nextBtn.bg, nextBtn.border, nextBtn.text]);
  }

  // ── Step 2: Score Method ───────────────────────────────────────────────────

  private renderScoreMethod() {
    const { width, height } = this.scale;

    const title = this.add.text(width / 2, 55, 'ABILITY SCORES', {
      fontSize: '28px', color: '#ffd700', fontFamily: 'monospace',
      stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add(title);

    const step = this.add.text(width / 2, 90, 'Step 2 of 3 — Choose how to generate ability scores', {
      fontSize: '12px', color: '#666666', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.container.add(step);

    const methods: { key: ScoreMethod; label: string; desc: string }[] = [
      { key: 'standard', label: 'Standard Array', desc: '15, 14, 13, 12, 10, 8\nAssign to any ability.\nSimple and balanced.' },
      { key: 'pointbuy', label: 'Point Buy', desc: '27 points to spend.\nScores range 8–15.\nCustomise your build.' },
      { key: 'roll', label: 'Roll 4d6', desc: 'Roll four d6, drop lowest.\nRandom — high risk,\nhigh reward.' },
    ];

    const cardW = 230;
    const cardH = 200;
    const spacing = 250;
    const startX = width / 2 - spacing;

    methods.forEach(({ key, label, desc }, i) => {
      const cx = startX + i * spacing;
      const cy = height / 2;
      const isSelected = key === this.scoreMethod;

      const bg = this.add.rectangle(cx, cy, cardW, cardH, isSelected ? 0x151530 : 0x0e0e1e)
        .setInteractive()
        .setStrokeStyle(2, isSelected ? 0x4fc3f7 : 0x333355);
      this.container.add(bg);

      const lbl = this.add.text(cx, cy - 60, label, {
        fontSize: '16px', color: isSelected ? '#4fc3f7' : '#aaaaaa', fontFamily: 'monospace',
      }).setOrigin(0.5);
      this.container.add(lbl);

      const descText = this.add.text(cx, cy + 10, desc, {
        fontSize: '11px', color: '#888888', fontFamily: 'monospace',
        align: 'center', lineSpacing: 4,
      }).setOrigin(0.5);
      this.container.add(descText);

      bg.on('pointerdown', () => {
        this.scoreMethod = key;
        this._prepareScoreMethod(key);
        this.renderStep();
      });
    });

    // Back
    const backBtn = this._makeButton(width / 2 - 120, height - 55, '← BACK', 160, 38);
    backBtn.bg.on('pointerdown', () => { this.step = 1; this.renderStep(); });
    this.container.add([backBtn.bg, backBtn.border, backBtn.text]);

    // Next
    const nextBtn = this._makeButton(width / 2 + 120, height - 55, 'NEXT →', 160, 38);
    nextBtn.bg.on('pointerdown', () => {
      this._prepareScoreMethod(this.scoreMethod);
      this.step = 3;
      this.renderStep();
    });
    this.container.add([nextBtn.bg, nextBtn.border, nextBtn.text]);
  }

  private _prepareScoreMethod(method: ScoreMethod) {
    this.assigned = [null, null, null, null, null, null];
    this.selectedScoreIdx = -1;

    if (method === 'standard') {
      this.scores = [...STANDARD_ARRAY];
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
    }
  }

  // ── Step 3: Assign Scores ─────────────────────────────────────────────────

  private renderAssignScores() {
    const { width, height } = this.scale;
    const cls = CHARACTER_CLASSES[this.selectedClass];

    const title = this.add.text(width / 2, 55, `ASSIGN SCORES — ${cls.name}`, {
      fontSize: '22px', color: `#${cls.color.toString(16).padStart(6, '0')}`,
      fontFamily: 'monospace', stroke: '#000', strokeThickness: 3,
    }).setOrigin(0.5);
    this.container.add(title);

    const step = this.add.text(width / 2, 82, 'Step 3 of 3 — Assign each score to an ability', {
      fontSize: '11px', color: '#666666', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.container.add(step);

    if (this.scoreMethod === 'pointbuy') {
      this._renderPointBuy();
    } else {
      this._renderDragAssign();
    }

    // Live preview
    this._renderPreview(width - 220, height / 2);

    // Back
    const backBtn = this._makeButton(width / 2 - 130, height - 50, '← BACK', 160, 38);
    backBtn.bg.on('pointerdown', () => { this.step = 2; this.renderStep(); });
    this.container.add([backBtn.bg, backBtn.border, backBtn.text]);

    // Begin
    const allAssigned = this.scoreMethod === 'pointbuy'
      ? true
      : this.assigned.every(v => v !== null);

    const beginBtn = this._makeButton(width / 2 + 130, height - 50, 'BEGIN!', 160, 38);
    beginBtn.bg.setFillStyle(allAssigned ? 0x0a2a0a : 0x1a1a2e);
    beginBtn.text.setColor(allAssigned ? '#69f0ae' : '#555566');
    if (allAssigned) {
      beginBtn.bg.setInteractive();
      beginBtn.bg.on('pointerdown', () => this._startGame());
    }
    this.container.add([beginBtn.bg, beginBtn.border, beginBtn.text]);
  }

  private _renderDragAssign() {
    const { height } = this.scale;
    const leftX = 160;

    // Score pool
    const poolTitle = this.add.text(leftX, 115, 'Score Pool:', {
      fontSize: '12px', color: '#aaaaaa', fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.container.add(poolTitle);

    const usedScores = new Set(this.assigned.filter(v => v !== null) as number[]);
    const availableScores = this.scores.filter((_, i) => !this._isScoreUsedAt(i));

    this.scores.forEach((score, i) => {
      const isUsed = this._isScoreUsedAt(i);
      const isSelected = this.selectedScoreIdx === i;
      const x = leftX - 60 + (i % 3) * 60;
      const y = 155 + Math.floor(i / 3) * 50;

      const bg = this.add.rectangle(x, y, 48, 36, isSelected ? 0x1a3050 : isUsed ? 0x111111 : 0x1a1a2e)
        .setInteractive()
        .setStrokeStyle(1, isSelected ? 0x4fc3f7 : isUsed ? 0x333333 : 0x444466)
        .setAlpha(isUsed ? 0.4 : 1);
      this.container.add(bg);

      const txt = this.add.text(x, y, `${score}`, {
        fontSize: '16px', color: isUsed ? '#555555' : '#ffffff', fontFamily: 'monospace',
      }).setOrigin(0.5).setAlpha(isUsed ? 0.4 : 1);
      this.container.add(txt);

      if (!isUsed) {
        bg.on('pointerdown', () => {
          this.selectedScoreIdx = (this.selectedScoreIdx === i) ? -1 : i;
          this.renderStep();
        });
      }

      void availableScores;
    });

    // Ability assignment slots
    const slotX = 430;
    ABILITY_NAMES.forEach((abilityKey, i) => {
      const y = 120 + i * 65;
      const assignedScore = this.assigned[i];

      const slot = this.add.rectangle(slotX, y, 220, 52, 0x0e0e1e)
        .setInteractive()
        .setStrokeStyle(1, assignedScore !== null ? 0x4fc3f7 : 0x333355);
      this.container.add(slot);

      const label = this.add.text(slotX - 90, y, ABILITY_LABELS[i], {
        fontSize: '14px', color: '#cccccc', fontFamily: 'monospace',
      }).setOrigin(0, 0.5);
      this.container.add(label);

      const scoreDisp = this.add.text(slotX + 20, y, assignedScore !== null ? `${assignedScore}` : '—', {
        fontSize: '18px', color: assignedScore !== null ? '#ffffff' : '#444444',
        fontFamily: 'monospace',
      }).setOrigin(0, 0.5);
      this.container.add(scoreDisp);

      // Modifier
      if (assignedScore !== null) {
        const mod = abilityMod(assignedScore);
        const modStr = mod >= 0 ? `(+${mod})` : `(${mod})`;
        const modText = this.add.text(slotX + 65, y, modStr, {
          fontSize: '12px', color: mod >= 0 ? '#69f0ae' : '#ff5252', fontFamily: 'monospace',
        }).setOrigin(0, 0.5);
        this.container.add(modText);
      }

      // Click to assign or unassign
      slot.on('pointerdown', () => {
        if (this.selectedScoreIdx >= 0) {
          // Assign selected score to this slot
          const prev = this.assigned[i];
          if (prev !== null) {
            // Unassign previous at this slot (find original index in scores)
            const prevIdx = this.scores.indexOf(prev);
            // If was assigned, mark as unassigned — but we need to track by score idx not value
          }
          this.assigned[i] = this.scores[this.selectedScoreIdx];
          this._markScoreUsed(this.selectedScoreIdx, i);
          this.selectedScoreIdx = -1;
        } else if (assignedScore !== null) {
          // Unassign
          this.assigned[i] = null;
        }
        this.renderStep();
      });

      const descText = this.add.text(slotX + 95, y, ABILITY_DESCRIPTIONS[i].split(' — ')[1] ?? '', {
        fontSize: '9px', color: '#555577', fontFamily: 'monospace',
      }).setOrigin(0, 0.5);
      this.container.add(descText);
    });

    void usedScores;
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

  private _renderPointBuy() {
    const { height } = this.scale;

    const ptText = this.add.text(430, 105, `Points remaining: ${this.pointsRemaining}`, {
      fontSize: '14px', color: this.pointsRemaining >= 0 ? '#ffd700' : '#ff5252',
      fontFamily: 'monospace',
    }).setOrigin(0.5);
    this.container.add(ptText);

    ABILITY_NAMES.forEach((key, i) => {
      const y = 130 + i * 65;
      const current = this.pointBuyScores[i];

      const label = this.add.text(250, y, ABILITY_LABELS[i], {
        fontSize: '14px', color: '#cccccc', fontFamily: 'monospace',
      }).setOrigin(0.5);
      this.container.add(label);

      // Minus button
      const minus = this.add.rectangle(300, y, 28, 28, 0x1a1a2e)
        .setInteractive().setStrokeStyle(1, 0x444466);
      this.container.add(minus);
      this.container.add(this.add.text(300, y, '−', {
        fontSize: '16px', color: '#aaaacc', fontFamily: 'monospace',
      }).setOrigin(0.5));

      // Score display
      const scoreTxt = this.add.text(340, y, `${current}`, {
        fontSize: '18px', color: '#ffffff', fontFamily: 'monospace',
      }).setOrigin(0.5);
      this.container.add(scoreTxt);

      const mod = abilityMod(current);
      this.container.add(this.add.text(368, y, mod >= 0 ? `+${mod}` : `${mod}`, {
        fontSize: '11px', color: mod >= 0 ? '#69f0ae' : '#ff5252', fontFamily: 'monospace',
      }).setOrigin(0, 0.5));

      // Plus button
      const plus = this.add.rectangle(400, y, 28, 28, 0x1a1a2e)
        .setInteractive().setStrokeStyle(1, 0x444466);
      this.container.add(plus);
      this.container.add(this.add.text(400, y, '+', {
        fontSize: '16px', color: '#aaaacc', fontFamily: 'monospace',
      }).setOrigin(0.5));

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

      void height;
    });

    // Fill in assigned from point buy
    ABILITY_NAMES.forEach((_, i) => {
      this.assigned[i] = this.pointBuyScores[i];
    });
  }

  private _renderPreview(x: number, y: number) {
    const cls = CHARACTER_CLASSES[this.selectedClass];
    const scores = this._getEffectiveScores();

    const lines: string[] = [
      `── ${cls.name} Preview ──`,
      '',
    ];

    if (scores) {
      const { str, dex, con, int: INT, wis, cha } = scores;
      const conMod = abilityMod(con);
      const dexMod = abilityMod(dex);
      const strMod = abilityMod(str);
      const wisMod = abilityMod(wis);
      const intMod = abilityMod(INT);

      const hp = cls.baseHp + conMod * 6;
      const bab = calcBAB(1, cls.babFormula);
      const atk = bab + strMod + cls.baseAttackBonus;
      const ac = 10 + dexMod + cls.baseArmorBonus;
      const fort = cls.fortGood ? goodSave(1, conMod) : poorSave(1, conMod);
      const ref = cls.refGood ? goodSave(1, dexMod) : poorSave(1, dexMod);
      const will = cls.willGood ? goodSave(1, wisMod) : poorSave(1, wisMod);
      const mana = cls.startingMana + (cls.key === 'wizard' ? intMod * 5 : cls.key === 'cleric' ? wisMod * 4 : 0);

      lines.push(
        `HP:   ${hp}`,
        `AC:   ${ac}   ATK: +${atk}`,
        `Fort: +${fort}`,
        `Ref:  +${ref}`,
        `Will: +${will}`,
      );
      if (mana > 0) lines.push(`Mana: ${mana}`);
      lines.push('', `STR ${str} DEX ${dex} CON ${con}`,
        `INT ${INT} WIS ${wis} CHA ${cha}`);

      void intMod; void wisMod;
    } else {
      lines.push('(assign all scores', 'to see preview)');
    }

    const preview = this.add.text(x, y, lines.join('\n'), {
      fontSize: '12px', color: '#aaaacc', fontFamily: 'monospace',
      lineSpacing: 6,
    }).setOrigin(0.5);
    this.container.add(preview);
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

  private _startGame() {
    const scores = this._getEffectiveScores();
    if (!scores) return;

    const charData: CharCreationData = {
      classKey: this.selectedClass,
      ...scores,
    };

    this.scene.start('GameScene', { floor: 1, charData });
  }

  private _makeButton(x: number, y: number, label: string, w: number, h: number) {
    const bg = this.add.rectangle(x, y, w, h, 0x1a1a2e).setInteractive();
    const border = this.add.rectangle(x, y, w, h).setStrokeStyle(2, 0x4fc3f7);
    const text = this.add.text(x, y, label, {
      fontSize: '16px', color: '#4fc3f7', fontFamily: 'monospace',
    }).setOrigin(0.5);

    bg.on('pointerover', () => { bg.setFillStyle(0x162040); text.setColor('#ffffff'); });
    bg.on('pointerout', () => { bg.setFillStyle(0x1a1a2e); text.setColor('#4fc3f7'); });

    return { bg, border, text };
  }
}

function d6(): number {
  return Math.floor(Math.random() * 6) + 1;
}
