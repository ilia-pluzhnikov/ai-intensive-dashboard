"""Cut the Blood Dragon sprite into cutout-rig layers for the dashboard.

Reads  tools/dragon/source.png
Writes assets/dragon/*.webp  — one full-canvas layer per part
       css/dragon-rig.css     — layer urls, pivots, eye box (generated)

    python tools/dragon/cut.py           # build
    python tools/dragon/cut.py --check   # rest pose must reproduce the source
"""
import colorsys
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SRC = ROOT / "tools" / "dragon" / "source.png"
OUT_DIR = ROOT / "assets" / "dragon"
CSS_OUT = ROOT / "css" / "dragon-rig.css"

# Crop in source px: the silhouette (40..880 x 232..784) plus room for poses
BOX = (20, 180, 910, 815)
EXPORT_SCALE = 0.5    # layer files: 2x of the on-site size (retina)
DISPLAY_SCALE = 0.25  # on-site: silhouette ~138 px tall (was ~86 px)

# Moving parts. "own" is cut out of the parent layer; "layer" is what the part
# carries — own plus an overlap that tucks under the parent at the joint, so a
# rotated part never opens a gap. Pivots are joints, in source px.
HEAD_OWN = [(640, 230), (720, 240), (800, 268), (875, 292), (890, 340), (885, 400),
            (840, 420), (760, 440), (690, 465), (650, 480)]
HEAD_LAYER = [(600, 230)] + HEAD_OWN[1:] + [(615, 490)]
HEAD_PIVOT = (625, 420)

JAW_OWN = [(655, 372), (700, 384), (880, 384), (885, 400), (840, 420), (760, 440), (690, 462)]
JAW_PIVOT = (660, 375)

TAIL_OWN = [(20, 620), (160, 580), (235, 540), (250, 600), (215, 690), (190, 760), (20, 790)]
TAIL_LAYER = [(20, 620), (160, 580), (250, 520), (285, 600), (240, 700), (205, 770), (20, 790)]
TAIL_PIVOT = (255, 610)

HAND_OWN = [(625, 545), (700, 560), (705, 640), (630, 640), (615, 590)]
HAND_LAYER = [(600, 540), (700, 560), (705, 640), (630, 640), (600, 600)]
HAND_PIVOT = (615, 565)

BODY_PIVOT = (470, 784)  # feet: breathing scales up from the ground

# Inside of the mouth and the lower teeth — revealed only when the jaw opens
MOUTH = [(650, 372), (700, 382), (870, 382), (860, 400), (760, 425), (690, 450)]
THROAT = (670, 380, 740, 420)
LOWER_TEETH_X = range(714, 862, 22)  # left edges; the upper row hides them at rest
LOWER_TEETH_Y = (370, 384)

EYE = (707, 327)  # centre of the glowing eye
EYE_SIZE = (44, 32)
EYELID_SAMPLE = (685, 296, 735, 306)  # plain head scales above the eye

PIXEL = 8  # source px per art pixel: procedural art sits on the sprite's grid
TOOTH_CORE = (255, 236, 248, 255)
TOOTH_EDGE = (255, 64, 160, 255)
MOUTH_DARK = (48, 6, 30, 255)
MOUTH_MID = (140, 10, 70, 255)
MOUTH_HOT = (255, 42, 109, 255)


def poly_mask(size, poly):
    mask = Image.new("L", size, 0)
    ImageDraw.Draw(mask).polygon(poly, fill=255)
    return mask


def take(img, poly):
    """img inside poly, transparent elsewhere."""
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel("A"), poly_mask(img.size, poly)))
    return out


def erase(img, poly):
    """img with poly cut out."""
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel("A"), ImageChops.invert(poly_mask(img.size, poly))))
    return out


def clip_to(img, src):
    """Keep img only where the source sprite is opaque — so it hides at rest."""
    out = img.copy()
    out.putalpha(ImageChops.multiply(img.getchannel("A"), src.getchannel("A")))
    return out


def neon(img):
    """Only the bright saturated pixels: spikes, neon lines, eye glow."""
    out = img.copy()
    px = out.load()
    for y in range(out.height):
        for x in range(out.width):
            r, g, b, a = px[x, y]
            if a:
                _, s, v = colorsys.rgb_to_hsv(r / 255, g / 255, b / 255)
                if s < 0.45 or v < 0.7:
                    px[x, y] = (0, 0, 0, 0)
    return out


def on_grid(points):
    return [(x / PIXEL, y / PIXEL) for x, y in points]


def draw_mouth(src):
    """Inside of the mouth, drawn on the sprite's own pixel grid."""
    art = Image.new("RGBA", (src.width // PIXEL, src.height // PIXEL), (0, 0, 0, 0))
    d = ImageDraw.Draw(art)
    d.polygon(on_grid(MOUTH), fill=MOUTH_DARK)
    x0, y0, x1, y1 = THROAT
    d.ellipse(on_grid([(x0 - 16, y0 - 8), (x1 + 16, y1 + 8)]), fill=MOUTH_MID)
    d.ellipse(on_grid([(x0, y0), (x1, y1)]), fill=MOUTH_HOT)
    art = art.resize(src.size, Image.NEAREST)
    return clip_to(take(art, MOUTH), src)


def draw_lower_teeth(src):
    teeth = Image.new("RGBA", src.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(teeth)
    y0, y1 = LOWER_TEETH_Y
    for x in LOWER_TEETH_X:
        d.rectangle((x, y0, x + PIXEL, y1), fill=TOOTH_CORE)
        d.rectangle((x, y1 - 4, x + PIXEL, y1), fill=TOOTH_EDGE)
    return clip_to(teeth, src)


def build(src):
    jaw = take(src, JAW_OWN)
    jaw.alpha_composite(draw_lower_teeth(src))
    layers = {  # paint order = DOM order in js/dragon.js buildRig()
        "tail": take(src, TAIL_LAYER),
        "body": erase(erase(erase(src, HEAD_OWN), TAIL_OWN), HAND_OWN),
        "mouth": draw_mouth(src),
        "jaw": jaw,
        "head": erase(take(src, HEAD_LAYER), JAW_OWN),
        "hand": take(src, HAND_LAYER),
    }
    glows = {  # from "own" regions only, so overlaps don't glow twice
        "tail-glow": neon(take(src, TAIL_OWN)),
        "body-glow": neon(layers["body"]),
        "head-glow": neon(erase(take(src, HEAD_OWN), JAW_OWN)),
    }
    return layers, glows


def check(layers, src):
    """Layers stacked at rest must look like the source sprite."""
    rest = Image.new("RGBA", src.size, (0, 0, 0, 0))
    for img in layers.values():
        rest.alpha_composite(img)
    # premultiplied, so fully transparent pixels compare equal whatever their RGB
    diff = ImageChops.difference(rest.convert("RGBa"), src.convert("RGBa"))
    bad = sum(1 for p in diff.getdata() if max(p) > 24)
    solid = sum(1 for a in src.getchannel("A").getdata() if a)
    share = bad / solid
    print(f"rest pose vs source: {bad} px differ ({share:.3%} of the silhouette)")
    return share < 0.005


def export(img, name):
    crop = img.crop(BOX)
    size = (round(crop.width * EXPORT_SCALE), round(crop.height * EXPORT_SCALE))
    crop.resize(size, Image.LANCZOS).save(OUT_DIR / f"{name}.webp", "WEBP", quality=90, method=6)


def average_color(img, box):
    pixels = list(img.crop(box).convert("RGB").getdata())
    r, g, b = (sum(p[i] for p in pixels) // len(pixels) for i in range(3))
    return f"#{r:02x}{g:02x}{b:02x}"


def pct(x, y):
    bx0, by0, bx1, by1 = BOX
    return f"{(x - bx0) / (bx1 - bx0) * 100:.2f}% {(y - by0) / (by1 - by0) * 100:.2f}%"


def write_css(eyelid):
    bx0, by0, bx1, by1 = BOX
    w, h = bx1 - bx0, by1 - by0
    ex, ey = EYE
    ew, eh = EYE_SIZE

    def url(name):
        return f'url("../assets/dragon/{name}.webp")'

    lines = [
        "/* Generated by tools/dragon/cut.py — do not edit by hand. */",
        ":root {",
        f"  --rig-w: {w * DISPLAY_SCALE:.1f}px;",
        f"  --rig-h: {h * DISPLAY_SCALE:.1f}px;",
        f"  --dragon-reach: {(ex - bx0) * DISPLAY_SCALE:.0f}px; /* rig's left edge -> eye */",
        "}",
        f".dragon-rig .part.tail {{ background-image: {url('tail')}; transform-origin: {pct(*TAIL_PIVOT)}; }}",
        f".dragon-rig .part.tail > .glow {{ background-image: {url('tail-glow')}; }}",
        f".dragon-rig .part.body {{ background-image: {url('body')}; transform-origin: {pct(*BODY_PIVOT)}; }}",
        f".dragon-rig .part.body > .glow {{ background-image: {url('body-glow')}; }}",
        f".dragon-rig .head-aim, .dragon-rig .head-idle {{ transform-origin: {pct(*HEAD_PIVOT)}; }}",
        f".dragon-rig .part.mouth {{ background-image: {url('mouth')}; }}",
        f".dragon-rig .part.jaw {{ background-image: {url('jaw')}; transform-origin: {pct(*JAW_PIVOT)}; }}",
        f".dragon-rig .part.head {{ background-image: {url('head')}; }}",
        f".dragon-rig .part.head > .glow {{ background-image: {url('head-glow')}; }}",
        f".dragon-rig .part.hand {{ background-image: {url('hand')}; transform-origin: {pct(*HAND_PIVOT)}; }}",
        f".dragon-rig .eye {{ left: {(ex - ew / 2 - bx0) / w * 100:.2f}%; top: {(ey - eh / 2 - by0) / h * 100:.2f}%; "
        f"width: {ew / w * 100:.2f}%; height: {eh / h * 100:.2f}%; }}",
        f".dragon-rig .eyelid {{ background: {eyelid}; }}",
    ]
    CSS_OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    src = Image.open(SRC).convert("RGBA")
    layers, glows = build(src)
    if "--check" in sys.argv:
        sys.exit(0 if check(layers, src) else 1)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, img in {**layers, **glows}.items():
        export(img, name)
    write_css(average_color(src, EYELID_SAMPLE))
    total = sum(p.stat().st_size for p in OUT_DIR.glob("*.webp"))
    print(f"wrote {len(layers) + len(glows)} layers ({total / 1024:.0f} KB) and {CSS_OUT.name}")


if __name__ == "__main__":
    main()
