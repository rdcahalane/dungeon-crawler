/**
 * Balance report: clear rates by class, floor and gear tier, plus the Hollow King fight.
 *
 *   npx jiti scripts/sim-balance.ts                 full report, writes docs/balance-report.md (a few minutes)
 *   npx jiti scripts/sim-balance.ts --runs 100      fewer runs per cell
 *   npx jiti scripts/sim-balance.ts --compare NAME  found-gear clear-4 and boss before/after a proposal (src/game/sim/proposals.ts)
 *   flags: --seed N --classes fighter,cleric --floors 3-12 --no-write --no-boss
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { MONSTERS, type MonsterKey } from '../src/game/rules';
import { runBoss, runSampleBoss, type BossStats } from '../src/game/sim/boss';
import { runDelve, type DelveStats } from '../src/game/sim/delve';
import { CLASSES, GEAR_TIERS, type GearTier } from '../src/game/sim/loadout';
import { PROPOSALS } from '../src/game/sim/proposals';
import type { ClassKey } from '../src/game/constants';
import type { SimOverrides } from '../src/game/sim/overrides';

const args = process.argv.slice(2);
const flag = (n: string): string | undefined => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };
const has = (n: string): boolean => args.includes(`--${n}`);
const runs = Number(flag('runs') ?? 400);
const seed = Number(flag('seed') ?? 1);
const classes = (flag('classes')?.split(',') ?? [...CLASSES]) as ClassKey[];
const [f0, f1] = (flag('floors') ?? '1-12').split('-').map(Number);
const floors = Array.from({ length: (f1 ?? f0) - f0 + 1 }, (_, i) => f0 + i);
const pct = (x: number): string => `${Math.round(x * 100)}`;
const name = (k: MonsterKey): string => MONSTERS[k].name;
const BANDS: Record<ClassKey, [number, number]> = { fighter: [0.7, 0.9], cleric: [0.7, 0.9], thief: [0.55, 0.8], wizard: [0.55, 0.8] };

function floorTable(cls: ClassKey, data: Map<string, DelveStats>): string[] {
  const out = [`### ${cls}`, '', '| Floor (level) | starter c4 / c8 / top | found c4 / c8 / top | good c4 / c8 / top | found AC, to-hit, avg dmg, HP, potions |', '|---|---|---|---|---|'];
  for (const f of floors) {
    const cells = GEAR_TIERS.map((t) => {
      const s = data.get(`${cls}|${f}|${t}`)!;
      const top = s.top[0] ? `${name(s.top[0].key)} ${pct(s.top[0].share)}%` : '-';
      return `${pct(s.clear4)} / ${pct(s.clear8)} / ${top}${s.stuck > 0.05 ? ` (stuck ${pct(s.stuck)}%)` : ''}`;
    });
    const L = data.get(`${cls}|${f}|found`)!.loadout;
    out.push(`| ${f} (${f}) | ${cells.join(' | ')} | ${L.ac}, +${L.toHit}, ${L.avgDamage.toFixed(1)}, ${L.maxHp}, ${L.potions} |`);
  }
  return out;
}

function run(overrides?: SimOverrides, tiers: readonly GearTier[] = GEAR_TIERS): Map<string, DelveStats> {
  const data = new Map<string, DelveStats>();
  for (const c of classes) for (const f of floors) for (const t of tiers) {
    data.set(`${c}|${f}|${t}`, runDelve({ classKey: c, floor: f, tier: t, runs, seed, overrides }));
  }
  return data;
}

function bossRows(overrides?: SimOverrides, levels = [10, 11, 12]): BossStats[] {
  const rows: BossStats[] = [];
  for (const c of CLASSES) for (const level of levels) for (const tier of ['found', 'good'] as const) for (const hireling of [false, true]) {
    rows.push(runBoss({ classKey: c, level, tier, hireling, runs, seed, overrides }));
  }
  return rows;
}

function bossTable(rows: BossStats[]): string[] {
  const out = ['| Class | Level | Gear | Hireling | Win % | Died % | Stuck % | Median s | Potions |', '|---|---|---|---|---|---|---|---|---|'];
  for (const r of rows) out.push(`| ${r.classKey} | ${r.level} | ${r.tier} | ${r.hireling ? 'yes' : 'no'} | ${pct(r.win)} | ${pct(r.died)} | ${pct(r.stuck)} | ${r.medianSec.toFixed(1)} | ${r.potionsMean.toFixed(1)} |`);
  return out;
}

if (has('compare')) {
  const key = flag('compare')!;
  const p = PROPOSALS[key];
  if (!p) { console.error(`No proposal "${key}". Known: ${Object.keys(PROPOSALS).join(', ') || '(none)'}`); process.exit(1); }
  const before = run(undefined, ['found']);
  const after = run(p, ['found']);
  console.log(`found-gear clear-4 %, before -> after (${key}), ${runs} runs`);
  for (const c of classes) console.log(c.padEnd(8), floors.map((f) => `${f}:${pct(before.get(`${c}|${f}|found`)!.clear4)}>${pct(after.get(`${c}|${f}|found`)!.clear4)}`).join('  '));
  if (!has('no-boss')) {
    const b = bossRows(undefined, [11]).filter((r) => !r.hireling);
    const a = bossRows(p, [11]).filter((r) => !r.hireling);
    console.log('boss, level 11, no hireling, win % before -> after');
    b.forEach((r, i) => console.log(`${r.classKey} ${r.tier}: ${pct(r.win)} > ${pct(a[i].win)}  median ${r.medianSec.toFixed(1)}s > ${a[i].medianSec.toFixed(1)}s`));
  }
  process.exit(0);
}

const started = Date.now();
const data = run();
const lines: string[] = [];
const date = new Date().toISOString().slice(0, 10);
let hash = 'unknown';
try { hash = execSync('git rev-parse --short HEAD', { cwd: resolve(__dirname, '..') }).toString().trim(); } catch { /* not a git checkout */ }

lines.push('# Balance report', '', `Generated ${date} at commit ${hash}; ${runs} seeded runs per cell, seed ${seed}. Regenerate with \`npm run sim\`.`, '',
  'Each cell: probability of clearing 4 encounters in a row / 8 in a row (no rest, potions and class healing only), then the monster that dealt the most damage. Character level equals the floor number. Encounters are drawn the way the generator fills rooms. "stuck" is the share of runs that ended because nothing left could be hurt (a monster that needs a magic weapon), counted as a failure to clear.', '');
for (const c of classes) lines.push(...floorTable(c, data), '');

// Outliers
lines.push('## Outliers', '');
const dom: string[] = [];
for (const f of floors) {
  const tot: Partial<Record<MonsterKey, number>> = {};
  let sum = 0;
  for (const c of classes) for (const [k, v] of Object.entries(data.get(`${c}|${f}|found`)!.damageBy)) { tot[k as MonsterKey] = (tot[k as MonsterKey] ?? 0) + (v ?? 0); sum += v ?? 0; }
  for (const [k, v] of Object.entries(tot)) if (sum > 0 && (v ?? 0) / sum > 0.4) dom.push(`- Floor ${f}: ${name(k as MonsterKey)} deals ${pct((v ?? 0) / sum)}% of all damage to found-gear characters.`);
}
lines.push('Monsters above 40% of damage dealt on a floor (found gear, all classes pooled):', '', ...(dom.length ? dom : ['- none']), '');
const bad: string[] = [];
for (const c of classes) for (const f of floors) {
  const s = data.get(`${c}|${f}|found`)!;
  if (s.clear4 < 0.6) bad.push(`- ${c}, floor ${f}: clear-4 ${pct(s.clear4)}% (below 60)`);
  if (s.clear4 > 0.97) bad.push(`- ${c}, floor ${f}: clear-4 ${pct(s.clear4)}% (above 97)`);
}
lines.push('Floors where found-gear clear-4 is below 60% or above 97%:', '', ...(bad.length ? bad : ['- none']), '');
lines.push(`Target bands for found-gear clear-4 on floors 3 to 12: ${CLASSES.map((c) => `${c} ${pct(BANDS[c][0])}-${pct(BANDS[c][1])}%`).join(', ')}.`, '');

if (!has('no-boss')) {
  lines.push('## The Hollow King', '', 'The king alone in his chamber (tomb.ts puts no guards there): 12d8 hit points, AC 0, crown touch 1d10+2 every 1.4 s with a death save against paralysis, a spell every 5 s (magic missile, hold person, fireball), a skeleton summoned every 12 s up to four alive, ghouls at 66% and a wraith at 33%. The paralysis immunity window (no new hold while held or for 6 s after) is on. Median seconds is over all runs.', '');
  const s1 = runSampleBoss(runs, undefined, seed);
  const s0 = runSampleBoss(runs, { holdImmunity: false }, seed);
  lines.push(`Check against the browser play (level 10 fighter, +2 long sword, AC 5, 52 HP, three potions): wins ${pct(s0.win)}% without the immunity window (median ${s0.medianSec.toFixed(0)} s), ${pct(s1.win)}% with it (median ${s1.medianSec.toFixed(0)} s).`, '');
  lines.push(...bossTable(bossRows()), '');
}

lines.push(`<!-- generated in ${Math.round((Date.now() - started) / 1000)} s -->`);
let body = lines.join('\n');
const path = resolve(__dirname, '../docs/balance-report.md');
if (existsSync(path)) {
  const old = readFileSync(path, 'utf8');
  const i = old.indexOf('\n## Proposed changes');
  if (i >= 0) body += `\n${old.slice(i)}`;
}
console.log(body);
if (!has('no-write')) { writeFileSync(path, body.endsWith('\n') ? body : `${body}\n`); console.error(`wrote ${path}`); }
