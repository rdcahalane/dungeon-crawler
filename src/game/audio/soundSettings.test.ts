import { beforeEach, describe, expect, it } from "vitest";
import { Sfx } from "./Sfx";
import {
  MUSIC_STORAGE_KEY, MUTE_STORAGE_KEY, SFX_STORAGE_KEY,
  loadSoundSettings, notifySoundChanged, onSoundChanged, soundLabels, toggleAllSound, toggleMusic, toggleSfx,
} from "./soundSettings";

function memStore(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

describe("sound switches", () => {
  let s: ReturnType<typeof memStore>;
  beforeEach(() => {
    s = memStore();
    loadSoundSettings(s);
  });

  it("defaults to everything on", () => {
    expect(Sfx.isMuted()).toBe(false);
    expect(Sfx.isMusicOn()).toBe(true);
    expect(Sfx.isSfxOn()).toBe(true);
    expect(soundLabels()).toEqual({ all: "ALL SOUND: ON", music: "MUSIC: ON", sfx: "EFFECTS: ON" });
  });

  it("loads saved switches", () => {
    loadSoundSettings(memStore({ [MUTE_STORAGE_KEY]: "0", [MUSIC_STORAGE_KEY]: "0", [SFX_STORAGE_KEY]: "1" }));
    expect(Sfx.isMusicOn()).toBe(false);
    expect(Sfx.isSfxOn()).toBe(true);
  });

  it("music and effects switch on their own and are saved", () => {
    expect(toggleMusic(s)).toBe(false);
    expect(Sfx.isMusicOn()).toBe(false);
    expect(Sfx.isSfxOn()).toBe(true);
    expect(s.m.get(MUSIC_STORAGE_KEY)).toBe("0");
    expect(toggleSfx(s)).toBe(false);
    expect(s.m.get(SFX_STORAGE_KEY)).toBe("0");
    expect(soundLabels()).toEqual({ all: "ALL SOUND: ON", music: "MUSIC: OFF", sfx: "EFFECTS: OFF" });
  });

  it("all sound off shows every part off; turning music on lifts the mute", () => {
    expect(toggleAllSound(s)).toBe(false);
    expect(soundLabels()).toEqual({ all: "ALL SOUND: OFF", music: "MUSIC: OFF", sfx: "EFFECTS: OFF" });
    expect(toggleMusic(s)).toBe(true);
    expect(Sfx.isMuted()).toBe(false);
    expect(s.m.get(MUTE_STORAGE_KEY)).toBe("0");
  });

  it("all sound on with both parts off brings both back", () => {
    toggleMusic(s);
    toggleSfx(s);
    toggleAllSound(s); // off
    toggleAllSound(s); // on
    expect(Sfx.isMusicOn()).toBe(true);
    expect(Sfx.isSfxOn()).toBe(true);
  });

  it("tells listeners", () => {
    const seen: string[] = [];
    const off = onSoundChanged((l) => seen.push(l.music));
    toggleMusic(s);
    notifySoundChanged();
    off();
    notifySoundChanged();
    expect(seen).toEqual(["MUSIC: OFF"]);
  });
});
