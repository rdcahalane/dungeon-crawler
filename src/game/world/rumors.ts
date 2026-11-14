/**
 * Tavern rumours. Pure TS, no Phaser.
 *
 * One TRUE rumour for every vault in `vaults.ts` (a hint in gossip voice that points at the clue and never at the
 * solution), three true ones about the final tomb, and a drawer full of false or useless ones. About two in three
 * rumours told are true; the player is never told which. All text is ASCII (the bitmap font is) and at most two
 * sentences.
 *
 * The tavern does not know the next floor's actual vault before it exists, so the caller passes the vault ids the
 * next floor MAY hold (`vaultsForFloor(floor)`), and the rumour is drawn from that pool.
 */
import type { Rng } from "../rules/dice";

/** The last floor, where the Tomb of the Hollow King is. Mirrors `TOMB_FLOOR` in constants without importing Phaser-adjacent code. */
const TOMB_LEVEL = 13;
/** From this floor down the tomb is close enough that people have started talking about it. */
const TOMB_TALK_FROM = 9;
/** Share of rumours that are true. */
export const TRUE_SHARE = 2 / 3;

export type RumorKind = "vault" | "tomb" | "false";

export interface Rumor {
  text: string;
  kind: RumorKind;
  /** Set for kind "vault". */
  vaultId?: string;
}

/** One true rumour per vault id in `world/vaults.ts` (a test keeps this table complete). */
export const VAULT_RUMORS: Readonly<Record<string, string>> = {
  loose_flag:
    "One flagstone in a hall down there doesn't match its neighbours. The bones lying round it say plenty about the last fellow who trusted it.",
  two_levers:
    "There's a wall with two brass handles, and only one of them has a green coat of years on it. Ask yourself which one has been busy.",
  weighing_hall:
    "There's a hall where the floor counts weight and the north wall holds a grudge. Whoever found the plate usually found the darts in the same breath.",
  scorched_gallery:
    "A long gallery on the upper floors is streaked black from one wall to the other. Something ankle-high in the dust is easy to miss, and that is the whole trouble.",
  door_that_asks:
    "There's a door down there that talks. It would rather be answered than shouldered, and it has a long memory for shoulders.",
  wardens_cell:
    "The old warden kept his key where a lazy man would keep it. The lock has a green stain by the keyhole, so don't be quick about the obvious way in.",
  rune_ring:
    "Six warm stones stand in a ring, and the order of them is cut in a wall in plain letters. Read it like a map, not like a picture book.",
  false_and_true:
    "The handsomest door in the place is the worst one. The honest way is plainer and a good deal less friendly to look at.",
  thirsty_saint:
    "A stone saint holds out a dry bowl and takes offence at the wrong gifts. Gold means nothing to her, and she remembers who tried it.",
  sweating_chamber:
    "A hall down there has yellow crust round every ceiling vent. The stone just inside the door is rubbed bright from boots, and I would think on that before I stepped.",
  honest_wall:
    "One hall is all pit under a kind-looking floor, and a line cut in the wall tells which stones are honest. Read it before you step, not after.",
  returns_corridor:
    "There's a corridor that sends you back to where you started if you wander. The dust is scuffed in one lane and smooth in the rest, and a wise man asks why.",
  gilded_bait:
    "A golden idol sits out in the open in a hall scorched on every wall but one. When a thing is that easy to lift, ask who it is meant to be lifted by.",
  warm_mouth:
    "A carved face by a brazier tells the truth while the coals are lit and lies when they are cold. I would get the fire right before I took the advice.",
  narrowing_cell:
    "Deep down is a cell where the walls walk inward when you stand on the bright stone. There is a way to stop them, and you want to find it before you need it.",
};

/** True rumours about the final tomb. */
export const TOMB_RUMORS: readonly string[] = [
  "They say the road to the Hollow King is paved with lies, and every stone wants asking before it gets your weight.",
  "The old king wears his crown even dead, and the way home stays barred for as long as he does.",
  "At the very bottom the tomb plays the same few tricks in better costumes. Learn them on the way down, or pay for the lesson twice.",
];

/** False or useless rumours. */
export const FALSE_RUMORS: readonly string[] = [
  "My cousin swears the third floor is flooded to the knee. My cousin has never been below the cellar.",
  "Skeletons hate the smell of garlic, everyone knows that. It has never once worked.",
  "A fellow in here says the stairs down move around when nobody is looking. He just got lost, but he tells it well.",
  "There's a dragon on the fifth floor, big as a barn. Nobody has ever seen it, which is how they know it's big.",
  "Never carry more than one torch, the dungeon can smell it. Don't ask me how I know.",
  "They say whistling keeps the ghouls off. I whistled all the way down and got eaten anyway, so there's that.",
  "Every chest on the second floor is trapped, I'm told. Mine wasn't, and I checked twice.",
  "This ale is half rainwater, mind. That's not a rumour, but it's the best I've got tonight.",
  "A man in a red coat bought six rounds last night and swore the secret door is always on the left. It is not always on the left.",
  "Put your ear to a wall on the fourth floor and you can hear the sea. That was my own blood, I think.",
  "Rats won't cross a line of salt, they say. They go round it, is all.",
  "A wizard can walk through any wall if he has the right hat. The hat is the secret, apparently.",
  "The more a monster squeals, the less it can hurt you. I have a scar that argues the point.",
  "Gold shines brighter in the vaults with the fewest traps, or the most, I forget which.",
];

function pickFrom<T>(rng: Rng, arr: readonly T[]): T {
  return arr[Math.min(arr.length - 1, Math.floor(rng.next() * arr.length))];
}

/** Every true rumour that could be told for a floor and the vaults it may hold. */
export function trueRumorsFor(floor: number, vaultIds: readonly string[]): Rumor[] {
  const out: Rumor[] = [];
  if (floor < TOMB_LEVEL) {
    for (const id of vaultIds) {
      const text = VAULT_RUMORS[id];
      if (text) out.push({ text, kind: "vault", vaultId: id });
    }
  }
  if (floor >= TOMB_TALK_FROM) for (const text of TOMB_RUMORS) out.push({ text, kind: "tomb" });
  return out;
}

/**
 * A rumour for a character about to enter `floor`. `vaultIds` is the pool of vaults that floor may hold.
 * About two in three are true when there is anything true to say.
 */
export function tellRumor(floor: number, vaultIds: readonly string[], rng: Rng): Rumor {
  const truths = trueRumorsFor(floor, vaultIds);
  if (truths.length > 0 && rng.next() < TRUE_SHARE) return pickFrom(rng, truths);
  return { text: pickFrom(rng, FALSE_RUMORS), kind: "false" };
}
