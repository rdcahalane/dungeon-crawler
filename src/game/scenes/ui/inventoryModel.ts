/**
 * Inventory panel model: cursor movement, what Enter does, and dry-run checks that surface the
 * inventory's own failure reasons. Phaser-free.
 */
import { Inventory, PACK_SIZE, BELT_SIZE, getDef, EQUIP_SLOTS, canStack } from "../../items";
import type { EquipSlot, FailReason, ItemInstance, Loc, Result } from "../../items";

export type Zone = 'equip' | 'pack' | 'belt';
export interface Cursor { zone: Zone; index: number }

export const PACK_COLS = 6;
export const PACK_ROWS = PACK_SIZE / PACK_COLS;

/** Paper doll layout, 3 columns by 4 rows; the class sprite fills the middle of rows 1 and 2. */
export const EQUIP_GRID: Record<EquipSlot, { col: number; row: number }> = {
  amulet: { col: 0, row: 0 }, helm: { col: 1, row: 0 }, cloak: { col: 2, row: 0 },
  weapon: { col: 0, row: 1 }, offhand: { col: 2, row: 1 },
  ring1: { col: 0, row: 2 }, ring2: { col: 2, row: 2 },
  armor: { col: 0, row: 3 }, boots: { col: 1, row: 3 },
};
export const EQUIP_COLS = 3;
export const EQUIP_ROWS = 4;

export const EQUIP_LABELS: Record<EquipSlot, string> = {
  weapon: 'WEAPON', offhand: 'OFFHAND', armor: 'ARMOR', helm: 'HELM', cloak: 'CLOAK',
  boots: 'BOOTS', ring1: 'RING', ring2: 'RING', amulet: 'AMULET',
};

export function equipSlotAt(col: number, row: number): EquipSlot | null {
  for (const s of EQUIP_SLOTS) {
    const g = EQUIP_GRID[s];
    if (g.col === col && g.row === row) return s;
  }
  return null;
}

export function sameCursor(a: Cursor | null, b: Cursor | null): boolean {
  return !!a && !!b && a.zone === b.zone && a.index === b.index;
}

export function locOf(c: Cursor): Loc {
  if (c.zone === 'equip') return { kind: 'equip', slot: EQUIP_SLOTS[c.index] };
  return { kind: c.zone, index: c.index };
}

export function cursorOfLoc(l: Loc): Cursor {
  if (l.kind === 'equip') return { zone: 'equip', index: EQUIP_SLOTS.indexOf(l.slot) };
  return { zone: l.kind, index: l.index };
}

export function itemAt(inv: Inventory, c: Cursor): ItemInstance | null {
  return inv.get(locOf(c));
}

// ── Cursor movement ──────────────────────────────────────────────────────────────────────────────────────

export type Dir = 'left' | 'right' | 'up' | 'down';

export function moveCursor(c: Cursor, dir: Dir): Cursor {
  if (c.zone === 'equip') {
    const g = EQUIP_GRID[EQUIP_SLOTS[c.index]];
    const dc = dir === 'left' ? -1 : dir === 'right' ? 1 : 0;
    const dr = dir === 'up' ? -1 : dir === 'down' ? 1 : 0;
    let col = g.col + dc;
    let row = g.row + dr;
    while (col >= 0 && col < EQUIP_COLS && row >= 0 && row < EQUIP_ROWS) {
      const s = equipSlotAt(col, row);
      if (s) return { zone: 'equip', index: EQUIP_SLOTS.indexOf(s) };
      col += dc;
      row += dr;
    }
    if (dir === 'right') return { zone: 'pack', index: Math.min(g.row, PACK_ROWS - 1) * PACK_COLS };
    return c;
  }
  if (c.zone === 'pack') {
    const col = c.index % PACK_COLS;
    const row = Math.floor(c.index / PACK_COLS);
    switch (dir) {
      case 'left':
        if (col > 0) return { zone: 'pack', index: c.index - 1 };
        for (let cc = EQUIP_COLS - 1; cc >= 0; cc--) {
          const s = equipSlotAt(cc, row);
          if (s) return { zone: 'equip', index: EQUIP_SLOTS.indexOf(s) };
        }
        return c;
      case 'right': return col < PACK_COLS - 1 ? { zone: 'pack', index: c.index + 1 } : c;
      case 'up': return row > 0 ? { zone: 'pack', index: c.index - PACK_COLS } : c;
      case 'down':
        return row < PACK_ROWS - 1
          ? { zone: 'pack', index: c.index + PACK_COLS }
          : { zone: 'belt', index: Math.min(col, BELT_SIZE - 1) };
    }
  }
  // belt
  switch (dir) {
    case 'left': return { zone: 'belt', index: Math.max(0, c.index - 1) };
    case 'right': return { zone: 'belt', index: Math.min(BELT_SIZE - 1, c.index + 1) };
    case 'up': return { zone: 'pack', index: (PACK_ROWS - 1) * PACK_COLS + c.index };
    default: return c;
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────────────────────────────────

export type InvAction =
  | { type: 'equip'; itemId: string; slot?: EquipSlot }
  | { type: 'unequip'; slot: EquipSlot }
  | { type: 'useBelt'; index: number }
  | { type: 'drop'; itemId: string }
  /** `strict` marks a "to belt" move, which must not swap with a different item. */
  | { type: 'move'; from: Loc; to: Loc; strict?: boolean };

export type UiFailReason = FailReason | 'belt_full' | 'nothing';
export interface UiFail { ok: false; reason: UiFailReason; message: string }
export type ActionCheck = { ok: true } | UiFail;

const uiFail = (reason: UiFailReason, message: string): UiFail => ({ ok: false, reason, message });

/** What Enter or a double-click does at the cursor, or null when nothing applies. */
export function primaryAction(inv: Inventory, c: Cursor): InvAction | null {
  const it = itemAt(inv, c);
  if (!it) return null;
  const d = getDef(it.defKey);
  if (c.zone === 'equip') return { type: 'unequip', slot: EQUIP_SLOTS[c.index] };
  if (c.zone === 'belt') return d.use ? { type: 'useBelt', index: c.index } : null;
  if (d.slot) return { type: 'equip', itemId: it.id };
  if (d.kind === 'consumable') return toBeltAction(inv, c);
  return null;
}

export function primaryLabel(inv: Inventory, c: Cursor): string | null {
  const a = primaryAction(inv, c);
  if (!a) return null;
  switch (a.type) {
    case 'equip': return 'EQUIP';
    case 'unequip': return 'UNEQUIP';
    case 'useBelt': return 'USE';
    case 'move': return 'TO BELT';
    default: return null;
  }
}

function firstEmpty(list: ReadonlyArray<ItemInstance | null>): number {
  return list.findIndex((x) => x === null);
}

/** Pack item to a free belt slot (stacks merge on their own). */
function toBeltAction(inv: Inventory, c: Cursor): InvAction | null {
  const it = itemAt(inv, c);
  if (!it) return null;
  const idx = firstEmpty(inv.belt);
  return { type: 'move', from: locOf(c), to: { kind: 'belt', index: idx >= 0 ? idx : 0 }, strict: true };
}

/** The B key: pack consumable to the belt, belt item back to the pack. Equipped items do nothing. */
export function beltAction(inv: Inventory, c: Cursor): InvAction | null {
  if (c.zone === 'pack') return toBeltAction(inv, c);
  if (c.zone === 'belt') {
    if (!itemAt(inv, c)) return null;
    const idx = firstEmpty(inv.pack);
    return { type: 'move', from: locOf(c), to: { kind: 'pack', index: idx >= 0 ? idx : 0 }, strict: true };
  }
  return null;
}

export function dropAction(inv: Inventory, c: Cursor): InvAction | null {
  const it = itemAt(inv, c);
  return it ? { type: 'drop', itemId: it.id } : null;
}

/** Move the item at `from` onto `to`: drag and drop, or click source then destination. */
export function moveBetween(inv: Inventory, from: Cursor, to: Cursor): InvAction | null {
  if (sameCursor(from, to) || !itemAt(inv, from)) return null;
  if (from.zone === 'equip' && to.zone === 'equip') return null;
  return { type: 'move', from: locOf(from), to: locOf(to) };
}

function clone(inv: Inventory): Inventory {
  return Inventory.fromJSON(inv.toJSON());
}

/** Run the action against a copy and report whether it would work, and why not. Never mutates `inv`. */
export function checkAction(inv: Inventory, a: InvAction): ActionCheck {
  if (a.type === 'move' && a.strict && a.to.kind === 'belt') {
    const src = inv.get(a.from);
    const dst = inv.get(a.to);
    // "To belt" never swaps: a full belt only accepts a stack that merges.
    if (src && dst && !canStack(src, dst)) return uiFail('belt_full', 'The belt is full.');
  }
  const r = runDirect(clone(inv), a);
  return r.ok ? { ok: true } : r;
}

/** Execute directly on the inventory. Fallback for when the scene context has no matching method. */
export function applyAction(inv: Inventory, a: InvAction): Result<{ message: string; curseRevealed?: boolean; heal?: { dice: string; bonus: number }; name?: string }> {
  return runDirect(inv, a);
}

function nameOf(it: ItemInstance | null | undefined): string {
  return it ? getDef(it.defKey).name : 'item';
}

function runDirect(inv: Inventory, a: InvAction): Result<{ message: string; curseRevealed?: boolean; heal?: { dice: string; bonus: number }; name?: string }> {
  switch (a.type) {
    case 'equip': {
      const f = inv.find(a.itemId);
      const r = inv.equip(a.itemId, a.slot);
      if (!r.ok) return r;
      return {
        ok: true, curseRevealed: r.curseRevealed,
        message: r.curseRevealed ? `You wield the ${nameOf(f?.item)}. It is cursed!` : `Equipped ${nameOf(f?.item)}.`,
      };
    }
    case 'unequip': {
      const it = inv.equipment[a.slot];
      const r = inv.unequip(a.slot);
      return r.ok ? { ok: true, message: `Removed ${nameOf(it)}.` } : r;
    }
    case 'useBelt': {
      const r = inv.useFromBelt(a.index);
      if (!r.ok) return r;
      const heal = r.effect.type === 'heal' ? { dice: r.effect.dice, bonus: r.effect.bonus ?? 0 } : undefined;
      return { ok: true, message: `You use ${r.name}.`, heal, name: r.name };
    }
    case 'drop': {
      const f = inv.find(a.itemId);
      if (!f) return { ok: false, reason: 'no_such_item', message: 'No such item.' };
      if (f.loc.kind === 'equip') return { ok: false, reason: 'not_in_pack', message: 'Take it off first.' };
      const r = inv.remove(a.itemId);
      return r.ok ? { ok: true, message: `Dropped ${nameOf(f.item)}.` } : r;
    }
    case 'move': {
      const it = inv.get(a.from);
      const r = inv.move(a.from, a.to);
      return r.ok ? { ok: true, message: `Moved ${nameOf(it)}.` } : r;
    }
  }
}
