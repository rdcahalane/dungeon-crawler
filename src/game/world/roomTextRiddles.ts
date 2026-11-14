/**
 * Read-aloud text for the riddle vaults (owned by the riddle lane). Same shape and writing rules as `roomText.ts`.
 * Keyed by vault id.
 */
import type { RoomText } from "./roomText";

export const RIDDLE_VAULT_TEXT: Record<string, RoomText> = {
  bell_door: {
    title: "The Tongueless Bell",
    read: "A door of black oak stands across the hall, letters crawling over its lintel. Under an empty iron bracket a skeleton sits with a rotted rope in its fist, and beside its knee lies a clapper with nothing left to ring.",
  },
  lampkeeper: {
    title: "The Lampkeeper",
    read: "A woman of grey stone stands with a carved cloth over her eyes, both hands held out and cupped. Her palms are black with soot, and charred scraps of wood lie scattered at her feet. Beyond her an iron grate bars the way.",
  },
  held_breath: {
    title: "The Hall of Held Breath",
    read: "The hall is utterly quiet, and the quiet feels deliberate. A bronze gong shines on its chain, and beneath it a skeleton lies with the mallet still in its hand. One flagstone in the floor is worn into a shallow dish.",
  },
  reckoners_row: {
    title: "The Reckoner's Row",
    read: "Five brass handles stand in a row along the north wall, a small plaque beneath each. Black slots line the opposite wall. One skeleton sits against the fourth plaque, a bent pick in its fingers, looking oddly at ease.",
  },
  dial_of_hours: {
    title: "The Dial of Hours",
    read: "Four warm flagstones are set into the floor of a wide hall, far apart from one another. A skeleton lies stretched toward the middle of the room with chalk in its hand, and a faint white line wanders away from the east wall and stops.",
  },
  twin_mouths: {
    title: "The Twin Mouths",
    read: "Two carved stone mouths gape from the north wall, one on either side of a long inscription. Two handles stand in the south wall. The floor beneath the western one is black with soot and glinting with bronze dart tips.",
  },
  starved_judge: {
    title: "The Starved Judge",
    read: "A crowned judge sits on a stone throne, his ribs showing through the carving and his cupped hands bone dry. A skeleton kneels before him with a heap of coins at its knees and a purse that was never opened.",
  },
  sleepers_bier: {
    title: "The Sleeper's Bier",
    read: "Five flagstones lie in a line across the south of the hall, each warm and each a little proud of the floor. A skeleton rests on its back above them, arms folded over its ribs, feet toward the door. Only one flag has no scorch on its edge.",
  },
};
