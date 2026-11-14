# Dungeon Crawler

A browser tomb crawl that looks like an Atari cartridge and plays in real time. You pick one of four classes (fighter, thief, wizard, cleric), rest up in a tavern, then descend through procedurally generated floors toward the fixed final level, the Tomb of the Hollow King. The rules underneath follow first-edition AD&D (THAC0, descending AC, five saving-throw categories, memorized spells), and the dungeon holds hand-authored vaults with traps that leave clues for careful players.

## Presentation

- Every sprite is an ASCII pixel map drawn to a canvas texture on one shared 32-colour palette. No image files.
- Text uses a generated 5x7 bitmap font (ASCII only).
- A CRT post effect (scanlines, vignette, slight curve) runs on WebGL. F2 toggles it; the choice is saved in `localStorage` as `dc-crt`.
- Sound is synthesized with WebAudio (square, triangle and noise voices) and music beds for the tavern, the dungeon and the tomb. N mutes; the choice is saved as `dc-mute`. Nothing plays until the first click or key press, as browsers require.
- Hit-stop, screen shake, death bursts and a level-up flash are driven from the game's event bus.

## Stack

Next.js 16, React 19, Phaser 3.90, TypeScript, NextAuth with Prisma on Neon for account saves, Vitest for tests. Without a sign-in the game saves to this device.

## Run

```bash
npm run dev        # http://localhost:3000
npm test           # vitest
npm run lint
npx tsc --noEmit
npm run build
```

## Dev shortcuts

Add these to the game URL:

- `?gallery=1` opens the gallery: every texture, the font, a CRT toggle and a button for each sound.
- `?quick=fighter&floor=3` skips the menus and starts a fighter on floor 3 (`fighter`, `thief`, `wizard` or `cleric`; floor 13 is the tomb).

In development builds the running game is exposed as `window.__game`.

## Controls

| Input | Action |
|---|---|
| WASD / arrow keys, or click the floor | Move |
| Space, or click a monster | Attack (hold to keep attacking) |
| 1 to 4 | Cast the spell in that hotbar slot |
| Right click | Cast hotbar slot 1 at the pointer |
| 5 to 8 | Use the belt slot |
| F | Drink a healing potion |
| G | Search |
| P then a direction | Probe ahead with the ten-foot pole |
| L | Listen at a door |
| E | Interact (pull, push, read, open a chest, pick up). With a chest and a mechanism both in reach, the nearer one gets the press |
| I | Inventory |
| B | Spellbook (casters) |
| M | Map |
| Q (in the tavern) | Quest log |
| T (cleric) / D (thief) | Turn undead / disarm a found trap |
| + and - | Zoom |
| Esc | Close a panel |
| F2 | CRT on or off |
| N | Sound on or off |
| H (title screen) | How to play |

## The tavern

- **Shop.** Talk to the innkeeper (E at the bar) and choose "Buy and sell gear". Two tabs, BUY and SELL (Tab switches; arrows pick, Enter buys or sells one, click a row then the button). Torches, poles, rope, spikes, sacks, holy water, rations, thieves' tools, healing potions and recall scrolls are always on the shelf; weapons, armor and magic stock grow with your level. SELL lists your pack at what the merchant will pay.
- **Inn.** Also at the bar: a room for the night costs 5 gp (full hit points, drained hit points mended, spell slots restored; casters get the spellbook open afterward), or sleep in the common room for free (half the missing hit points, spell slots restored).
- **Notice board.** Accept quests; rewards are paid when you return.
- Walk onto the glowing portal to go down. A scroll of recall brings you back.

## Layout

- `src/app` is the page shell: the arcade-cabinet frame, the sign-in bar and the login page.
- `src/game/scenes` holds the scenes; `scenes/game` holds the controllers that run a floor, plus `AudioController.ts` and `Juice.ts`, which listen to the event bus.
- `src/game/gfx` holds the palette, sprites, font, CRT and gallery; `src/game/audio` holds the synth and the event-to-sound table.
- `src/game/rules`, `items` and `world` hold the pure game logic (rules, loot, vaults and mechanisms).
- `docs/OVERHAUL.md` is the design and build contract for the overhaul.
