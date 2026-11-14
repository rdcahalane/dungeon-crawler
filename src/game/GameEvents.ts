/**
 * Typed gameplay event bus. Pure TS (no Phaser import) so it is unit-testable and any lane can use it.
 *
 * The controllers under `scenes/game/` emit these at the moments the game already had; nothing here plays
 * a sound or draws anything. HUD, audio and juice lanes subscribe.
 *
 * Lifetime: one bus per `GameScene` instance, created in its constructor and NOT cleared when the scene
 * restarts for a new floor (same as `scene.events`). Anything that subscribes must unsubscribe, either with
 * the function `on()` returns or by using `bus.scope()` and calling `dispose()` on shutdown. Controllers
 * get `destroy()` called on scene shutdown and are the natural place to dispose a scope.
 *
 * Reach it from a scene via `GameScene.gameEvents`, from a controller via `ctx.bus`.
 */

/** Event name to payload. `undefined` means the event carries no data. */
export interface GameEventMap {
  player_swing: undefined;
  /** `crit` is true for a thief sneak attack (the only multiplier the current combat has). */
  player_hit: { enemyKey: string; damage: number; crit: boolean };
  player_miss: undefined;
  player_hurt: { damage: number };
  player_death: undefined;
  enemy_death: { enemyKey: string; x: number; y: number };
  /** A floor item or chest loot item was picked up. `type` is the legacy item type string. */
  item_pickup: { type: string };
  gold: { amount: number };
  chest_open: undefined;
  door_secret_found: undefined;
  trap_triggered: { type: string };
  spell_cast: { key: string };
  spell_fizzle: undefined;
  heal: { amount: number };
  level_up: { level: number };
  floor_enter: { floor: number; theme: number };
  floor_exit: undefined;
  rest: undefined;
  ui_open: { panel: string };
  ui_close: { panel: string };
  status: { text: string };
  /** Optional additions (mechanism lane). Not part of GAME_EVENT_NAMES, which lists the original contract. */
  /** Another lane emits this when the player drops an item on a tile; the mechanism engine treats it as an item step. */
  item_dropped: { itemId: string; defKey: string; tx: number; ty: number };
  /** Another lane emits this when an item is picked up from a tile; the mechanism engine treats it as a leave. */
  item_picked: { defKey: string; tx: number; ty: number };
  /** A tomb mechanism asks for a named sound effect (`lever`, `trap`, `portcullis_up`...). The audio lane maps keys. */
  mech_sfx: { key: string };
}

export type GameEventName = keyof GameEventMap;

export const GAME_EVENT_NAMES: readonly GameEventName[] = [
  'player_swing', 'player_hit', 'player_miss', 'player_hurt', 'player_death', 'enemy_death',
  'item_pickup', 'gold', 'chest_open', 'door_secret_found', 'trap_triggered', 'spell_cast', 'spell_fizzle',
  'heal', 'level_up', 'floor_enter', 'floor_exit', 'rest', 'ui_open', 'ui_close', 'status',
];

export type GameEventHandler<K extends GameEventName> = (payload: GameEventMap[K]) => void;

/** Arguments of `emit` : the payload is omitted for events whose payload is `undefined`. */
type EmitArgs<K extends GameEventName> = GameEventMap[K] extends undefined ? [] : [payload: GameEventMap[K]];

export type Unsubscribe = () => void;

export class GameEventBus {
  private handlers = new Map<GameEventName, Set<(payload: never) => void>>();

  on<K extends GameEventName>(name: K, handler: GameEventHandler<K>): Unsubscribe {
    let set = this.handlers.get(name);
    if (!set) { set = new Set(); this.handlers.set(name, set); }
    set.add(handler as (payload: never) => void);
    return () => this.off(name, handler);
  }

  once<K extends GameEventName>(name: K, handler: GameEventHandler<K>): Unsubscribe {
    const off = this.on(name, ((payload: GameEventMap[K]) => { off(); handler(payload); }) as GameEventHandler<K>);
    return off;
  }

  off<K extends GameEventName>(name: K, handler: GameEventHandler<K>): void {
    this.handlers.get(name)?.delete(handler as (payload: never) => void);
  }

  emit<K extends GameEventName>(name: K, ...args: EmitArgs<K>): void {
    const set = this.handlers.get(name);
    if (!set || set.size === 0) return;
    // Copy so a handler may unsubscribe (or subscribe) while we iterate.
    for (const h of [...set]) {
      try {
        (h as (payload: unknown) => void)(args[0]);
      } catch (err) {
        // A broken subscriber must never break gameplay.
        if (typeof console !== 'undefined') console.error(`[GameEvents] handler for "${name}" threw`, err);
      }
    }
  }

  listenerCount(name?: GameEventName): number {
    if (name) return this.handlers.get(name)?.size ?? 0;
    let n = 0;
    for (const s of this.handlers.values()) n += s.size;
    return n;
  }

  /** Remove every listener. Rarely needed; prefer scopes. */
  clear(): void {
    this.handlers.clear();
  }

  /** A group of subscriptions that can be removed together. */
  scope(): GameEventScope {
    return new GameEventScope(this);
  }
}

export class GameEventScope {
  private offs: Unsubscribe[] = [];
  constructor(private bus: GameEventBus) {}

  on<K extends GameEventName>(name: K, handler: GameEventHandler<K>): this {
    this.offs.push(this.bus.on(name, handler));
    return this;
  }

  dispose(): void {
    for (const off of this.offs) off();
    this.offs = [];
  }
}
