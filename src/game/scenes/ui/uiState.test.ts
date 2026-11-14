import { describe, it, expect, beforeEach } from "vitest";
import { uiState, CLOSE_GRACE_MS } from "./uiState";

describe("uiState", () => {
  beforeEach(() => uiState.reset());

  it("blocks while a panel is open and for a moment after it closes", () => {
    expect(uiState.isBlocking(0)).toBe(false);
    uiState.setPanel(true, true, 1000);
    expect(uiState.isBlocking(1001)).toBe(true);
    expect(uiState.captureKeys).toBe(true);
    uiState.setPanel(false, true, 2000);
    expect(uiState.captureKeys).toBe(false);
    expect(uiState.isBlocking(2000 + CLOSE_GRACE_MS - 1)).toBe(true);
    expect(uiState.isBlocking(2000 + CLOSE_GRACE_MS + 1)).toBe(false);
  });

  it("does not capture the keyboard for the quest log", () => {
    uiState.setPanel(true, false, 0);
    expect(uiState.isBlocking(1)).toBe(true);
    expect(uiState.captureKeys).toBe(false);
  });

  it("hit-tests registered HUD rectangles", () => {
    uiState.setRect("a", { x: 10, y: 10, w: 20, h: 20 });
    expect(uiState.isOverUi(10, 10)).toBe(true);
    expect(uiState.isOverUi(29, 29)).toBe(true);
    expect(uiState.isOverUi(30, 30)).toBe(false);
    uiState.setRect("a", null);
    expect(uiState.isOverUi(15, 15)).toBe(false);
  });
});
