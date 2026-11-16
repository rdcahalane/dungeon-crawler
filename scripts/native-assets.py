#!/usr/bin/env python3
"""Make the app-store icons and splash screens from public/icon.svg (the game's sword-in-the-doorway mark).

Writes the iOS AppIcon (1024, no alpha), the iOS splash images, the Android launcher icons (legacy, round and
adaptive foreground at every density) and the Android splash drawables. Pixel art, so every resize is
nearest-neighbour. Needs rsvg-convert (Homebrew librsvg) and Pillow. Run: python3 scripts/native-assets.py
"""
import os
import subprocess
import tempfile

from PIL import Image, ImageDraw

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SVG = os.path.join(ROOT, "public", "icon.svg")
BG = (8, 8, 13)  # #08080d, the page background
INK = (18, 16, 26)  # #12101a, the icon's own background

def mark(size: int) -> Image.Image:
    """The 64x64 icon art rendered crisp at `size` px, RGB."""
    with tempfile.TemporaryDirectory() as d:
        small = os.path.join(d, "icon64.png")
        subprocess.run(["rsvg-convert", "-w", "64", "-h", "64", SVG, "-o", small], check=True)
        img = Image.open(small).convert("RGB")
    return img.resize((size, size), Image.NEAREST)

def save(img: Image.Image, *parts: str) -> None:
    path = os.path.join(ROOT, *parts)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    img.save(path)

def splash(w: int, h: int) -> Image.Image:
    """Dark screen with the mark in the middle at a whole-number pixel scale."""
    img = Image.new("RGB", (w, h), BG)
    side = (min(w, h) // 4) // 64 * 64 or 64
    m = mark(side)
    img.paste(m, ((w - side) // 2, (h - side) // 2))
    return img

# iOS
save(mark(1024), "ios", "App", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-512@2x.png")
for name in ("splash-2732x2732.png", "splash-2732x2732-1.png", "splash-2732x2732-2.png"):
    save(splash(2732, 2732), "ios", "App", "App", "Assets.xcassets", "Splash.imageset", name)

# Android launcher icons: legacy 48dp, adaptive foreground 108dp with the art inside the 72dp safe zone.
DENSITY = {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}
res = ("android", "app", "src", "main", "res")
for d, k in DENSITY.items():
    legacy = int(48 * k)
    save(mark(legacy), *res, f"mipmap-{d}", "ic_launcher.png")
    r = mark(legacy).convert("RGBA")
    mask = Image.new("L", (legacy, legacy), 0)
    ImageDraw.Draw(mask).ellipse((0, 0, legacy - 1, legacy - 1), fill=255)
    round_icon = Image.new("RGBA", (legacy, legacy), (0, 0, 0, 0))
    round_icon.paste(r, (0, 0), mask)
    save(round_icon, *res, f"mipmap-{d}", "ic_launcher_round.png")
    fg_side = int(108 * k)
    art = int(66 * k)
    fg = Image.new("RGBA", (fg_side, fg_side), (0, 0, 0, 0))
    fg.paste(mark(art).convert("RGBA"), ((fg_side - art) // 2, (fg_side - art) // 2))
    save(fg, *res, f"mipmap-{d}", "ic_launcher_foreground.png")

with open(os.path.join(ROOT, *res, "values", "ic_launcher_background.xml"), "w") as f:
    f.write('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n'
            '    <color name="ic_launcher_background">#12101A</color>\n</resources>\n')

# Android splash drawables (landscape and portrait sets plus the default).
SPLASH = {"mdpi": (480, 320), "hdpi": (800, 480), "xhdpi": (1280, 720), "xxhdpi": (1600, 960), "xxxhdpi": (1920, 1280)}
for d, (w, h) in SPLASH.items():
    save(splash(w, h), *res, f"drawable-land-{d}", "splash.png")
    save(splash(h, w), *res, f"drawable-port-{d}", "splash.png")
save(splash(480, 320), *res, "drawable", "splash.png")
print("icons and splash screens written")
