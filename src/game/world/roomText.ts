/**
 * Read-aloud room text, in the manner of the boxed text old printed adventures gave the referee to read out.
 * Pure data and selection, no Phaser import. The narrator (`scenes/game/NarratorController.ts`) shows it in a
 * parchment box and speaks it with the browser's built-in speech voice.
 *
 * Contract shared by three lanes (2026-11-14):
 * - The writing lane fills `FLOOR_INTROS`, `VAULT_TEXT`, `TOMB_TEXT`, `ROOM_POOLS` and `BOSS_TEXT` in this file.
 * - The riddle lane adds its new vaults' text in `roomTextRiddles.ts` (`RIDDLE_VAULT_TEXT`), merged below.
 * - The narrator lane only calls the functions at the bottom of this file and never edits the data.
 *
 * Writing rules: second person, present tense, what the character sees, hears and smells on walking in. One to
 * three short sentences (about 25 to 60 words), never a full paragraph. Every set piece's text carries at least one
 * honest hint at its trap or puzzle (a stain, a draft, a sound, a worn path, something out of place) without giving
 * the solution. Original prose only: nothing from any published module, novel or game.
 */
import { RIDDLE_VAULT_TEXT } from "./roomTextRiddles";

export interface RoomText {
  /** Short heading shown on the box, e.g. "The Weighing Hall". Optional for ordinary rooms. */
  title?: string;
  /** The read-aloud text. */
  read: string;
}

/** What kind of ordinary (non-vault) room the player walked into. */
export type RoomKind =
  | "normal" | "trap_corridor" | "monster_closet" | "vault" | "quest_special"
  | "healing_font" | "cursed_crypt" | "gilded_cache" | "stairs_down" | "stairs_up";

/** Floor themes from `getFloorThemeIdx`: 0 upper halls (1-3), 1 dry cave (4-6), 2 cold dressed stone (7-9), 3 the violet deep (10-12). */
export type ThemeIdx = 0 | 1 | 2 | 3;

/** Spoken when the character first arrives on a floor (1 to 13). */
export const FLOOR_INTROS: Record<number, RoomText> = {
  1: {
    title: "The Stair Down",
    read: "The stair from the tavern cellar goes down farther than any cellar stair has a right to. The men who cut it were hired by the last steward of the old keep, paid in advance, and told the work was a drain. You will find that it was not a drain.",
  },
  2: {
    title: "The Weeping Stone",
    read: "The diggers broke into a cave here, wet and older than the keep, and wrote in their ledger that the stone wept. Their ledger runs on for a few more pages and then stops in the middle of a sentence. The sentence was about the king.",
  },
  3: {
    title: "The King They Dug For",
    read: "He was called Haldric the Bright, and children were named for him. Then he made a bargain with something under the hills, so that he would never die, and the bargain kept the crown and the hunger and took everything else. The people began to call him the Hollow King, though only when they thought he could not hear.",
  },
  4: {
    title: "The Dry Halls",
    read: "The caves turn dry here, and the dust lies thick and the colour of old bread. The steward's men understood by now what they were digging toward. They drove iron spikes into every crack that frightened them, because every one of them had been taught that iron holds stone.",
  },
  5: {
    title: "The Steward's Plan",
    read: "The steward could not kill what the king had become, so he decided to bury it and make the burying stay. He had the key to the king's door cut into three pieces, a crown, a seal and a tooth, so that no single thief could ever be trusted with the whole of him.",
  },
  6: {
    title: "The Saint of the Long Dark",
    read: "In the older shrines of these halls stands a saint of the long dark. The pilgrims say she wants nothing from you, not prayers and not gold, only that you bring her something to see by. She has been waiting a very long time, and by every account she is not a patient woman.",
  },
  7: {
    title: "Cold Dressed Stone",
    read: "The cave ends, and cold dressed stone begins: cells and halls and passages laid out by a mason who was in a great hurry and very afraid. Here the steward's men set their traps, and they set them well, since they were the ones who had to walk past them to get home.",
  },
  8: {
    title: "The Court Below",
    read: "The king's court followed him down in his last winter, some of them willingly, and they are laid in rows along these walls with their hands folded. The steward left a note pinned to the lintel of the stair. It says the dead king's road is laid with lies, and that an honest man should ask every stone.",
  },
  9: {
    title: "What the Walls Remember",
    read: "The tally marks of the steward's workmen climb the wall beside the stair. There is one cut for every man who went down, and a second column for every man who came back up. The second column is very short, and somebody has tried to scratch out the last mark in it.",
  },
  10: {
    title: "The Deep",
    read: "Below the crypts the stone changes. Your torch burns a shade of violet, and the walls are warm, as warm as a sleeping hand. The mason's marks stop here, and whatever cut these passages was not a tool that any person owns.",
  },
  11: {
    title: "The Listening Dark",
    read: "The deep is quiet in a way that feels like being listened to. A dead traveller's diary lies open on the floor and says only that the king cannot bear to be seen, that the saint of the long dark sits near him for just that reason, and that every wall down here remembers the sound of a footstep.",
  },
  12: {
    title: "The Last Stair",
    read: "One more stair, the last of the steward's work, and then there is no mason's work at all. At the bottom is a heap of iron spikes, rusted into the shape of a pile, as though someone had once carried a great many of them down and found that they were not enough.",
  },
  13: {
    title: "The Tomb of the Hollow King",
    read: "You step out into a long hall that the diggers never entered, with a road of pale flagstones laid straight down the middle. Over the first arch somebody has cut a warning about lies. At the far end of the hall, something that is not quite a sound waits to be disturbed.",
  },
};

/** Keyed by vault id from `vaults.ts`. Spoken on first entering the vault's area. */
export const VAULT_TEXT: Record<string, RoomText> = {
  loose_flag: {
    title: "The Loose Flagstone",
    read: "A long dry hall is paved in grey flags, all but one. That one is a shade too pale and sits a little proud of its neighbours, and a drift of old bone lies about it. At the far end, a brass lever stands in its socket beside an iron gate.",
  },
  two_levers: {
    title: "The Two Brass Handles",
    read: "Two brass handles stand side by side in the north wall, one green with age and furred with dust, the other rubbed bright and warm by a great many palms. The west wall is full of small black holes, and the floor beneath them is strewn with bronze.",
  },
  weighing_hall: {
    title: "The Weighing Hall",
    read: "One flagstone in the middle of this hall sits a hair lower than the rest, and it is ringed with old scorch. In the north wall a dozen narrow slots all look the same way, toward that stone. A gate shuts the far end of the hall, and it does not look like it is waiting for you.",
  },
  rune_ring: {
    title: "The Ring of Six",
    read: "Six rune stones ring this round hall, each as wide as a hand, and they are warm to the foot, as if something under them were paying attention. A draught runs in from the door and finds the stone beside it first. Carved letters cover the north wall.",
  },
  false_and_true: {
    title: "Two Doors, One Honest",
    read: "Two doors face you. The grand one is carved with vines and crowns and begs to be opened, and its handle is wired to something that is not a lock. The plain wall to the north is smooth, but when you hold your breath you can feel a thread of cold air coming through a seam.",
  },
  sweating_chamber: {
    title: "The Sweating Chamber",
    read: "A single square stone lies in the doorway, rubbed bright by one step in a hundred. The vents above the hall are crusted yellow, and dead flies lie beneath them like seed. On the wall nearby one brick is cleaner than all its neighbours.",
  },
  narrowing_cell: {
    title: "The Narrowing Cell",
    read: "Grooves run across the floor of this small cell from every wall toward one bright stone, which has been rubbed smooth by something dragged across it. The walls are scored and scraped near the floor. Somewhere in the stone outside, a flaw in the wall looks a little too tidy.",
  },
  gilded_bait: {
    title: "The Gilded Bait",
    read: "A golden idol grins from a pedestal in the open, with too many teeth, and the light slides off its lips as if they were greased. Scorch rings the pedestal, the floor is polished by knees, and a hand of bare bones lies reaching toward it across the dust. The east wall has not a mark on it.",
  },
  warm_mouth: {
    title: "The Warm Mouth",
    read: "A face is carved into the north wall, with an open mouth, and a cold brazier stands below it. Two iron levers wait on either side. Over the left one the ceiling slabs sit in grooves, and a fine pale dust has sifted from the joints.",
  },
  thirsty_saint: {
    title: "The Thirsty Saint",
    read: "A stone saint stands with her mouth open and her bowl held out, and the bowl is dry, with a clear salt ring where something once dried. The marks on the plinth are scratched deep. A portcullis shuts the way beyond her, and she seems to know it.",
  },
  door_that_asks: {
    title: "The Door That Asks",
    read: "A door of black wood shuts the end of this hall, with no handle and no keyhole, and words cut over its lintel. The wood is dented and split at shoulder height, as though many men have tried to convince it, and the door has not been moved by any of them.",
  },
  wardens_cell: {
    title: "The Warden's Cell",
    read: "A heavy locked door stands before you. Beside its keyhole there is a tiny pinprick rimmed in green, as if someone had made the lock a little hungry. Near the doorframe, one brick has been worn smooth about its edge by a thumb that worked it for years.",
  },
  returns_corridor: {
    title: "The Corridor of Returns",
    read: "A long corridor of grey flags runs ahead, and the dust is scuffed in one lane along the south wall and lies as smooth as an unslept bed everywhere else. Where the dust is whole, now and then, a seam in the floor marks a square of stone that does not quite match.",
  },
  scorched_gallery: {
    title: "The Gallery of Scorch",
    read: "Black streaks fan across the whole width of this gallery from a single hole in the north wall. In the cracks at the foot of the wall lie small bronze darts with green tips. Down the length of the hall, close to the floor, a thin glint hangs in the torchlight.",
  },
  honest_wall: {
    title: "The Honest Wall",
    read: "A hall of fine flagstones, all of them smooth and all of them too clean. The north wall is hung with old lamps, and a line is cut beneath them in tall letters. Bits of bone and rusted spike tips lie in the dust by the south wall, and nothing else seems to have walked here.",
  },
};

/** Keyed by tomb chamber id (`chamber_1` to `chamber_12`, see `tomb.ts`). */
export const TOMB_TEXT: Record<string, RoomText> = {
  chamber_1: {
    title: "The Road of Lies",
    read: "A road of pale flagstones runs ahead, as straight and honest as a ruler. Over the arch is cut a warning about the dead king's road. A single boot lies in the middle of the way, and the rest of its owner lies in the boot.",
  },
  chamber_2: {
    title: "The Wire Gallery",
    read: "Black fans of soot spread across the floor from a hole in the north wall, and green tipped bronze darts lie in the cracks below it. The torchlight finds a thin bright line at ankle height, and then, as you lean to look, loses it again.",
  },
  chamber_3: {
    title: "The Weighing Gate",
    read: "One flagstone sits a hair lower than the rest, ringed with old scorch. Narrow slots in the north wall are all aimed at the middle of the floor, and a gate stands shut at the far side. Words are cut into the wall about luggage.",
  },
  chamber_4: {
    title: "The Ring of Six Runes",
    read: "Six stones ring this round hall, warm underfoot, as if something below were listening. A draught pours in at the door and strikes stone near your feet. Over the ring, a long inscription crowds the north wall, and a faint pale shard glints in the middle of the floor.",
  },
  chamber_5: {
    title: "The Anvil Door",
    read: "A black door of iron bands stands before you, with no handle. A riddle is cut into the lintel, a few lines about blows and swords. Dozens of shoulder blades are stacked beside the doorway like crockery, and none of them has ever been of any use.",
  },
  chamber_6: {
    title: "The Breathless Hall",
    read: "A single square stone lies just inside the doorway, rubbed bright by one step in a hundred. The vents overhead are crusted yellow, and dead flies lie beneath them like seed. In the wall by your elbow, one brick is far too clean.",
  },
  chamber_7: {
    title: "The Hall of Pads",
    read: "The dust of this hall is scuffed in a single lane along the south wall and lies untouched as a made bed everywhere else. Here and there a hairline square marks the floor, and when you lean on one the stone inside it hums softly under your boot.",
  },
  chamber_8: {
    title: "Two Doors, One Honest",
    read: "A grand door of carved crowns begs to be opened, though its hinge pins are painted on and the dust about its frame is full of broken dart shafts. In the plain north wall, a hair thin seam is pinned in the middle, and a thread of cold air whispers through it.",
  },
  chamber_9: {
    title: "The Narrowing",
    read: "Grooves cross the floor from every wall toward a bright stone in the middle, and the stone has been rubbed smooth by something dragged over it. The walls bear long scars down to the floor. Somewhere in the entrance, a flaw in the masonry looks very much like a place for a hand.",
  },
  chamber_10: {
    title: "The Dry Saint",
    read: "A saint of the long dark stands here, and in her raised hand is an empty iron cresset, black with old soot. Words are cut deep into her plinth, and they say she does not want to be paid. A gate shuts the far end, and she watches you with blind stone eyes.",
  },
  chamber_11: {
    title: "The False Tomb",
    read: "A golden effigy lies on a bier, wearing a smile too wide for its face, and its crown is bright where everything else in the room is dust. Scorch rings the bier, and the floor around it is polished by knees. A carved mouth waits in the north wall above two iron levers and a cold brazier.",
  },
  chamber_12: {
    title: "The Hollow King's Door",
    read: "A cold breath comes from a door with no handle, no hinge and no pin, only three keyholes: one cut like a crown, one like a seal, and one like a tooth. On the lintel are words about a king buried in pieces. The inner face of the door, you notice, was built to be walked into once.",
  },
};

/** Spoken when the Hollow King first notices the player. */
export const BOSS_TEXT: RoomText | undefined = {
  title: "The Hollow King",
  read: "So. Another has walked my road. They all bring a torch and a little courage, and they leave me both. I was a king before your grandmother's grandmother drew breath, and I am hollow now, which is only to say that there is room in me for you.",
};

const r = (read: string): RoomText => ({ read });

/** Pools of ordinary room text: for each theme and kind, several variants. */
export const ROOM_POOLS: Partial<Record<ThemeIdx, Partial<Record<RoomKind, RoomText[]>>>> = {
  // Theme 0: the wet cave, floors one to three. Slate blue stone, dripping water, slick floors.
  0: {
    normal: [
      r("Water runs down the walls of this cave in thin silver threads and gathers in a shallow pool in the middle of the floor. Every drip rings a little differently from the last, so that the place seems to be tuning itself."),
      r("The ceiling hangs low and the stone is slick as a fish. Pale moss grows in the cracks, and a long-dead rat floats in a puddle, looking bored about it."),
      r("A narrow chamber of wet blue rock opens before you. The air tastes of pennies, and somewhere beyond the next turn a trickle goes on talking to itself, as it has for a thousand years."),
      r("Slick stone bends round a corner and swallows your torchlight. The floor is gritty with old mud, and a few bootprints lead in and none lead out, which is not a thing to dwell upon."),
      r("Scratched low in the wall by a hand that was shaking: I grow smaller as I serve you, I am born on a wick and I die without a grave, and when I am gone the dark takes back every road."),
      r("A cave mouth, with stalactites hanging like a row of teeth that never learned to close. Cold water seeps down the walls, and an empty wineskin lies against one of them, drained a long time ago."),
      r("The ground here is a field of loose wet stones, and each one rocks a little when it is stepped upon. A drip lands on the back of your neck at the worst possible moment, and then another."),
      r("A round little chamber, as damp as a cellar in spring. The walls are dark and shining, and a faded chalk arrow on the stone points back the way you came, as if to say that somebody once thought better of it."),
    ],
    trap_corridor: [
      r("A narrow passage runs ahead, and the stones in the floor are all freshly scuffed, as if many boots had scraped along its edges. In the very middle, one flag is missing, leaving only a neat dark hole."),
      r("This corridor is too tidy for a cave. A brown stain, long dried, spreads across the middle of the floor, and from somewhere in the wall comes the faint whine of a spring under tension."),
      r("A long passage of wet flagstones, each as slick as soap, except for a few that are dry and pale. A scatter of old bolts lies along the walls, as though somebody had cleaned up after a very bad day."),
    ],
    monster_closet: [
      r("A low den, crowded and close. A sour animal smell hangs in the damp air, and from behind a pile of loose stones comes a slow scratching that stops the moment you stop breathing."),
      r("The little door to this nook is barred, and the bar is on the outside of it, which is a thing one does to keep something in. The wood has been gnawed through at the bottom."),
      r("A hollow in the rock, floored with trampled straw and gnawed bones. Something here has slept recently, and from the shadows at the back comes a breath, slow and wet and not your own."),
    ],
    vault: [
      r("A strong room cut into the cave wall, with chests along its sides and a few gold coins gleaming in the muck. Whoever stored all this was in a hurry, and somebody else was in a hurry to keep it for himself."),
      r("A dry, deep alcove, quite out of keeping with the wet cave outside. Chests are stacked inside, and the old iron of their hinges is flaking, but their locks look solid and the gold still has its shine."),
      r("The cave opens into a hoard room, with stout chests along the back wall and a rotted sack split open on the floor. Coins and bright pebbles are everywhere, and the whole room smells of money and mildew."),
    ],
    quest_special: [
      r("A small chamber that was clearly not cut by nature. Something of importance has been set down here, and the floor in front of it is trodden hard by those who came before you."),
      r("The cave widens, and a ring of old stones marks a place that somebody wished to find again. The air here has a purpose in it, as if the room were waiting for a particular visitor."),
      r("A natural hall, but swept, with the bones removed to the edges in tidy heaps. Whoever lives here, or lived here, has something to keep, and you are about to be asked about it."),
    ],
    healing_font: [
      r("A little spring wells up in a stone basin, clear as glass and cool as a morning. The water is the only thing in the cave that does not smell of mould, and the wounded who drink from it rise a little mended."),
      r("A clean pool lies in a hollow of the rock, with a ring of white pebbles at its edge. Travellers have left small coins in it, and it will mend a body that kneels to drink."),
      r("Water trickles from the roof into a carved bowl, and the bowl has been rubbed smooth by many hands. The water is sweet and faintly warm, and it will soothe a wound if you let it."),
    ],
    cursed_crypt: [
      r("A little crypt cut into the cave wall, the dead laid in stone shelves with their coins still on their eyes. The air is cold, and a protective chill settles on your shoulders as you enter, but something rises among the shelves."),
      r("A burial niche, dusted white. A faint chill lays itself across your shoulders like a cloak, a gift from the dead, and a champion among them lifts its head and takes up its sword."),
      r("Bones lie in stone cradles all along the wall. The cold that settles on you is almost a kindness, a ward set long ago, and the largest of the sleepers stirs. It will pay well to see this room cleared."),
    ],
    gilded_cache: [
      r("A seam of dull gold lines the cave wall, laid by hand, and coins have been pressed into the clay like raisins into a loaf. A great deal of treasure waits here, for anyone who will clear the room of whatever guards it."),
      r("A hollow in the rock holds a glitter of gilt plates and loose coin. The riches are real and the room is not empty, so the gold will be yours only once the room is quiet."),
      r("Gold winks from every crack in this cave, the leavings of some old hoarder. It looks like a gift, but the room does not feel empty, and the best of it will go to whoever clears it."),
    ],
    stairs_down: [
      r("A stair of cut steps goes down into the wet dark, the steps worn to dishes in the middle by the feet of men who did not come back for them. A cold draught rises from below and smells of deeper stone."),
      r("The floor ends in a black stair. Water runs down the steps like a little stream, and from the bottom comes the faint echo of your own breath, thrown back as though somebody were practising it."),
      r("An old stair spirals down into the rock, with a rusty rail on one side and nothing at all on the other. The deeper way is cold, and quiet, and certainly not in a hurry to see you."),
    ],
    stairs_up: [
      r("The stair back toward the tavern climbs from this chamber, and the air that falls down it smells of woodsmoke and spilled ale. It is the sweetest smell in the world just now."),
      r("A worn stair rises toward the light, and a draught of warm air comes down it with the faint, far sound of laughter. Somewhere above, there is a fire that is nothing to do with you."),
      r("Steps lead up from here to the world you left. A scrap of lamp light lies on the lowest of them, and you think for a moment of the tavern fire and the ale, and then you think of the gold."),
    ],
  },

  // Theme 1: the dry cave, floors four to six. Brown dust, stale heat, torchlit orange.
  1: {
    normal: [
      r("The dust here lies as thick as flour, and your boots leave prints that fill slowly behind you. The air is dry and a little hot, like the inside of an oven that has long since gone cold."),
      r("A cave of brown stone, hot and still. A bleached skull sits on a ledge, and somebody has balanced a small stone on its head, as a joke, long ago."),
      r("Carved above the doorway in square letters: I am ten feet long and I have never been afraid, because I go in first. Every fool who forgot me has paid for it with a finger, or worse."),
      r("The walls are the colour of stale bread and rough as a file. Charred sticks lie scattered across the floor, the remains of a dozen small fires, none of them lit by anyone who stayed."),
      r("A dry gully crosses the floor, and in the bottom of it lie dead leaves that have no business being this far from any tree. They crunch like old paper underfoot."),
      r("The air in this room is stale and hot, and it tastes of ash. A cracked clay jar sits in one corner, and in it, on a bed of dust, lies a single small bone, neatly placed."),
      r("A wide, low cave. Strange red streaks run across the ceiling, as though the stone had been scorched by something that never meant to stay. Dust drifts down on your shoulders as you pass."),
      r("Here the rock is full of little holes, like a honeycomb, and a faint hum comes from the walls. It is only the wind, you tell yourself, and the wind is very polite about it."),
    ],
    trap_corridor: [
      r("The floor of this dry hall is scored with old scrape marks leading to the wall and stopping short. A brown stain lies in the middle of it, and the dust round the stain has been brushed smooth by something."),
      r("A long corridor, with one flagstone that sits a little low. The dust on the others is scuffed in a crooked line, and somewhere in the wall you can hear a spring humming, very faintly."),
      r("A narrow gallery. Rusted spikes lie in the dust like dropped pins, and at the foot of the wall are a few small holes, each as round as a coin. You think about where you will put your feet."),
    ],
    monster_closet: [
      r("The door to this side cave has been barred from the outside with a thick beam, and the beam is scarred with long claw marks. A rank smell of musk and old meat leaks from under the door."),
      r("A small den lined with filthy rags. A thin dry scratching comes from the back, the sound of claws on stone, and then it stops, as though something had heard you thinking."),
      r("The room is warm, and the heat is a living heat. A hush has fallen, and the nest of bones in the corner is heaped higher than anything that eats that much would ever sit quietly beside."),
    ],
    vault: [
      r("A strong room of dry brown stone, its chests lined up along the back wall and its door long since broken. Coins lie in the dust like spilled grain, and no one has stolen them. That ought to worry you."),
      r("A hoard chamber, hot and still. Gilded plates lean against the walls, and a heap of dull coin sits in the middle, as if some great creature had once taken a long, comfortable sleep upon it."),
      r("The cave opens on a treasure room whose iron chests have rusted a deep red. A few are open and empty, but others stand shut, and the gold in their locks is still bright."),
    ],
    quest_special: [
      r("A chamber whose floor has been swept clean while the rest of the cave lies thick with dust. Whoever sweeps it still comes here, and has set out something for a visitor."),
      r("A round room, cut by hands, with a smooth ledge around the wall. A charcoal mark is scrawled over the door, and the room has the settled air of a place where an errand is meant to end."),
      r("A cave that someone has furnished: a stool, a cold fire pit, a bundle of rags. The owner is gone, but the objects were left in a pattern, as though to tell you what he wanted."),
    ],
    healing_font: [
      r("A rare spring bubbles up from a crack in the dry stone, and a basin has been cut to catch it. The water is clean and cool, and the dust around it is damp, with the prints of many grateful travellers."),
      r("Out of the dry rock trickles a thread of clear water into a shallow bowl. A little green grows round it, the only green in the whole cave, and the water will mend a wounded body."),
      r("A cool breath comes from this chamber after all the heat, and in the middle is a clean stone font with water that never dries. It tastes of iron and of rest, and it will ease what ails you."),
    ],
    cursed_crypt: [
      r("A dry crypt, where the dead have mummified in their shelves like leather. A cold shield settles around you at the door, a last courtesy of the old burial, and then one of the sleepers sits up."),
      r("The air in this tomb is old and thin, and a cold blessing lies on your shoulders as you step inside. The largest of the corpses stirs. Whoever clears this room will be repaid in hard-won knowledge."),
      r("A burial cave of dried and folded bodies, each with a coin in its teeth. A ghostly chill wraps you like a mantle, and the crypt's champion rises from his bier with a long, dry sigh."),
    ],
    gilded_cache: [
      r("Gold is everywhere in this cave: gilt vessels, a heap of coin, and a goblet set upright in the middle of the floor, and someone is clearly defending it. The best of it will go to whoever clears the room."),
      r("A glitter of coin lies among the dust, and bright plates lean on the walls. This is a cache, and it is not abandoned. The treasure is rich, and it will be yours when the room is quiet."),
      r("A burrow of gold. Bars of dull metal lie in a row, and loose coin is strewn about like gravel. The room is guarded by someone, so the gold is yours only after the room is cleared."),
    ],
    stairs_down: [
      r("Steps carved in the dry rock lead down into a hotter dark. Dust slides down them in little rivers, and from below comes a faint rumbling, deep and slow, like a very large animal turning over in its sleep."),
      r("A stair of cracked stone drops away from this room. The air rising from it is dry and stale, and the walls of the stairwell are scratched with a hundred tally marks, most of them short."),
      r("Here the floor opens on a dusty stair, going down. The steps are broad and low, built for men carrying something heavy, and the dark at the bottom is thick enough to lean upon."),
    ],
    stairs_up: [
      r("A stair climbs back toward the upper caves. A damp, cooler breath comes down it, and you recall, with real affection, a place where the walls wept."),
      r("The steps leading up are worn almost smooth, and the dust upon them has been trodden to a path. Somebody has been coming and going here, and the last footprints face upward."),
      r("A rough stair rises from this chamber, to a cooler air and a distant glimmer. It is nearly a kindness to be reminded that there is an upper world with weather."),
    ],
  },

  // Theme 2: the dungeon, floors seven to nine. Cold dressed stone, cells, iron rings.
  2: {
    normal: [
      r("Cold dressed stone, laid by a mason who hated his work. The joints are tight as a miser's fist, and iron rings are set in the walls at a height just right for a prisoner's wrists."),
      r("A guardroom, long abandoned. A table lies on its side, a dice cup beside it, and three dice are still showing their last throw. Nobody seems to have been willing to pick them up."),
      r("A line burned into a beam over the door: I am broken when you say my name, yet I am the best friend a listening man has, for every door tells its secrets to me."),
      r("A passage lined with empty cells, their doors hanging open and their straw long turned to dust. Names are scratched into the stone above each doorway, and most of them are crossed out."),
      r("A rusted lantern hangs from a hook, and under it, scratched into the stone: I am dug from the ground and I have never been warm, yet I hold a stone mouth open and keep a wall from closing. Rust will undo me."),
      r("The floor of this hall is checkered in black and grey, though most of the black has worn away. The walls are cold to the touch, and a draught sighs down the length of the room like an old complaint."),
      r("A cold hall of grey blocks, hung with the rags of banners that once meant something. An iron brazier stands in the middle, filled with a pile of grey ash that nobody has dared to disturb."),
      r("Cell doors line this corridor, each with a little barred window. Behind one of them a single boot stands neatly upright, and you decide you do not need to know where the other boot went."),
    ],
    trap_corridor: [
      r("The corridor is paved with large grey flags, and three of them are scuffed bright at the edges where other feet turned away. A brown stain splashes the wall at knee height, and nobody has bothered to wash it."),
      r("A cold corridor, long and straight. A single flag in the middle is missing, replaced by a neat black square, and the dust beside it holds the curve of a heel. The spring in the wall gives a soft click."),
      r("The floor of this passage is too clean, as though someone sweeps it, and the walls are pocked with small round holes. A hollow hum comes from behind the stone, and you ask yourself if you are sure."),
    ],
    monster_closet: [
      r("A guard barracks, with its door barred from the outside, and the bar is dented from within. A smell of old blood and wet fur seeps under it, and something behind it is breathing in time with you."),
      r("A cell with its door set slightly ajar, and a heap of straw in the corner that rises and falls, slowly, like a sleeper. The scratching in the wall stops the instant you look at it."),
      r("This low room has been shut up on purpose. Fresh claw marks run up the inside of the door, and the bar lies across it on the wrong side for anyone who meant to stay inside."),
    ],
    vault: [
      r("A treasury of the old garrison, shut in iron, with stout chests along the walls and a ledger open on a stand. The pages record large sums, and some of the sums are still here."),
      r("A strong room of dressed stone with a door of heavy bars. Gold gleams through the grille, and the lock on the inside is bright with recent use, which suggests that someone wanted to keep it."),
      r("A cold stone vault where the garrison kept its pay. Heaps of tarnished coin and a few locked boxes lie in neat rows, and the dust on them is thinner than anywhere else on this floor."),
    ],
    quest_special: [
      r("A guard post with a table, a chair, and a name scratched into the wall above them. The room has the unfinished air of a place that holds a promise to be kept by someone."),
      r("A chamber with an old banner hung on the far wall, and a cold hearth beneath it. A task has been left here, plain as a signpost, and the dust has been brushed from the place where it was set."),
      r("A neat, cold chamber, kept better than any room in the dungeon has a right to be. A mark has been chalked on the floor for you, a mark meant for a visitor who comes with a purpose."),
    ],
    healing_font: [
      r("A small stone shrine stands against the wall, and a cup of clear water sits in a niche before it. The water neither warms nor dries, and those who drink are mended, as the old guards were."),
      r("A well-head of cut stone, with a bucket and a chain, stands in the corner. The water rises, pure and cold, and it will close a wound as a mother closes a door."),
      r("A basin carved with leaves, filled with water that has gone silver in the torchlight. The guards of this place drank here after their rounds, and so, if you are wise, will you."),
    ],
    cursed_crypt: [
      r("A crypt of dressed stone, its sarcophagi lined along the walls. A cold ward settles about you as you cross the threshold, and then a lid slides, with a long and gritty groan, and a champion of the dead sits up."),
      r("A burial vault of the garrison, with the names of its dead cut on every shelf. A pale chill wraps your shoulders like a cloak, a ward from the old rites, and the tallest of the sleepers rises with its sword in hand."),
      r("A tomb of tight, cold stone, where the dead lie in rows with their feet to the door. The chill that lays itself upon you is protective, but the champion who stands up from the middle bier is not."),
    ],
    gilded_cache: [
      r("The garrison hid its plunder here: gilt cups, coin, a cask of silver spoons. The wealth is real, and so is the thing that guards it. Clear the room and the best of the hoard is yours."),
      r("A storeroom heaped with gold, set out like a feast. The room is not empty, though it looks it, and the greatest part of the treasure goes to the one who clears away its keeper."),
      r("The walls of this chamber glitter with gilt, and loose coin lies in pools beneath the torches. It is a rich cache and a defended one, and the reward is for the one who leaves the room quiet."),
    ],
    stairs_down: [
      r("An iron-railed stair descends from this chamber, and the iron is cold enough to bite through a glove. The stone steps go down into a dark that is considerably older than the dark you have been using."),
      r("The way down is a tight, spiralling stair of grey stone, worn in the centre by long traffic. Each step breathes up a little more cold, and from far below comes the faint sound of dripping iron."),
      r("A stair plunges down from a doorway of heavy stone, with names cut into the lintel, one for every man who went down. The newest names are fresh, and the list is not finished."),
    ],
    stairs_up: [
      r("A stair rises from this room toward the warmer caves. A little of the cave dust drifts down it, and with it a smell of damp that you would, just now, gladly breathe."),
      r("The steps going up are old, narrow and cold, but there is a faint light at the top, and the sound of water, and you remember that there is a sky somewhere, however long ago."),
      r("A stair of dressed stone climbs away from this chamber. The way back is quiet, and a thin draught of cooler air runs down it, as polite as an invitation to leave."),
    ],
  },

  // Theme 3: the deep, floors ten to twelve. Violet torchlight, warm stone, strange magic.
  3: {
    normal: [
      r("The walls here are warm, and the stone is smooth as glass, with veins of violet running through it. Your torch burns the wrong colour, and your shadow lies across the floor a little longer than it should."),
      r("A hall of dark violet stone, with a faint crackling in the air, as of a thing about to speak. Small blue sparks run along the floor and die without a sound."),
      r("Scratched into the plaster, in a hand that grew calmer as it went: I show you everything and keep none of it, I have a face and no mouth, and I tell the truth by lying the wrong way round."),
      r("The roof of this chamber is lost in darkness, and the air hums at the edge of hearing. A long thin crack runs down one wall, and the warmth that comes out of it smells of rain on hot stone."),
      r("The floor is polished to a dull gleam, and in it, faintly, you see the shape of your own feet, and a second pair beside them that you do not remember bringing. The second pair goes away when you look."),
      r("A cavern of black glass and violet shadow. The walls are cut with long spiral grooves, and each one is warm to the touch, like the back of a sleeping animal."),
      r("This room is perfectly silent. Your own footsteps seem to fall into the stone and not come back, and the dark at the edge of your torchlight is thick as velvet and twice as quiet."),
      r("A smooth passage opens into a wide room that no tool ever cut. The stone is warm, the air is dry, and a pale violet glow seeps from the walls, as though they remembered what it was to be lit."),
    ],
    trap_corridor: [
      r("This glassy corridor is faultless, and that is the trouble. In the middle a single tile is dull where the rest are bright, and you hear, deep in the wall, the soft whine of a spring being wound."),
      r("The floor of this passage hums faintly underfoot, with a pattern of scuffs running along both walls and none down the middle. A rust coloured stain has soaked into one tile, and then dried, and then been left."),
      r("A long violet corridor, and one stone in it is missing, leaving a hole as neat as a keyhole. The walls on both sides are pitted, and you think carefully about each next step."),
    ],
    monster_closet: [
      r("A sealed chamber behind a stone door, and the bar upon it is on the wrong side. A warm, sour smell comes from under the door, and a slow scratching goes on, patient as a clock."),
      r("The air in this alcove is warmer than it ought to be, and thick with a musky stink. Something shifts in the dark, and a pair of dull points of light, low to the floor, open and fix on you."),
      r("A narrow room whose door has been barred from the passage. Claw marks cover the inside in thick, deliberate stripes, and a hush has settled that feels like held breath."),
    ],
    vault: [
      r("A vault of black glass, its chests set in a ring about a pedestal, and the gold inside gives off a faint violet light. The treasure of this deep place is old and plentiful, and it waits for a hand."),
      r("A hoard room of smooth dark stone, where open caskets spill coin onto the floor. The glitter of it is dazzling after so much dark, and nothing in the room moves at all."),
      r("A deep strong room, warm as a kitchen. Chests of tarnished silver stand along the walls, and a heap of strange old coin lies in the middle, stamped with a crown that you do not recognise."),
    ],
    quest_special: [
      r("A round chamber of warm violet stone, quiet as a held breath. A thing has been left in the middle of the floor as if for a particular visitor, and the air around it is expectant."),
      r("A smooth, bare room, and in it a single object waits, laid out with great care. The warmth of the stone is gentle, and the room seems to be offering something, or asking."),
      r("A small chamber where the glow from the walls gathers into a pool of light in the centre. Someone from far above has sent an errand here, and the errand's end is on the floor."),
    ],
    healing_font: [
      r("A font of black glass stands in a hollow, brimming with water that glows a pale and gentle blue. It is warm to the hand, and it will knit a wound the way a tailor mends a seam."),
      r("In the heart of the deep, a spring of clear water rises into a basin of violet stone. It is startlingly sweet, and the weary who drink from it stand up lighter and mended."),
      r("A shallow pool lies in the floor, round and still, and your torch makes no reflection in it, only a soft light of its own. Whoever drinks will be healed, and whatever drank here before was grateful."),
    ],
    cursed_crypt: [
      r("A crypt of black stone where the dead sit upright on thrones of bone. A pale ward settles round your shoulders as you enter, and the largest of the sitters lifts its head, and a crown of tarnished iron slips on its brow."),
      r("A deep tomb, cold in a warm place. A faint protective chill lies on you like a hand on the shoulder, and the champion of this crypt rises, tall, grey and patient, to ask what you want of it."),
      r("The dead of the old court lie in niches round this vault, each wearing a ring. A pale chill wraps you at the door, a courtesy, and one of the great ones stirs, and will repay the trouble of its undoing."),
    ],
    gilded_cache: [
      r("Gold has run down the walls of this chamber like wax, cooled into ripples and leaves. It is a rich cache, and it is not unguarded, and the best of the gold goes to whoever clears the room."),
      r("A chamber heaped with ancient coin and gilded plate, glowing a faint violet in the dark. The hoard is huge, and the room is not empty. Quiet it, and the hoard is yours."),
      r("A vast spill of gilded things, bowls and crowns and masks, lies across the floor. It looks like a gift, but the room breathes, and the reward is for the one who leaves it silent."),
    ],
    stairs_down: [
      r("A great stair of black glass descends from this room, each step as broad as a bed, and the warmth coming up from below is the warmth of a living body. The walls of the stairwell are quietly humming."),
      r("The way down is a slope of smooth violet stone with steps worn into it, though no feet that you know could have worn them. The dark below is deep, and attentive, and quite sure you are coming."),
      r("A stair of cold light opens in the floor. It goes down a long way, and a faint, slow pulse comes up it, steady as a heart that has been waiting for a very long time."),
    ],
    stairs_up: [
      r("A stair of dark glass climbs from this chamber, and a breath of cooler air comes down it, smelling of stone and torch smoke and the plain, ordinary world. It is a welcome smell."),
      r("The steps rise toward the upper dungeon, and the violet glow of the walls fades as they climb. Somewhere up there is an honest wall of grey stone, and you are quite fond of it."),
      r("A narrow stair leads up from this room. The warmth of the deep falls away as you look at it, and a thin draught of colder air runs down the steps, smelling of home."),
    ],
  },
};

// ── Lookup (used by the narrator) ────────────────────────────────────────────────

export function floorIntro(floor: number): RoomText | undefined {
  return FLOOR_INTROS[floor];
}

/** Text for a vault or tomb chamber area id, if any was written. */
export function textForArea(areaId: string): RoomText | undefined {
  return VAULT_TEXT[areaId] ?? RIDDLE_VAULT_TEXT[areaId] ?? TOMB_TEXT[areaId];
}

/**
 * Text for an ordinary room. Deterministic for a given seed (use the floor number and room index), so a room reads
 * the same each visit. Returns undefined when the pool is empty.
 */
export function textForRoom(theme: ThemeIdx, kind: RoomKind, seed: number): RoomText | undefined {
  const pool = ROOM_POOLS[theme]?.[kind] ?? ROOM_POOLS[theme]?.normal;
  if (!pool || pool.length === 0) return undefined;
  const i = Math.abs(Math.imul(seed | 0, 2654435761) | 0) % pool.length;
  return pool[i];
}

export function bossText(): RoomText | undefined {
  return BOSS_TEXT;
}
