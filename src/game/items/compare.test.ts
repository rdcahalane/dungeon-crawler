import { describe, expect, it } from 'vitest';
import { instantiate, starterKit, upgradeNote, type ItemInstance } from '.';

const item = (key: string, o: Partial<ItemInstance> = {}): ItemInstance => ({ ...instantiate(key, `t-${key}`), identified: true, ...o });

describe('upgradeNote', () => {
  it('says banded mail +2 beats chain mail, and names the change in armor class', () => {
    expect(upgradeNote(starterKit('fighter'), item('banded_mail', { plus: 2 }))).toMatch(/armor class 5 to 2/);
  });
  it('stays quiet about worse armor, unidentified or cursed items, and things the class cannot use', () => {
    const inv = starterKit('fighter');
    expect(upgradeNote(inv, item('leather_armor'))).toBeNull();
    expect(upgradeNote(inv, item('plate_mail', { identified: false }))).toBeNull();
    expect(upgradeNote(inv, item('plate_mail', { cursed: true }))).toBeNull();
    expect(upgradeNote(starterKit('wizard'), item('plate_mail'))).toBeNull();
  });
  it('says a magic sword beats the starting sword', () => {
    expect(upgradeNote(starterKit('fighter'), item('long_sword', { plus: 1 }))).toMatch(/hits harder.*magic/);
  });
});
