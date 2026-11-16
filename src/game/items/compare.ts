/**
 * Is a picked-up item better than what the character is wearing or wielding? Pure, for the pickup message.
 * Only identified, usable body armor and melee weapons are compared; anything else returns null.
 */
import { getDef } from './catalog';
import { displayName } from './generate';
import type { Inventory } from './inventory';
import type { ItemInstance } from './types';

function avgDice(expr: string): number {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(expr.replace(/\s+/g, ''));
  if (!m) return 0;
  const n = m[1] === '' ? 1 : Number(m[1]);
  return (n * (Number(m[2]) + 1)) / 2 + (m[3] ? Number(m[3]) : 0);
}

export function upgradeNote(inv: Inventory, item: ItemInstance): string | null {
  if (!item.identified || item.cursed) return null;
  const def = getDef(item.defKey);
  if (!inv.canUse(def)) return null;

  if (def.slot === 'armor' && def.ac !== undefined) {
    const cur = inv.equipment.armor;
    const curAc = cur ? (getDef(cur.defKey).ac ?? 10) - (cur.plus ?? 0) : 10;
    const newAc = def.ac - (item.plus ?? 0);
    if (newAc >= curAc) return null;
    return `better than ${cur ? `your ${displayName(cur)}` : 'no armor'}: armor class ${curAc} to ${newAc}. I to wear it.`;
  }

  if (def.slot === 'weapon' && def.damage && !def.ranged) {
    const cur = inv.equipment.weapon;
    const curDef = cur ? getDef(cur.defKey) : undefined;
    const curAvg = curDef?.damage && !curDef.ranged ? avgDice(curDef.damage) + (cur?.plus ?? 0) : 0;
    const newAvg = avgDice(def.damage) + (item.plus ?? 0);
    if (newAvg < curAvg + 0.5) return null;
    const mag = (item.plus ?? 0) > (cur?.plus ?? 0) ? ', and it is magic' : '';
    return `hits harder than ${cur ? `your ${displayName(cur)}` : 'your fists'} (about ${curAvg.toFixed(1)} to ${newAvg.toFixed(1)} a blow${mag}). I to wield it.`;
  }
  return null;
}
