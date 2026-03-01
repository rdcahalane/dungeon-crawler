// ── Quest & Inventory System ─────────────────────────────────────────────────
// Pure logic — no Phaser dependency.

export type QuestObjectiveType = 'KILL_TYPE' | 'KILL_TOTAL' | 'OPEN_CHESTS' | 'REACH_FLOOR' | 'FIND_ROOM';

export interface QuestObjective {
  type: QuestObjectiveType;
  targetKey?: string;       // e.g. enemy type key or room tag
  targetCount: number;
  currentCount: number;
  label: string;            // human-readable "Kill 5 Skeletons"
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  objectives: QuestObjective[];
  rewardGold: number;
  rewardXP: number;
  rarity: 'common' | 'rare' | 'legendary';
  status: 'available' | 'active' | 'completed';
  acceptedAt?: number;
  completedAt?: number;
  expiresAt: number;        // timestamp ms
  specialRoomTag?: string;  // if set, injects a room into dungeon
  specialRoomLabel?: string;
}

export interface InventoryItem {
  id: string;
  type: 'WEAPON' | 'ARMOR' | 'SCROLL' | 'STAT_TOME' | 'CONSUMABLE' | 'QUEST_ITEM';
  label: string;
  bonus?: number;
  equipped?: boolean;
  floorFound: number;
  timestamp: number;
}

// ── Quest template pool ──────────────────────────────────────────────────────

interface QuestTemplate {
  titleFn: (tier: number) => string;
  descFn: (tier: number) => string;
  objectivesFn: (tier: number) => QuestObjective[];
  rarityFn: (tier: number) => Quest['rarity'];
  goldFn: (tier: number) => number;
  xpFn: (tier: number) => number;
  specialRoomTag?: string;
  specialRoomLabel?: string;
}

const QUEST_TEMPLATES: QuestTemplate[] = [
  // ── Kill-type quests ───────────────────────────────────────────────────────
  {
    titleFn: (t) => `Exterminate Skeletons${t > 1 ? ' II' : ''}`,
    descFn: () => 'The undead stir in the depths. Put them back to rest.',
    objectivesFn: (t) => [{ type: 'KILL_TYPE', targetKey: 'SKELETON', targetCount: 3 + t * 2, currentCount: 0, label: `Kill ${3 + t * 2} Skeletons` }],
    rarityFn: () => 'common', goldFn: (t) => 40 + t * 20, xpFn: (t) => 30 + t * 15,
  },
  {
    titleFn: (t) => `Troll Slayer${t > 1 ? ' II' : ''}`,
    descFn: () => 'Trolls regenerate — strike fast before they heal.',
    objectivesFn: (t) => [{ type: 'KILL_TYPE', targetKey: 'TROLL', targetCount: 2 + t, currentCount: 0, label: `Kill ${2 + t} Trolls` }],
    rarityFn: () => 'rare', goldFn: (t) => 80 + t * 30, xpFn: (t) => 60 + t * 20,
  },
  {
    titleFn: () => 'Spider Infestation',
    descFn: () => 'Giant spiders have infested the upper floors. Clear them out.',
    objectivesFn: (t) => [{ type: 'KILL_TYPE', targetKey: 'GIANT_SPIDER', targetCount: 4 + t, currentCount: 0, label: `Kill ${4 + t} Giant Spiders` }],
    rarityFn: () => 'common', goldFn: (t) => 35 + t * 15, xpFn: (t) => 25 + t * 10,
  },
  {
    titleFn: () => 'Ghost Hunter',
    descFn: () => 'Restless spirits haunt the deep corridors. Banish them.',
    objectivesFn: (t) => [{ type: 'KILL_TYPE', targetKey: 'GHOST', targetCount: 2 + t, currentCount: 0, label: `Kill ${2 + t} Ghosts` }],
    rarityFn: () => 'rare', goldFn: (t) => 70 + t * 25, xpFn: (t) => 50 + t * 20,
  },
  {
    titleFn: () => 'Rat Exterminator',
    descFn: () => 'The tavern cellar connects to the dungeon. Rats are everywhere.',
    objectivesFn: (t) => [{ type: 'KILL_TYPE', targetKey: 'GIANT_RAT', targetCount: 5 + t * 2, currentCount: 0, label: `Kill ${5 + t * 2} Giant Rats` }],
    rarityFn: () => 'common', goldFn: (t) => 25 + t * 10, xpFn: (t) => 20 + t * 10,
  },
  {
    titleFn: () => 'Dark Elf Bounty',
    descFn: () => 'Dark elves have been spotted. They must not establish a foothold.',
    objectivesFn: (t) => [{ type: 'KILL_TYPE', targetKey: 'DARK_ELF', targetCount: 2 + t, currentCount: 0, label: `Kill ${2 + t} Dark Elves` }],
    rarityFn: () => 'rare', goldFn: (t) => 90 + t * 30, xpFn: (t) => 70 + t * 25,
  },
  // ── Kill-total quests ──────────────────────────────────────────────────────
  {
    titleFn: (t) => `Dungeon Cleaner${t > 1 ? ' II' : ''}`,
    descFn: () => 'The guild needs proof of your combat prowess.',
    objectivesFn: (t) => [{ type: 'KILL_TOTAL', targetCount: 10 + t * 5, currentCount: 0, label: `Kill ${10 + t * 5} enemies` }],
    rarityFn: (t) => t > 2 ? 'rare' : 'common', goldFn: (t) => 50 + t * 25, xpFn: (t) => 40 + t * 20,
  },
  // ── Open chests quests ─────────────────────────────────────────────────────
  {
    titleFn: () => 'Treasure Hunter',
    descFn: () => 'Open chests deep in the dungeon. Beware of mimics!',
    objectivesFn: (t) => [{ type: 'OPEN_CHESTS', targetCount: 3 + t, currentCount: 0, label: `Open ${3 + t} chests` }],
    rarityFn: () => 'common', goldFn: (t) => 45 + t * 20, xpFn: (t) => 35 + t * 15,
  },
  // ── Reach floor quests ─────────────────────────────────────────────────────
  {
    titleFn: (t) => `Delve Deep${t > 1 ? 'er' : ''}`,
    descFn: (t) => `Reach floor ${3 + t * 2} of the dungeon.`,
    objectivesFn: (t) => [{ type: 'REACH_FLOOR', targetCount: 3 + t * 2, currentCount: 0, label: `Reach floor ${3 + t * 2}` }],
    rarityFn: (t) => t > 2 ? 'rare' : 'common', goldFn: (t) => 60 + t * 30, xpFn: (t) => 50 + t * 25,
  },
  {
    titleFn: () => 'Into the Abyss',
    descFn: () => 'Reach the deepest known level of the dungeon.',
    objectivesFn: () => [{ type: 'REACH_FLOOR', targetCount: 10, currentCount: 0, label: 'Reach floor 10' }],
    rarityFn: () => 'legendary', goldFn: () => 300, xpFn: () => 200,
  },
  // ── Special room quests ────────────────────────────────────────────────────
  {
    titleFn: () => 'Find the Harem',
    descFn: () => 'Rumors speak of a hidden pleasure chamber deep in the dungeon.',
    objectivesFn: () => [{ type: 'FIND_ROOM', targetKey: 'harem', targetCount: 1, currentCount: 0, label: 'Find the Harem' }],
    rarityFn: () => 'legendary', goldFn: () => 200, xpFn: () => 150,
    specialRoomTag: 'harem', specialRoomLabel: 'The Harem',
  },
  {
    titleFn: () => 'The Lost Library',
    descFn: () => 'An ancient library of forbidden knowledge awaits discovery.',
    objectivesFn: () => [{ type: 'FIND_ROOM', targetKey: 'library', targetCount: 1, currentCount: 0, label: 'Find the Lost Library' }],
    rarityFn: () => 'rare', goldFn: () => 120, xpFn: () => 100,
    specialRoomTag: 'library', specialRoomLabel: 'Lost Library',
  },
  {
    titleFn: () => 'The Arena',
    descFn: () => 'A gladiatorial pit has been carved in the depths. Survive it.',
    objectivesFn: () => [{ type: 'FIND_ROOM', targetKey: 'arena', targetCount: 1, currentCount: 0, label: 'Find the Arena' }],
    rarityFn: () => 'rare', goldFn: () => 150, xpFn: () => 120,
    specialRoomTag: 'arena', specialRoomLabel: 'The Arena',
  },
  {
    titleFn: () => 'Forbidden Shrine',
    descFn: () => 'A shrine of dark healing lies hidden. Find it and claim its blessing.',
    objectivesFn: () => [{ type: 'FIND_ROOM', targetKey: 'shrine', targetCount: 1, currentCount: 0, label: 'Find the Forbidden Shrine' }],
    rarityFn: () => 'rare', goldFn: () => 100, xpFn: () => 80,
    specialRoomTag: 'shrine', specialRoomLabel: 'Forbidden Shrine',
  },
  {
    titleFn: () => "Dragon's Den",
    descFn: () => 'A wyrm has nested in the lower chambers. Find its lair — if you dare.',
    objectivesFn: () => [{ type: 'FIND_ROOM', targetKey: 'dragon_den', targetCount: 1, currentCount: 0, label: "Find the Dragon's Den" }],
    rarityFn: () => 'legendary', goldFn: () => 250, xpFn: () => 180,
    specialRoomTag: 'dragon_den', specialRoomLabel: "Dragon's Den",
  },
];

// ── Seeded RNG ───────────────────────────────────────────────────────────────

function seededRng(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s >>> 0) / 0x7fffffff;
  };
}

// ── Generate quest board ─────────────────────────────────────────────────────

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export function generateQuestBoard(
  level: number,
  floor: number,
  activeQuests: Quest[],
  boardSeed?: number,
  boardGeneratedAt?: number,
): { quests: Quest[]; seed: number; generatedAt: number } {
  const now = Date.now();

  // Determine if we need a fresh board
  let seed = boardSeed ?? (now ^ (level * 137 + floor * 31));
  let generatedAt = boardGeneratedAt ?? now;
  if (boardGeneratedAt && now - boardGeneratedAt > WEEK_MS) {
    seed = now ^ (level * 137 + floor * 31);
    generatedAt = now;
  }

  const rng = seededRng(seed);
  const tier = Math.max(1, Math.floor(level / 3) + 1);

  // Active quest special tags — don't duplicate
  const activeTags = new Set(activeQuests.filter(q => q.specialRoomTag).map(q => q.specialRoomTag));

  // Shuffle templates deterministically
  const shuffled = [...QUEST_TEMPLATES]
    .map((t, i) => ({ t, sort: rng() + i * 0.001 }))
    .sort((a, b) => a.sort - b.sort)
    .map(x => x.t);

  const count = 3 + Math.min(2, Math.floor(rng() * 3)); // 3-5 quests
  const quests: Quest[] = [];

  for (const tmpl of shuffled) {
    if (quests.length >= count) break;
    // Skip if already active with same special tag
    if (tmpl.specialRoomTag && activeTags.has(tmpl.specialRoomTag)) continue;

    const q: Quest = {
      id: `q_${seed}_${quests.length}`,
      title: tmpl.titleFn(tier),
      description: tmpl.descFn(tier),
      objectives: tmpl.objectivesFn(tier).map(o => ({ ...o })),
      rewardGold: tmpl.goldFn(tier),
      rewardXP: tmpl.xpFn(tier),
      rarity: tmpl.rarityFn(tier),
      status: 'available',
      expiresAt: generatedAt + WEEK_MS,
      specialRoomTag: tmpl.specialRoomTag,
      specialRoomLabel: tmpl.specialRoomLabel,
    };
    quests.push(q);
  }

  return { quests, seed, generatedAt };
}

// ── Quest progress hooks ─────────────────────────────────────────────────────

export function onEnemyKilled(quests: Quest[], enemyTypeKey: string): boolean {
  let changed = false;
  for (const q of quests) {
    if (q.status !== 'active') continue;
    for (const obj of q.objectives) {
      if (obj.currentCount >= obj.targetCount) continue;
      if (obj.type === 'KILL_TYPE' && obj.targetKey === enemyTypeKey) {
        obj.currentCount++;
        changed = true;
      } else if (obj.type === 'KILL_TOTAL') {
        obj.currentCount++;
        changed = true;
      }
    }
    if (isQuestComplete(q)) {
      q.status = 'completed';
      q.completedAt = Date.now();
      changed = true;
    }
  }
  return changed;
}

export function onChestOpened(quests: Quest[]): boolean {
  let changed = false;
  for (const q of quests) {
    if (q.status !== 'active') continue;
    for (const obj of q.objectives) {
      if (obj.type === 'OPEN_CHESTS' && obj.currentCount < obj.targetCount) {
        obj.currentCount++;
        changed = true;
      }
    }
    if (isQuestComplete(q)) {
      q.status = 'completed';
      q.completedAt = Date.now();
      changed = true;
    }
  }
  return changed;
}

export function onFloorReached(quests: Quest[], floor: number): boolean {
  let changed = false;
  for (const q of quests) {
    if (q.status !== 'active') continue;
    for (const obj of q.objectives) {
      if (obj.type === 'REACH_FLOOR') {
        obj.currentCount = Math.max(obj.currentCount, floor);
        changed = true;
      }
    }
    if (isQuestComplete(q)) {
      q.status = 'completed';
      q.completedAt = Date.now();
      changed = true;
    }
  }
  return changed;
}

export function onSpecialRoomEntered(quests: Quest[], roomTag: string): boolean {
  let changed = false;
  for (const q of quests) {
    if (q.status !== 'active') continue;
    for (const obj of q.objectives) {
      if (obj.type === 'FIND_ROOM' && obj.targetKey === roomTag && obj.currentCount < obj.targetCount) {
        obj.currentCount = obj.targetCount;
        changed = true;
      }
    }
    if (isQuestComplete(q)) {
      q.status = 'completed';
      q.completedAt = Date.now();
      changed = true;
    }
  }
  return changed;
}

function isQuestComplete(q: Quest): boolean {
  return q.objectives.every(o => o.currentCount >= o.targetCount);
}

// ── Reward application ───────────────────────────────────────────────────────

export function applyQuestReward(
  quest: Quest,
  stats: { gold: number; xp?: number },
  gainXP?: (amount: number) => void,
): void {
  stats.gold += quest.rewardGold;
  if (gainXP) {
    gainXP(quest.rewardXP);
  } else if (stats.xp !== undefined) {
    stats.xp += quest.rewardXP;
  }
}

// ── Active special room tags ─────────────────────────────────────────────────

export function getActiveSpecialRoomTags(quests: Quest[]): string[] {
  return quests
    .filter(q => q.status === 'active' && q.specialRoomTag)
    .map(q => q.specialRoomTag!);
}

// ── Rarity colors ────────────────────────────────────────────────────────────

export const RARITY_COLORS: Record<Quest['rarity'], number> = {
  common: 0xaaaaaa,
  rare: 0x42a5f5,
  legendary: 0xffd700,
};

export const RARITY_LABELS: Record<Quest['rarity'], string> = {
  common: 'COMMON',
  rare: 'RARE',
  legendary: 'LEGENDARY',
};
