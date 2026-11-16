/**
 * Small helpers for flat, palette-only retro UI: bitmap text with wrapping and
 * alignment, 2px bordered panels and buttons. No gradients, no rounded corners.
 */
import * as Phaser from "phaser";
import { retroText } from "./font";
import { paletteHex } from "./palette";
import { asciiOnly } from "./asciiText";

export { asciiOnly };

function pc(ch: string): number {
  return paletteHex(ch) ?? 0xffffff;
}

/** Named colours, all taken from the shared 32-colour palette. */
export const COL = {
  black: pc("0"),
  ink: pc("1"),
  dusk: pc("2"),
  slate: pc("3"),
  grey: pc("4"),
  silver: pc("5"),
  white: pc("6"),
  blood: pc("7"),
  red: pc("8"),
  orange: pc("9"),
  gold: pc("a"),
  cream: pc("b"),
  umber: pc("c"),
  brown: pc("d"),
  tan: pc("e"),
  pine: pc("f"),
  green: pc("g"),
  lime: pc("h"),
  navy: pc("i"),
  blue: pc("j"),
  sky: pc("k"),
  ice: pc("l"),
  plum: pc("m"),
  violet: pc("n"),
  orchid: pc("o"),
  teal: pc("p"),
  rose: pc("s"),
  bone: pc("v"),
} as const;

/** Class colours used on the menu and in the tavern. */
export const CLASS_COL: Readonly<Record<string, number>> = {
  fighter: COL.red,
  thief: COL.silver,
  wizard: COL.sky,
  cleric: COL.gold,
};

/** Snap to an even whole pixel so panel borders stay crisp. */
export function snap(n: number): number {
  return Math.round(n / 2) * 2;
}

export interface UiTextOptions {
  /** Cell height: 8, 16, 24, 32 ... Default 16. */
  size?: number;
  color?: number | string;
  originX?: number;
  originY?: number;
  /** Wrap lines at this pixel width. */
  maxWidth?: number;
  /** Centre-align multi-line text. */
  center?: boolean;
  depth?: number;
}

/** Bitmap text in the retro font, with optional wrapping and alignment. */
export function uiText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: UiTextOptions = {},
): Phaser.GameObjects.BitmapText {
  const bt = retroText(scene, x, y, asciiOnly(text), {
    size: opts.size ?? 16,
    color: opts.color ?? COL.white,
    originX: opts.originX ?? 0,
    originY: opts.originY ?? 0,
  });
  if (opts.maxWidth) bt.setMaxWidth(opts.maxWidth);
  if (opts.center) bt.setCenterAlign();
  if (opts.depth !== undefined) bt.setDepth(opts.depth);
  return bt;
}

export interface PanelOptions {
  fill?: number;
  border?: number;
  borderWidth?: number;
  alpha?: number;
}

/** A flat filled rectangle with a hard 2px border. Centred on (x, y). */
export function flatPanel(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  opts: PanelOptions = {},
): Phaser.GameObjects.Rectangle {
  return scene.add
    .rectangle(x, y, w, h, opts.fill ?? COL.ink, opts.alpha ?? 1)
    .setStrokeStyle(opts.borderWidth ?? 2, opts.border ?? COL.slate);
}

export interface ButtonOptions {
  size?: number;
  fill?: number;
  hoverFill?: number;
  border?: number;
  color?: number;
  hoverColor?: number;
}

export interface RetroButton {
  box: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.BitmapText;
}

/** A flat button. Centred on (x, y). The caller adds `box` and `label` to a container if it wants one. */
export function retroButton(
  scene: Phaser.Scene,
  x: number,
  y: number,
  w: number,
  h: number,
  text: string,
  onClick: () => void,
  opts: ButtonOptions = {},
): RetroButton {
  const fill = opts.fill ?? COL.dusk;
  const hoverFill = opts.hoverFill ?? COL.slate;
  const color = opts.color ?? COL.white;
  const hoverColor = opts.hoverColor ?? COL.gold;
  const box = flatPanel(scene, x, y, w, h, { fill, border: opts.border ?? COL.grey }).setInteractive({ useHandCursor: true });
  const label = uiText(scene, x, y, text, { size: opts.size ?? 16, color, originX: 0.5, originY: 0.5 });
  box.on("pointerover", () => {
    box.setFillStyle(hoverFill);
    label.setTint(hoverColor);
  });
  box.on("pointerout", () => {
    box.setFillStyle(fill);
    label.setTint(color);
  });
  box.on("pointerdown", onClick);
  return { box, label };
}

export interface TagOptions {
  size?: number;
  color?: number;
  fill?: number;
  originX?: number;
  originY?: number;
  padX?: number;
  padY?: number;
  depth?: number;
}

/** A text label on a solid flat backing, as one container. Positioned by its origin like text. */
export function tagText(
  scene: Phaser.Scene,
  x: number,
  y: number,
  text: string,
  opts: TagOptions = {},
): Phaser.GameObjects.Container {
  const padX = opts.padX ?? 4;
  const padY = opts.padY ?? 2;
  const t = uiText(scene, 0, 0, text, { size: opts.size ?? 8, color: opts.color ?? COL.white });
  const w = t.width + padX * 2;
  const h = t.height + padY * 2;
  const ox = opts.originX ?? 0.5;
  const oy = opts.originY ?? 0.5;
  const bg = scene.add.rectangle(0, 0, w, h, opts.fill ?? COL.black, 1).setOrigin(0, 0);
  t.setPosition(padX, padY);
  const c = scene.add.container(Math.round(x - w * ox), Math.round(y - h * oy), [bg, t]);
  c.setSize(w, h);
  if (opts.depth !== undefined) c.setDepth(opts.depth);
  return c;
}
