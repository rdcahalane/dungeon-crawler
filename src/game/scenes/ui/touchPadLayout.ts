/**
 * Which buttons the touch pad shows and where they sit. Pure, so it is tested. `TouchPad.ts` draws what this returns.
 *
 * The pad is a block in the lower right, above the zoom/INV/BOOK/MAP cluster (which starts at y 530), below the
 * objective panel, and clear of the hotbar. Buttons are 76 by 72 game pixels: the 960x640 game is scaled to about 0.55
 * on a phone, which makes that about 42 by 40 CSS pixels.
 */
import type { TouchAction } from "../../touch";

export const PAD_BTN_W = 76;
export const PAD_BTN_H = 72;
export const PAD_GAP = 4;
/** Right edge margin and the bottom of the block, in game pixels. */
export const PAD_RIGHT = 8;
export const PAD_BOTTOM = 520;
export const PAD_COLS = 3;
export const PAD_ROWS = 3;

export type PadId = "attack" | "use" | "potion" | "search" | "pole" | "listen" | "camp" | "turn" | "disarm" | "menu";

export interface PadButtonDef {
  id: PadId;
  label: string;
  /** Key action it fires. `menu` opens the menu panel instead. */
  action: TouchAction | null;
  /** Column from the right edge (0 is rightmost) and row from the bottom (0 is the bottom row). */
  col: number;
  row: number;
  /** Held, the key stays down and the pad keeps swinging. */
  hold?: boolean;
  /** Texture key for the small icon, when the game has one. */
  icon?: string;
}

export type PadMode = "dungeon" | "tavern";

const DUNGEON: PadButtonDef[] = [
  { id: "attack", label: "ATTACK", action: "attack", col: 0, row: 0, hold: true, icon: "item_sword" },
  { id: "use", label: "USE", action: "use", col: 1, row: 0, icon: "item_key" },
  { id: "potion", label: "DRINK", action: "potion", col: 2, row: 0, icon: "item_potion_red" },
  { id: "search", label: "SEARCH", action: "search", col: 0, row: 1, icon: "item_tools" },
  { id: "pole", label: "POLE", action: "pole", col: 1, row: 1, icon: "item_pole" },
  { id: "listen", label: "LISTEN", action: "listen", col: 2, row: 1 },
  { id: "menu", label: "MENU", action: null, col: 0, row: 2 },
  { id: "camp", label: "CAMP", action: "camp", col: 1, row: 2, icon: "item_torch" },
];

const SPECIAL: Record<string, PadButtonDef> = {
  cleric: { id: "turn", label: "TURN", action: "turn", col: 2, row: 2 },
  thief: { id: "disarm", label: "DISARM", action: "disarm", col: 2, row: 2 },
};

const TAVERN: PadButtonDef[] = [
  { id: "use", label: "TALK", action: "use", col: 0, row: 0, icon: "item_key" },
  { id: "menu", label: "MENU", action: null, col: 0, row: 1 },
];

export function padButtons(mode: PadMode, classKey: string | undefined): PadButtonDef[] {
  if (mode === "tavern") return TAVERN.slice();
  const extra = classKey ? SPECIAL[classKey] : undefined;
  return extra ? [...DUNGEON, extra] : DUNGEON.slice();
}

export interface PadRect { x: number; y: number; w: number; h: number }

export function padRect(col: number, row: number, screenW = 960): PadRect {
  return {
    x: screenW - PAD_RIGHT - PAD_BTN_W - col * (PAD_BTN_W + PAD_GAP),
    y: PAD_BOTTOM - PAD_BTN_H - row * (PAD_BTN_H + PAD_GAP),
    w: PAD_BTN_W,
    h: PAD_BTN_H,
  };
}
