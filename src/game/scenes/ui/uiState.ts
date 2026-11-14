/**
 * Shared, Phaser-free UI state. `HUDScene` (a separate Phaser scene drawn over the game) writes it,
 * `InputController` (inside the game scene) reads it. Module level on purpose: both scenes live in one tab.
 */
export interface Rect { x: number; y: number; w: number; h: number }

/** What the pointer is hovering in the world, shown by the HUD at top center. */
export interface HoverInfo { name: string; hp: number; maxHp: number }

/** How long after a panel closes clicks are still swallowed, so the click that closed it does not also walk. */
export const CLOSE_GRACE_MS = 160;

class UiState {
  /** A modal panel (inventory, spellbook, quest log) is open. */
  panelOpen = false;
  /** Keyboard movement keys are captured by an open panel (inventory, spellbook). */
  captureKeys = false;
  private closedAt = -1e9;
  private rects = new Map<string, Rect>();
  hover: HoverInfo | null = null;
  /** A modal owned by another scene (the tavern's shop, inn, notice board) is open: HUD hotkeys stand down. */
  externalModal = false;

  setPanel(open: boolean, captureKeys = open, now = nowMs()): void {
    if (this.panelOpen && !open) this.closedAt = now;
    this.panelOpen = open;
    this.captureKeys = open && captureKeys;
  }

  /** True while a panel is open or has only just closed. */
  isBlocking(now = nowMs()): boolean {
    return this.panelOpen || now - this.closedAt < CLOSE_GRACE_MS;
  }

  setRect(id: string, r: Rect | null): void {
    if (r) this.rects.set(id, r); else this.rects.delete(id);
  }

  /** Is the screen point over a registered HUD rectangle? */
  isOverUi(x: number, y: number): boolean {
    for (const r of this.rects.values()) {
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h) return true;
    }
    return false;
  }

  reset(): void {
    this.panelOpen = false;
    this.captureKeys = false;
    this.closedAt = -1e9;
    this.rects.clear();
    this.hover = null;
    this.externalModal = false;
  }
}

function nowMs(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export const uiState = new UiState();
