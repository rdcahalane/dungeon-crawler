/** What the tavern's shop and inn panels need from `TavernScene`. Phaser-free. */
import type { Player } from "../../entities/Player";
import type { ShopEntry } from "../../items";

export interface TavernHost {
  player: Player;
  /** Tonight's stock (built once per visit, so buying runs it down). */
  stock(): ShopEntry[];
  /** Push the changed numbers to the HUD. */
  refresh(): void;
  say(msg: string): void;
}
