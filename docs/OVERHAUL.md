# Dungeon Crawler overhaul: design and build contract

Status: waves A, B, the polish pass and Wave D are merged on branch `overhaul` (2026-11-14). Playable end to end.
Wave D was played: rolled abilities, innkeeper rumours, hirelings, morale, reaction and surprise, treasure as XP, the
epitaph, the Hall of the Fallen and the bones. Open: sound has not been heard by a person; floors 5 and deeper are
untuned for a character in found gear; wandering monsters, the riddle door, rune floor, teleporters and the boss fight
have tests but have not been played; shrine cards overflow their boxes.
Dev shortcuts: `/?quick=fighter&floor=3&level=3` (straight into a floor, 13 is the tomb), `/?gallery=1` (sprites, font, sounds).

## Where the game is today

Phaser 3.90 inside a Next.js 16 shell (NextAuth + Prisma/Neon saves). About 10k lines.
Real-time top-down, 960x640, 32px tiles, 64x48 maps, four classes, a tavern hub, quests, fog of war,
random tile traps, secret doors, chests, relics and boons.

What is wrong with it for the target:

1. **Looks generic.** Every texture is a smooth procedural gradient drawn in `PreloadScene.ts` (1,367 lines). No audio at all.
2. **Rules are D&D 3e** (BAB, Fort/Ref/Will, ascending AC, mana). Not AD&D.
3. **Traps are random floor tiles with a reflex save.** Nothing is authored, nothing has a clue, nothing asks the player to think. That is the opposite of a tomb.
4. **`GameScene.ts` is a 2,286-line monolith.** Every feature collides there.
5. **Loot is thin**: weapon/armor "+N" and two traits. No inventory you manage, no rarity, no identification.
6. Bugs seen in play: React strict mode mounts two Phaser games (two canvases); saving needs a sign-in.

## The target, in one line

An Atari-cartridge-looking, AD&D-first-edition-ruled tomb crawl that plays with Diablo's hands.

### Pillar 1: Atari presentation
- Chunky sprites on a 16x16 logical grid drawn 2x (32px tile), 2 to 4 flat colors each, no gradients, no anti-aliasing. One shared palette of at most 32 colors.
- `pixelArt: true`, a CRT post-effect (scanlines, vignette, light barrel, toggle with F2), a generated 5x7 bitmap font for all text.
- Sound is synthesized: square, triangle and noise channels through WebAudio. No audio files.
- Top-down stays. No isometric.

### Pillar 2: AD&D first-edition rules under the hood
- THAC0 and descending AC. d20 to-hit rolled per swing (real-time action on top, dice underneath).
- Five saving-throw categories: `death` (paralyzation/poison/death), `petrify`, `wands`, `breath`, `spells`.
- Hit dice for monsters, class hit dice and XP tables for the player, level titles.
- Thief skills in percent (find traps, remove traps, open locks, hear noise, move silently, hide in shadows).
- Cleric turning by table. Spell slots memorized and restored by resting; no mana. Wizards get a weak always-available dart so level 1 is playable.
- Light is a resource: torches burn down; darkness shrinks sight to one tile.

### Pillar 3: tomb-style dungeon
- Hand-authored **vaults** (ASCII templates plus wiring) stamped into procedural floors, and one fully fixed final level.
- Every lethal thing has a clue somewhere a careful player can find: an inscription, a stain, a draft, a scorch mark, a different floor tile, a sound.
- Player verbs that reward care: **Search** (G), **Probe** with the ten-foot pole (P + direction), **Listen** at a door (L), **Pull/Push/Touch** (E), **Read** (E on inscriptions), drop an item on a tile.
- Mechanism kinds: covered pit, spiked pit, dart wall, pressure plate, lever, portcullis, sliding wall, closing-walls room, gas room, false door, illusory wall, one-way door, teleporter loop, rune-order floor, riddle door, statue that wants an offering, lure (the thing you must not touch), talking carved face that gives a true or false clue.
- Save-or-die exists but only behind a readable clue.

### Pillar 4: Diablo's hands
- Click to move and click to attack alongside WASD. Hold to keep attacking. Hotbar 1 to 4 plus belt potions.
- Loot rarity (common, magic, rare, unique, plus cursed and unidentified), affixes, name labels on the ground, colored by rarity.
- Paper-doll equipment and a 24-slot pack. Recall scroll back to the tavern.
- Juice: hit-stop, screen shake, particles, damage numbers, flickering torch light.

### Originality rule (hard)
Everything authored is original. Do not copy rooms, names, puzzles, text or characters from any published module or game
(nothing from Tomb of Horrors itself, no Acererak, no named D&D-only monsters such as beholder, mind flayer, displacer beast, owlbear,
no Diablo names). Folklore creatures are fine: skeleton, zombie, ghoul, wight, wraith, troll, gargoyle, ooze, mimic, giant spider, lich.
The final level is "The Tomb of the Hollow King".

## Build plan

### Wave A: new modules only (four agents in parallel, each in its own git worktree)
No agent in wave A edits a scene file or another agent's directory. Existing game must still compile and run after each.

| Lane | Owns | Delivers |
|---|---|---|
| A1 rules | `src/game/rules/**` | Pure TS AD&D core, no Phaser import. `dice.ts` (seedable RNG, dice), `classes.ts` (THAC0, saves, XP, hit dice, titles, spell slots, thief skills for fighter/thief/wizard/cleric to level 12), `combat.ts` (`attackRoll`, `damageRoll`, `savingThrow`, `turnUndead`, ability modifiers), `bestiary.ts` (stat block per monster: HD, AC, THAC0, damage dice, speed, special, XP; covers every existing `EnemyTypeKey` plus at least eight new folklore monsters and the final boss). |
| A2 look and sound | `src/game/gfx/**`, `src/game/audio/**` | `palette.ts`, `sprites.ts` (ASCII pixel maps), `registerRetroTextures(scene)` that creates a texture for **every texture key the current `PreloadScene` creates** (same keys, same pixel size, so the swap is drop-in) plus new keys listed below, `CrtPipeline.ts`, `font.ts` (5x7 bitmap font registered as `retro`), `GalleryScene.ts` (shows every sprite, the font, CRT toggle, a button per sound). `audio/Sfx.ts`: named effects and three looping ambient/music beds, mute and volume, unlocks on first input. |
| A3 tomb engine | `src/game/world/**`, additive edits to `src/game/systems/DungeonGenerator.ts` | `mechanisms.ts`: pure, serializable mechanism state machine (events in, effects out, see below). `vaults.ts`: at least 14 original vaults as ASCII templates with wiring and clue text. `tomb.ts`: the fixed final level (64x48). `stampVaults(dungeon, floor, rng)` called from `generateDungeon` (adds optional `mechanisms`, `inscriptions`, `vaultIds` to `DungeonData`). |
| A4 items | `src/game/items/**` | Pure TS. Item definitions, rarity, affixes, identification and curses, equipment slots (weapon, offhand, armor, helm, cloak, boots, ring x2, amulet), adventuring gear (torch, ten-foot pole, rope, iron spikes, holy water, thieves' tools, rations, recall scroll), `Inventory` model (24 pack slots, 4 belt slots, stacking, equip rules by class), `rollDrop(source, floor, rng)`, `equipmentBonuses(inv)`. |

New texture keys A2 must also provide (32x32 unless noted): `mech_plate`, `mech_plate_down`, `mech_lever_off`, `mech_lever_on`, `mech_pit_open`, `mech_pit_spikes`, `mech_portcullis`, `mech_dart_hole`, `mech_gas_vent`, `mech_rune_a` to `mech_rune_f`, `mech_statue`, `mech_face`, `mech_inscription`, `mech_false_door`, `mech_door`, `mech_door_open`, `mech_teleporter`, `mech_lure`, `mech_scorch`, `mech_stain`, `mech_bones`; item icons `item_sword`, `item_axe`, `item_mace`, `item_dagger`, `item_staff`, `item_bow`, `item_shield`, `item_armor`, `item_helm`, `item_cloak`, `item_boots`, `item_ring`, `item_amulet`, `item_potion_red`, `item_potion_blue`, `item_scroll`, `item_torch`, `item_pole`, `item_rope`, `item_spikes`, `item_holy_water`, `item_tools`, `item_ration`, `item_gem`, `item_key`; a monster texture `enemy_<key>` for every new bestiary key (A1 publishes the key list in `rules/bestiary.ts`; if it is not there yet use: ghoul, wight, wraith, gargoyle, ooze, cultist, bone_knight, giant_bat, hollow_king).

### Mechanism contract (A3 defines, wave B consumes)
```ts
type MechEvent =
  | { type: 'step'; tx: number; ty: number; weight: 'player' | 'item' | 'monster' }
  | { type: 'leave'; tx: number; ty: number }
  | { type: 'interact'; id: string; verb: 'pull' | 'push' | 'touch' | 'read' | 'open' | 'offer'; itemKey?: string }
  | { type: 'probe'; tx: number; ty: number }          // ten-foot pole
  | { type: 'search'; tx: number; ty: number; roll: number }  // d100, lower is better
  | { type: 'listen'; tx: number; ty: number; roll: number }
  | { type: 'answer'; id: string; text: string }
  | { type: 'tick'; dtMs: number };

type MechEffect =
  | { type: 'message'; text: string; tone: 'clue' | 'danger' | 'info' }
  | { type: 'damage'; dice: [count: number, sides: number]; bonus?: number; save?: SaveCategory; saveHalves?: boolean; cause: string }
  | { type: 'save_or_die'; save: SaveCategory; modifier?: number; cause: string }
  | { type: 'status'; key: string; durationMs: number; save?: SaveCategory }
  | { type: 'set_tile'; tx: number; ty: number; tile: number }
  | { type: 'reveal'; id: string }
  | { type: 'spawn'; monster: string; tx: number; ty: number }
  | { type: 'teleport'; tx: number; ty: number }
  | { type: 'fall'; floors: number; dice: [number, number] }
  | { type: 'grant'; itemKey: string; tx: number; ty: number }
  | { type: 'sfx'; key: string }
  | { type: 'shake'; ms: number };

function applyEvent(state: MechState, ev: MechEvent, rng: Rng): MechEffect[];  // mutates state, returns effects
```
`SaveCategory` and `Rng` come from `src/game/rules`. Until A1 merges, A3 declares structurally identical local types in `world/types.ts`:
`type SaveCategory = 'death' | 'petrify' | 'wands' | 'breath' | 'spells'` and `interface Rng { next(): number }` (float in [0,1)).

### Wave B: integration (after wave A is merged and reviewed)
- B1: split `GameScene` into controllers under `src/game/scenes/game/`, move Player/Enemy/combat onto `rules`, spell slots, torches. Fix the double-mount bug. Local-storage save when signed out.
- B2: mechanism rendering and the verbs (search, probe, listen, interact, read), vault and tomb wiring, death and corpse rules.
- B3: click-to-move, hotbar, belt, paper-doll and pack UI, ground labels, loot beams, juice.
- B4: swap `PreloadScene` to `registerRetroTextures`, retro font everywhere, CRT, sound hooks, menu and tavern restyle.

### Gates for every lane
- `npx tsc --noEmit` clean, `npm test` green, `npm run lint` no new errors.
- Pure modules have vitest tests. Vaults have a solver test: the intended solution opens the way, and the careless path fires the trap.
- No new runtime dependencies without saying why. No GitHub Actions.
- Commit on the lane branch with a clear message. Stage files by name.

## Wave D: play like early AD&D (2026-11-14, after eleven test plays)

What the plays showed: the rules are first edition but the *pace* is still arcade. Fights are hold-to-attack, every
monster charges to the death, timed "gambit" and "streak" bonuses reward rushing, death leaves no trace, and the
character is handed to you finished. Wave D fixes that. Same gates and originality rule as above.

| Lane | Owns | Delivers |
|---|---|---|
| D1 monsters | `rules/encounter.ts` (new), `entities/Enemy.ts`, `scenes/game/CombatController.ts`, `scenes/game/AdndCombat.ts`, `scenes/game/WanderController.ts` (new) | **Morale**: 2d6 against the bestiary `morale` when a monster first drops under half hit points and when an ally dies in sight; failure means it flees (and may come back). Undead, oozes and the boss never check. **Reaction**: intelligent monsters roll 2d6 plus the Charisma adjustment on first sight: hostile, wary (holds its ground until you close or strike) or afraid. **Surprise**: 2 in 6 that a monster is caught flat for a moment on first contact. **Wandering monsters**: a turn clock; every game turn 1 in 6 that something comes looking, more when you make noise (fighting, forcing, falling). Monsters stop beside the player, never inside the sprite. |
| D2 treasure and death | `scenes/game/FloorController.ts`, `scenes/game/LootController.ts`, `scenes/game/RoomEventController.ts`, `scenes/GameOverScene.ts`, `scenes/MainMenuScene.ts`, `systems/Graveyard.ts` (new), `world/rumors.ts` (new), `scenes/TavernScene.ts` (rumor option only) | **Treasure is experience**: 1 XP per gold piece carried out. **Cause of death** tracked and an epitaph on the death screen. **Hall of the Fallen**: the last 20 dead, kept on the device, shown from the title screen. **Bones**: the next character finds the body on that floor with its gold. **Rumours** at the inn, true and false, about what lies below. The timed rush bonuses (gambit, streak, Blood Rune) go behind `ARCADE_ROOM_EVENTS = false`. Stairs ask before taking you; R away from a camp says why not. |
| D3 the character and the party | `scenes/CharacterSelectScene.ts`, `rules/abilities.ts`, `rules/chargen.ts` (new), `entities/Hireling.ts` (new), `scenes/game/PartyController.ts` (new), `scenes/ui/HirePanel.ts` (new), `scenes/TavernScene.ts` (hire option only) | **Rolled abilities**: 4d6 drop the lowest, six times, rerolls allowed, modifiers shown, 10% XP bonus for a prime requisite of 16 or more. **Hirelings** from the tavern: a torchbearer (carries the light so you can use a shield) and a man-at-arms (fights beside you, has hit points and morale, can die, wants his pay). |
| D4 hands | `scenes/game/TrapController.ts`, `scenes/game/InputController.ts`, `scenes/game/MechVerbs.ts`, `scenes/ui/HudWidgets.ts`, `scenes/PreloadScene.ts` | Disarm moves off D (it is also walk right). The pole probes the way you last walked, including after click-to-move. Objective text fits its panel. `?quick=fighter&floor=5&level=4` for testing. |
