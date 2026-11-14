import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Just enough WebAudio to watch the scheduler: counts nodes made and disconnected. */
class FakeParam {
  value = 1;
  setValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number) {
    this.value = v;
    return this;
  }
  cancelScheduledValues() {
    return this;
  }
}
const stats = { made: 0, disconnected: 0, gains: [] as FakeNode[] };
class FakeNode {
  gain = new FakeParam();
  frequency = new FakeParam();
  Q = new FakeParam();
  type = "";
  buffer: unknown = null;
  loop = false;
  onended: (() => void) | null = null;
  constructor() {
    stats.made++;
  }
  connect() {
    return this;
  }
  disconnect() {
    stats.disconnected++;
  }
  start() {}
  stop() {}
}
class FakeCtx {
  state = "running";
  currentTime = 0;
  sampleRate = 1000;
  destination = {};
  createGain() {
    const n = new FakeNode();
    stats.gains.push(n);
    return n;
  }
  createDynamicsCompressor() {
    return new FakeNode();
  }
  createOscillator() {
    return new FakeNode();
  }
  createBufferSource() {
    return new FakeNode();
  }
  createBiquadFilter() {
    return new FakeNode();
  }
  createBuffer(_c: number, len: number) {
    return { getChannelData: () => new Float32Array(len) };
  }
  resume() {
    return Promise.resolve();
  }
}

let ctx: FakeCtx;
const made: { ctx?: FakeCtx } = {};

async function load() {
  vi.resetModules();
  vi.stubGlobal(
    "AudioContext",
    class extends FakeCtx {
      constructor() {
        super();
        made.ctx = this as FakeCtx;
        ctx = made.ctx;
      }
    },
  );
  return (await import("./Sfx")).Sfx;
}

function run(seconds: number) {
  for (let i = 0; i < seconds * 10; i++) {
    ctx.currentTime += 0.1;
    vi.advanceTimersByTime(100);
  }
}

describe("music engine scheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    stats.made = 0;
    stats.disconnected = 0;
    stats.gains = [];
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("starts a bed on unlock, crossfades to the next, and cleans up", async () => {
    const Sfx = await load();
    Sfx.setMusicSeed(11);
    Sfx.music("dungeon");
    expect(Sfx.currentBed()).toBe("dungeon");
    Sfx.unlock();
    run(5);
    const madeAfter5 = stats.made;
    expect(madeAfter5).toBeGreaterThan(10);
    Sfx.music("tavern");
    run(4);
    expect(Sfx.currentBed()).toBe("tavern");
    // the old bed's gain bus is gone once its fade ended
    expect(stats.disconnected).toBeGreaterThan(0);
    // node churn stays modest: well under a few hundred a second
    expect(stats.made / 9).toBeLessThan(150);
  });

  it("brings the combat layer in on a pulse and out a few seconds later", async () => {
    const Sfx = await load();
    Sfx.music("dungeon_mid");
    Sfx.unlock();
    run(2);
    const gainsBefore = stats.gains.length;
    Sfx.combatPulse(2000);
    expect(stats.gains.length).toBeGreaterThan(gainsBefore);
    run(2);
    const discBefore = stats.disconnected;
    run(8);
    // the layer faded out and was disconnected; the floor bed is untouched
    expect(Sfx.currentBed()).toBe("dungeon_mid");
    expect(stats.disconnected).toBeGreaterThan(discBefore);
  });

  it("boss swaps the bed and hands the floor bed back", async () => {
    const Sfx = await load();
    Sfx.music("tomb");
    Sfx.unlock();
    run(1);
    Sfx.boss(true);
    expect(Sfx.currentBed()).toBe("boss");
    Sfx.music("tomb");
    expect(Sfx.currentBed()).toBe("boss");
    Sfx.boss(false);
    expect(Sfx.currentBed()).toBe("tomb");
    Sfx.music(null);
    expect(Sfx.currentBed()).toBeNull();
    run(3);
  });

  it("every bed plays for a minute without throwing", async () => {
    const Sfx = await load();
    Sfx.unlock();
    for (const bed of ["title", "tavern", "dungeon", "dungeon_mid", "dungeon_deep", "tomb", "boss", "combat"] as const) {
      Sfx.music(bed);
      run(8);
    }
    Sfx.music(null);
    run(2);
  });
});
