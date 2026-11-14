/**
 * Restrained retro "juice" driven by the GameScene event bus: a short
 * hit-stop on player hits, camera shake when hurt, a flat square-particle
 * burst when an enemy dies and a white flash on level-up. Nothing here edits
 * the controllers; it only listens.
 */
import * as Phaser from "phaser";
import { onGameBus, type BusHost } from "../../gfx/busAttach";
import { paletteHex } from "../../gfx/palette";
import type { GameEventBus } from "../../GameEvents";

export const HIT_STOP_MS = 40;
export const CRIT_STOP_MS = 90;
export const BURST_MIN = 6;
export const BURST_MAX = 10;
/** Palette characters used for death bursts (red, orange, bone, blood). */
const BURST_COLORS = ["8", "9", "v", "7"];

/** Shake strength for `damage` points of damage: gentle, capped. */
export function shakeIntensity(damage: number): number {
  const d = Number.isFinite(damage) ? Math.max(0, damage) : 0;
  return Math.min(0.012, 0.002 + d * 0.0006);
}

/** Particle count for a burst, always within BURST_MIN..BURST_MAX. */
export function burstCount(rand: () => number = Math.random): number {
  return BURST_MIN + Math.floor(rand() * (BURST_MAX - BURST_MIN + 1));
}

function usable(scene: Phaser.Scene): boolean {
  return scene.sys.isActive() && !!scene.cameras?.main;
}

let stopping = false;

function hitStop(scene: Phaser.Scene, ms: number): void {
  const world = scene.physics?.world;
  if (!world || stopping || world.isPaused || !usable(scene)) return;
  stopping = true;
  world.pause();
  // Real time on purpose: the scene clock must not decide how long the freeze lasts.
  setTimeout(() => {
    stopping = false;
    try {
      if (scene.sys.isActive() || scene.sys.isPaused()) world.resume();
    } catch {
      /* the scene was torn down during the freeze */
    }
  }, ms);
}

function burst(scene: Phaser.Scene, x: number, y: number): void {
  if (!usable(scene)) return;
  const n = burstCount();
  for (let i = 0; i < n; i++) {
    const color = paletteHex(BURST_COLORS[i % BURST_COLORS.length]) ?? 0xd8382c;
    const size = i % 3 === 0 ? 6 : 4;
    const sq = scene.add.rectangle(Math.round(x), Math.round(y), size, size, color).setDepth(950);
    const ang = (Math.PI * 2 * i) / n + Math.random() * 0.6;
    const dist = 18 + Math.random() * 22;
    scene.tweens.add({
      targets: sq,
      x: Math.round(x + Math.cos(ang) * dist),
      y: Math.round(y + Math.sin(ang) * dist),
      alpha: 0,
      duration: 260 + Math.random() * 140,
      ease: "Quad.easeOut",
      onComplete: () => sq.destroy(),
    });
  }
}

function subscribe(host: BusHost, bus: GameEventBus): void {
  bus.on("player_hit", (p) => hitStop(host, p?.crit ? CRIT_STOP_MS : HIT_STOP_MS));
  bus.on("player_hurt", (p) => {
    if (usable(host)) host.cameras.main.shake(120, shakeIntensity(p?.damage ?? 0));
  });
  bus.on("enemy_death", (p) => {
    if (p) burst(host, p.x, p.y);
  });
  bus.on("level_up", () => {
    if (usable(host)) host.cameras.main.flash(140, 255, 255, 255);
  });
}

const attached = new WeakSet<Phaser.Game>();

/** Wire the juice into the game. Safe to call more than once. */
export function attachJuice(game: Phaser.Game): void {
  if (attached.has(game)) return;
  attached.add(game);
  onGameBus(game, subscribe);
}
