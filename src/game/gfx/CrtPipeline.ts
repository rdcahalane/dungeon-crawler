/**
 * CRT post effect: scanlines, vignette, slight barrel distortion and mild
 * horizontal colour bleed. WebGL only; every helper no-ops on Canvas.
 */
import * as Phaser from "phaser";

export const CRT_KEY = "CrtPipeline";

const FRAG = `
#define SHADER_NAME CRT_FS
precision mediump float;
uniform sampler2D uMainSampler;
uniform vec2 resolution;
uniform float intensity;
varying vec2 outTexCoord;

vec2 barrel(vec2 uv, float k) {
  vec2 c = uv * 2.0 - 1.0;
  float r2 = dot(c, c);
  c *= (1.0 + k * r2) / (1.0 + k);
  return c * 0.5 + 0.5;
}

void main() {
  float k = 0.05 * intensity;
  vec2 uv = barrel(outTexCoord, k);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 px = vec2(1.0 / resolution.x, 0.0);
  vec4 centre4 = texture2D(uMainSampler, uv);
  vec3 centre = centre4.rgb;
  vec3 left = texture2D(uMainSampler, uv - px * 1.5).rgb;
  vec3 right = texture2D(uMainSampler, uv + px * 1.5).rgb;
  // mild colour bleed: red leans left, blue leans right, then a soft horizontal blend
  vec3 bleed = vec3(left.r, centre.g, right.b);
  vec3 col = mix(centre, bleed, 0.55 * intensity);
  col = mix(col, (left + centre * 2.0 + right) * 0.25, 0.25 * intensity);
  // scanlines: one dark line every two rows
  float s = 0.5 + 0.5 * sin(uv.y * resolution.y * 3.14159265);
  col *= 1.0 - 0.3 * intensity * (1.0 - s);
  // vignette
  float d = length((outTexCoord - 0.5) * vec2(1.0, 0.85));
  col *= 1.0 - 0.65 * intensity * smoothstep(0.32, 0.85, d);
  // keep brightness roughly level after the scanline dimming
  col *= 1.0 + 0.1 * intensity;
  // keep the source alpha so overlay scenes (the HUD) stay see-through; colour is premultiplied
  col = min(col, vec3(centre4.a));
  gl_FragColor = vec4(col, centre4.a);
}
`;

export class CrtPipeline extends Phaser.Renderer.WebGL.Pipelines.PostFXPipeline {
  /** 0 = off, 1 = full. */
  intensity = 1;

  constructor(game: Phaser.Game) {
    super({ game, renderTarget: true, fragShader: FRAG });
  }

  onPreRender(): void {
    this.set1f("intensity", this.intensity);
    this.set2f("resolution", this.renderer.width, this.renderer.height);
  }
}

function webglRenderer(scene: Phaser.Scene): Phaser.Renderer.WebGL.WebGLRenderer | null {
  const game = scene.game;
  if (!game || game.renderer?.type !== Phaser.WEBGL) return null;
  return game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
}

/** Register the CRT post pipeline with the game's renderer (WebGL only). Returns false on Canvas. */
export function registerCrtPipeline(game: Phaser.Game): boolean {
  if (game.renderer?.type !== Phaser.WEBGL) return false;
  const renderer = game.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
  if (!renderer.pipelines) return false;
  renderer.pipelines.addPostPipeline(CRT_KEY, CrtPipeline);
  return true;
}

/** True when the CRT is applied to the scene's main camera. */
export function isCrtEnabled(scene: Phaser.Scene): boolean {
  try {
    const found = scene.cameras.main.getPostPipeline(CRT_KEY);
    return Array.isArray(found) ? found.length > 0 : !!found;
  } catch {
    return false;
  }
}

/** Apply the CRT to the scene's main camera. Returns false (no-op) on Canvas. */
export function enableCrt(scene: Phaser.Scene, intensity = 1): boolean {
  try {
    const renderer = webglRenderer(scene);
    if (!renderer?.pipelines) return false;
    renderer.pipelines.addPostPipeline(CRT_KEY, CrtPipeline);
    const cam = scene.cameras.main;
    if (!isCrtEnabled(scene)) cam.setPostPipeline(CRT_KEY);
    const found = cam.getPostPipeline(CRT_KEY);
    const list = Array.isArray(found) ? found : [found];
    for (const p of list) if (p instanceof CrtPipeline) p.intensity = intensity;
    return true;
  } catch {
    return false;
  }
}

/** Remove the CRT from the scene's main camera. */
export function disableCrt(scene: Phaser.Scene): void {
  try {
    scene.cameras.main.removePostPipeline(CRT_KEY);
  } catch {
    /* nothing to remove */
  }
}

/** Toggle the CRT. Returns the new state (always false on Canvas). */
export function toggleCrt(scene: Phaser.Scene, intensity = 1): boolean {
  if (!webglRenderer(scene)) return false;
  if (isCrtEnabled(scene)) {
    disableCrt(scene);
    return false;
  }
  return enableCrt(scene, intensity);
}
