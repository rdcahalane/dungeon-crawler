/** Hotbar model: which key does what. Phaser-free. */
export interface SpellSlotInfo {
  key: string;
  name: string;
  level: number;
  remaining: number;
  max: number;
}

export const SPELL_HOTKEYS = ['1', '2', '3', '4'] as const;
export const BELT_HOTKEYS = ['5', '6', '7', '8'] as const;
export const HOTBAR_SLOTS = 4;

export type HotbarKind = 'spell' | 'ability' | 'empty';

export interface HotbarSlot {
  index: number;
  hotkey: string;
  kind: HotbarKind;
  /** Short text drawn in the slot. */
  label: string;
  /** At most four characters, drawn in the slot at 16px (a slot is 52px wide). */
  short: string;
  /** Full name for the hover line above the bar. */
  name: string;
  spellKey?: string;
  remaining: number;
  max: number;
  /** Always-on ability with no pips (fighter cleave, thief sneak attack). */
  passive: boolean;
  /** Draw greyed out. */
  disabled: boolean;
}

const CASTER_CLASSES = new Set(['wizard', 'cleric']);
const ABILITY_BY_CLASS: Record<string, string> = { fighter: 'Cleave', thief: 'Sneak' };
const ABILITY_SHORT: Record<string, string> = { Cleave: 'CLV', Sneak: 'SNK' };

export function isCasterClass(classKey: string): boolean {
  return CASTER_CLASSES.has(classKey);
}

/** "Magic Missile" -> "MM", "Sleep" -> "SLEEP", "Cure Light Wounds" -> "CLW". */
export function abbreviate(name: string, max = 6): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '';
  if (words.length === 1) return words[0].slice(0, max).toUpperCase();
  return words.map((w) => w[0]).join('').slice(0, max).toUpperCase();
}

/**
 * Four hotbar slots for the class. Casters get their memorized spells (greyed at 0 left); fighters and
 * thieves get their class ability in slot 1 and nothing else.
 */
export function buildHotbar(spellSlots: readonly SpellSlotInfo[] | undefined, classKey: string): HotbarSlot[] {
  const out: HotbarSlot[] = [];
  const empty = (i: number): HotbarSlot => ({
    index: i, hotkey: SPELL_HOTKEYS[i], kind: 'empty', label: '', short: '', name: '', remaining: 0, max: 0, passive: false, disabled: true,
  });
  if (!isCasterClass(classKey)) {
    const ability = ABILITY_BY_CLASS[classKey];
    for (let i = 0; i < HOTBAR_SLOTS; i++) {
      if (i === 0 && ability) {
        out.push({
          index: 0, hotkey: SPELL_HOTKEYS[0], kind: 'ability', label: abbreviate(ability, 8),
          short: ABILITY_SHORT[ability] ?? abbreviate(ability, 4), name: ability,
          remaining: 0, max: 0, passive: true, disabled: false,
        });
      } else out.push(empty(i));
    }
    return out;
  }
  for (let i = 0; i < HOTBAR_SLOTS; i++) {
    const s = spellSlots?.[i];
    if (!s) { out.push(empty(i)); continue; }
    out.push({
      index: i, hotkey: SPELL_HOTKEYS[i], kind: 'spell', label: abbreviate(s.name), short: abbreviate(s.name, 4), name: s.name, spellKey: s.key,
      remaining: s.remaining, max: s.max, passive: false, disabled: s.remaining <= 0,
    });
  }
  return out;
}

/** Hotkey character to a bar and index: '1'..'4' spell slots, '5'..'8' belt slots. */
export function hotkeyTarget(hotkey: string): { bar: 'spell' | 'belt'; index: number } | null {
  const s = (SPELL_HOTKEYS as readonly string[]).indexOf(hotkey);
  if (s >= 0) return { bar: 'spell', index: s };
  const b = (BELT_HOTKEYS as readonly string[]).indexOf(hotkey);
  if (b >= 0) return { bar: 'belt', index: b };
  return null;
}

/** The spell a spell hotkey casts, given the payload's `spellSlots`. */
export function spellForHotkey(hotkey: string, spellSlots: readonly SpellSlotInfo[] | undefined): SpellSlotInfo | null {
  const t = hotkeyTarget(hotkey);
  if (!t || t.bar !== 'spell') return null;
  return spellSlots?.[t.index] ?? null;
}

/**
 * Older payloads (no `spellSlots`) carry `spellKeys` and cooldowns. Present them as one-shot slots so the
 * bar still shows something until the spell lane lands.
 */
export function legacySpellSlots(
  spellKeys: readonly string[] | undefined,
  names: (key: string) => string,
  cooldowns: readonly number[] | undefined,
): SpellSlotInfo[] {
  return (spellKeys ?? []).slice(0, HOTBAR_SLOTS).map((key, i) => ({
    key, name: names(key), level: 1, remaining: (cooldowns?.[i] ?? 0) > 0 ? 0 : 1, max: 1,
  }));
}
