# Living Dragon Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Заменить двухкадровую смену картинок на живого cutout-дракона, который дышит, стреляет лазером в ближайшего ученика и разыгрывает забег при открытии страницы.

**Architecture:** Python-скрипт режет существующий спрайт на WebP-слои и генерирует CSS с геометрией рига. Риг — вложенные `div` с CSS-анимациями покоя; лазер и выбор цели — ванильный JS (`js/dragon.js`, Web Animations API); интро — CSS-переходы `left`/`width`, которые запускает `js/dashboard.js`.

**Tech Stack:** Python 3.13 + Pillow 12 (нарезка), ванильные CSS/JS без библиотек, `node --test` (Node 24) для чистых функций, Python Playwright для визуальной проверки.

**Spec:** `docs/superpowers/specs/2026-10-05-living-dragon-design.md`

## Global Constraints

- Никаких библиотек и CDN — всё на ванильных CSS/JS (доступность из РФ).
- Цель по весу — до 150 КБ на все слои дракона вместе.
- Анимации рига — только `transform` и `opacity`.
- `prefers-reduced-motion: reduce` — риг без анимаций, интро пропускается, лазер не планируется.
- Админку (`admin-x-y-z.html`, `js/admin.js`) не трогать.
- Деплой не меняется; ветка не деплоится, слияние в `main` — по команде Ильи.
- Все команды — из корня worktree: `C:/GitHub/Students Dashboard/.claude/worktrees/living-dragon`.
- Коммиты — Conventional Commits на русском, с трейлером `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`; не пушить.

## Review Focus

1. Нулевой забег в интро (дракон на 0 % в начале потока, ученик с 0 очков, выбывший) — `transitionend` не приходит; ожидание: никто не застревает в `.running` / `.is-walking`, лазер стартует. → Task 5, сценарий `?now=2026-09-30`.
2. Стрелять не в кого (все выбыли или финишировали) — ожидание: цикл тихо планирует следующий выстрел, без ошибок. → Task 2 (`pickTarget` → `null`), Task 4 (проверка без целей).
3. Окно поменяло размер после загрузки — ожидание: луч всё равно бьёт точно в аватар (геометрия считается в момент выстрела). → Task 4, проверка после resize.
4. Мусор в `?now=` (`garbage`, `2026-13-45`) — ожидание: параметр игнорируется, страница рисуется по реальной дате. → Task 3.
5. Вкладка скрыта и возвращена — ожидание: никакой очереди выстрелов, один таймер. → Task 4, проверка через подмену `document.hidden`.

---

### Task 1: Нарезка спрайта на слои рига

**Files:**
- Create: `tools/dragon/cut.py`
- Move: `assets/Blood Dragon Sprite Base.png` → `tools/dragon/source.png`
- Delete: `assets/Blood Dragon Sprite Attack.png`
- Generate: `assets/dragon/{tail,tail-glow,body,body-glow,mouth,jaw,head,head-glow,hand}.webp`, `css/dragon-rig.css`

**Interfaces:**
- Produces: CSS-классы и переменные, на которые опираются Task 3–5:
  - `:root { --rig-w; --rig-h; --dragon-reach }` (px; `--dragon-reach` — от левого края рига до глаза);
  - `.dragon-rig .part.{tail,body,mouth,jaw,head,hand}` — `background-image`, у подвижных — `transform-origin`;
  - `.dragon-rig .part.{tail,body,head} > .glow` — `background-image`;
  - `.dragon-rig .head-aim, .dragon-rig .head-idle` — `transform-origin` (шея);
  - `.dragon-rig .eye` — `left/top/width/height` в %; `.dragon-rig .eyelid` — `background`.

- [ ] **Step 1: Перенести исходник и удалить Attack-спрайт**

```bash
mkdir -p tools/dragon
git mv "assets/Blood Dragon Sprite Base.png" tools/dragon/source.png
git rm -q "assets/Blood Dragon Sprite Attack.png"
```

- [ ] **Step 2: Написать `tools/dragon/cut.py`**

```python
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
```

- [ ] **Step 3: Проверить швы в позе покоя**

Run: `python tools/dragon/cut.py --check`
Expected: `rest pose vs source: N px differ (<0.500% of the silhouette)`, код выхода 0. Если доля выше — двигать полигоны (`MOUTH`, `LOWER_TEETH_*` или перехлёсты `*_LAYER`), пока проверка не позеленеет.

- [ ] **Step 4: Собрать слои и CSS**

Run: `python tools/dragon/cut.py`
Expected: `wrote 9 layers (≤150 KB) and dragon-rig.css`. Открыть `assets/dragon/jaw.webp` и `mouth.webp` глазами: на челюсти — нижние зубы по верхней кромке, пасть — тёмная с розовым горлом.

- [ ] **Step 5: Commit**

```bash
git add tools/dragon assets/dragon css/dragon-rig.css
git commit -m "feat(dragon): нарезка спрайта на слои рига

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Чистая логика охоты

**Files:**
- Create: `js/dragon.js` (пока только чистые функции + экспорт)
- Test: `tests/dragon.test.js`

**Interfaces:**
- Produces (Node: `module.exports`, браузер: `window.DragonRig`):
  - `pickTarget(candidates: {x:number, state:string}[], eyeX:number) → candidate | null`
  - `shotDelay(states: string[], rand?: () => number) → number` (мс)
  - `aimAngle(pivot: {x,y}, target: {x,y}) → number` (градусы, CSS по часовой, клэмп −14…+6)

- [ ] **Step 1: Написать падающие тесты `tests/dragon.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { pickTarget, shotDelay, aimAngle } = require('../js/dragon.js');

const field = [
  { id: 'leader', x: 900, state: 'fresh' },
  { id: 'mid', x: 500, state: 'fresh' },
  { id: 'slow', x: 300, state: 'stressed' },
  { id: 'caught', x: 100, state: 'bitten' },
];

test('pickTarget: nearest student ahead of the eye', () => {
  assert.equal(pickTarget(field, 250).id, 'slow');
});

test('pickTarget: a student exactly at the eye counts as ahead', () => {
  assert.equal(pickTarget(field, 300).id, 'slow');
});

test('pickTarget: nobody ahead → nearest one behind', () => {
  assert.equal(pickTarget(field, 950).id, 'leader');
});

test('pickTarget: dropped and finished students are never targets', () => {
  const c = [
    { id: 'dead', x: 320, state: 'dropped' },
    { id: 'done', x: 340, state: 'victory' },
    { id: 'prey', x: 700, state: 'fresh' },
  ];
  assert.equal(pickTarget(c, 300).id, 'prey');
});

test('pickTarget: nobody to shoot → null', () => {
  assert.equal(pickTarget([], 300), null);
  assert.equal(pickTarget([{ x: 400, state: 'dropped' }, { x: 500, state: 'victory' }], 300), null);
});

test('shotDelay: calm field → 7–11 s', () => {
  assert.equal(shotDelay(['fresh', 'victory'], () => 0), 7000);
  assert.equal(shotDelay(['fresh'], () => 1), 11000);
});

test('shotDelay: anyone stressed or bitten → 4–7 s', () => {
  assert.equal(shotDelay(['fresh', 'stressed'], () => 0), 4000);
  assert.equal(shotDelay(['bitten'], () => 1), 7000);
});

test('shotDelay: dropped students do not raise the alarm', () => {
  assert.equal(shotDelay(['dropped', 'fresh'], () => 0), 7000);
});

test('shotDelay: empty field still yields a calm delay', () => {
  assert.equal(shotDelay([], () => 0.5), 9000);
});

test('aimAngle: straight ahead → 0', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: 100, y: 0 }), 0);
});

test('aimAngle: slightly up → that angle (negative = up)', () => {
  assert.ok(Math.abs(aimAngle({ x: 0, y: 0 }, { x: 100, y: -10 }) - -5.71) < 0.01);
});

test('aimAngle: steep up is clamped to 14° up', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: 100, y: -300 }), -14);
});

test('aimAngle: below is clamped to 6° down', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: 100, y: 100 }), 6);
});

test('aimAngle: target behind and above never flips the head', () => {
  assert.equal(aimAngle({ x: 0, y: 0 }, { x: -100, y: -50 }), -14);
});
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `node --test tests/dragon.test.js`
Expected: FAIL — `Cannot find module '../js/dragon.js'`.

- [ ] **Step 3: Написать `js/dragon.js` с чистыми функциями**

```js
/**
 * DRAGON CHASE - Living dragon: cutout rig + laser hunter
 *
 * Rig geometry (layer files, pivots, eye box) is in css/dragon-rig.css,
 * generated by tools/dragon/cut.py. Pure helpers are covered by
 * tests/dragon.test.js; the browser gets everything as window.DragonRig.
 */
(function (root) {
  // Pause between shots: calm field vs someone already in danger
  const SHOT_DELAY_CALM = [7000, 11000];
  const SHOT_DELAY_ALARM = [4000, 7000];

  // Head aim limits: up to 14° up, 6° down — never flips to shoot backwards
  const AIM_UP_DEG = -14;
  const AIM_DOWN_DEG = 6;

  /**
   * Who the dragon shoots: the nearest student ahead of its eye;
   * nobody ahead — the nearest one behind. Dropped and finished are safe.
   * candidates: [{ x, state }], x — avatar centre in track px
   */
  function pickTarget(candidates, eyeX) {
    const prey = candidates.filter(c => c.state !== 'dropped' && c.state !== 'victory');
    if (prey.length === 0) return null;
    const ahead = prey.filter(c => c.x >= eyeX);
    if (ahead.length > 0) return ahead.reduce((a, b) => (b.x < a.x ? b : a));
    return prey.reduce((a, b) => (b.x > a.x ? b : a));
  }

  /**
   * Milliseconds until the next shot; faster once anyone is stressed or bitten
   */
  function shotDelay(states, rand = Math.random) {
    const alarm = states.some(s => s === 'stressed' || s === 'bitten');
    const [min, max] = alarm ? SHOT_DELAY_ALARM : SHOT_DELAY_CALM;
    return Math.round(min + (max - min) * rand());
  }

  /**
   * Head rotation (deg, CSS clockwise) pointing the snout from pivot to target
   */
  function aimAngle(pivot, target) {
    const deg = Math.atan2(target.y - pivot.y, target.x - pivot.x) * 180 / Math.PI;
    return Math.max(AIM_UP_DEG, Math.min(AIM_DOWN_DEG, deg));
  }

  const api = { pickTarget, shotDelay, aimAngle };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DragonRig = api;
})(typeof window !== 'undefined' ? window : globalThis);
```

- [ ] **Step 4: Тесты проходят**

Run: `node --test tests/dragon.test.js`
Expected: PASS, 14 тестов, 0 failures.

- [ ] **Step 5: Commit**

```bash
git add js/dragon.js tests/dragon.test.js
git commit -m "feat(dragon): выбор цели, темп выстрелов и наведение головы

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Риг на треке и анимация покоя

**Files:**
- Modify: `js/dragon.js` — добавить `buildRig()`, экспорт
- Create: `css/dragon.css`
- Modify: `css/blood-dragon.css:333-353` — удалить старые `.dragon`, `.dragon img`, `@keyframes dragon-pulse`
- Modify: `js/dashboard.js` — убрать `DRAGON_SPRITE_*`, `DRAGON_*_MS`, `startDragonAnimation`; добавить `getNow()`; переписать `renderProgressBar()` на одну сборку строки и риг
- Modify: `index.html` — подключить `css/dragon-rig.css`, `css/dragon.css`, `js/dragon.js`
- Modify: `.gitignore` — `live/`
- Scratch: `<scratchpad>/verify/verify.py` (не коммитится)

**Interfaces:**
- Consumes: CSS-переменные и классы из Task 1; `DragonRig` из Task 2.
- Produces:
  - `DragonRig.buildRig() → string` — разметка `.dragon-rig` (см. Step 1);
  - маркеры учеников: `.student-marker[data-state]` (состояние строкой);
  - `getNow() → Date` в `dashboard.js`.

- [ ] **Step 1: `buildRig()` в `js/dragon.js`**

Добавить перед `const api`:

```js
  /**
   * Rig markup; paint order matches the layer order in tools/dragon/cut.py
   */
  function buildRig() {
    return `
      <div class="dragon-rig" aria-hidden="true">
        <div class="part tail"><div class="glow"></div></div>
        <div class="part body"><div class="glow"></div></div>
        <div class="head-aim"><div class="head-idle">
          <div class="part mouth"></div>
          <div class="part jaw"></div>
          <div class="part head"><div class="glow"></div></div>
          <div class="eye"><div class="eyelid"></div></div>
        </div></div>
        <div class="part hand"></div>
      </div>`;
  }
```

и заменить экспорт: `const api = { pickTarget, shotDelay, aimAngle, buildRig };`

- [ ] **Step 2: `css/dragon.css` — риг, покой, волна, глаз**

```css
/* ===========================================
   LIVING DRAGON — cutout rig, laser, intro
   Geometry (layer files, pivots, eye box): css/dragon-rig.css,
   generated by tools/dragon/cut.py
   =========================================== */

.dragon {
  position: absolute;
  top: 40px;
  z-index: 2;
  transition: left 1s ease-out;
}

.dragon-rig {
  position: relative;
  width: var(--rig-w);
  height: var(--rig-h);
  filter: drop-shadow(0 0 8px var(--dragon-color)) drop-shadow(0 0 18px rgba(0, 240, 255, 0.45));
}

.dragon-rig .part,
.dragon-rig .head-aim,
.dragon-rig .head-idle,
.dragon-rig .glow {
  position: absolute;
  inset: 0;
}

.dragon-rig .part,
.dragon-rig .glow {
  background-size: 100% 100%;
  background-repeat: no-repeat;
}

/* Idle: breathing body, head riding on it, tail and hand on their own beat */
.dragon-rig .part.body { animation: dragon-breathe 3.2s ease-in-out infinite; }
.dragon-rig .head-idle { animation: dragon-head-idle 3.2s ease-in-out infinite; }
.dragon-rig .part.hand { animation: dragon-hand 3.2s ease-in-out infinite; }
.dragon-rig .part.tail { animation: dragon-tail 2.6s ease-in-out infinite; }

@keyframes dragon-breathe {
  0%, 100% { transform: scaleY(1); }
  50% { transform: scaleY(1.025); }
}

/* Lift follows the chest rise of dragon-breathe at the neck (~1.4% of the rig) */
@keyframes dragon-head-idle {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-1.4%) rotate(-3deg); }
}

@keyframes dragon-hand {
  0%, 100% { transform: translateY(0) rotate(0deg); }
  50% { transform: translateY(-1%) rotate(-6deg); }
}

@keyframes dragon-tail {
  0%, 100% { transform: rotate(-6deg); }
  50% { transform: rotate(6deg); }
}

/* Light wave along spikes and neon lines, tail -> head. All glow layers share
   the rig canvas, so one mask position keeps the wave continuous across parts */
.dragon-rig .glow {
  mix-blend-mode: screen;
  filter: brightness(1.6);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 50%, transparent);
  mask-image: linear-gradient(90deg, transparent, #000 50%, transparent);
  -webkit-mask-size: 35% 100%;
  mask-size: 35% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  animation: dragon-neon-wave 3.6s linear infinite;
}

@keyframes dragon-neon-wave {
  0% { -webkit-mask-position: -60% 0; mask-position: -60% 0; }
  100% { -webkit-mask-position: 160% 0; mask-position: 160% 0; }
}

/* Eye: pulsing glow and a blink every few seconds */
.dragon-rig .eye { position: absolute; }

.dragon-rig .eye::before {
  content: '';
  position: absolute;
  inset: -40%;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 255, 255, 0.9) 0 15%, rgba(255, 42, 109, 0.8) 35%, transparent 70%);
  mix-blend-mode: screen;
  animation: dragon-eye-glow 1.6s ease-in-out infinite;
}

.dragon-rig .eyelid {
  position: absolute;
  inset: 0;
  border-radius: 40%;
  transform: scaleY(0);
  transform-origin: 50% 0;
  animation: dragon-blink 4.3s infinite;
}

@keyframes dragon-eye-glow {
  0%, 100% { opacity: 0.55; transform: scale(0.9); }
  50% { opacity: 1; transform: scale(1.1); }
}

@keyframes dragon-blink {
  0%, 93%, 100% { transform: scaleY(0); }
  96% { transform: scaleY(1); }
}

/* Danger zone stops at the dragon's eye; never wider than the track */
.danger-zone { max-width: 100%; }

@media (prefers-reduced-motion: reduce) {
  .dragon-rig,
  .dragon-rig *,
  .dragon-rig .eye::before {
    animation: none !important;
    transition: none !important;
  }
}
```

- [ ] **Step 3: Удалить старые стили дракона из `css/blood-dragon.css`**

Удалить блок строк 333–353 целиком (от `/* Dragon */` до закрывающей `}` у `@keyframes dragon-pulse`): `.dragon { … }`, `.dragon img { … }`, `@keyframes dragon-pulse { … }`. Переменные `--dragon-color` / `--dragon-glow` в `:root` остаются.

- [ ] **Step 4: `js/dashboard.js` — константы, `getNow()`, `renderProgressBar()`**

Заменить блок констант спрайта (строки 16–20) — удалить `DRAGON_SPRITE_BASE`, `DRAGON_SPRITE_LASER`, `DRAGON_BASE_MS`, `DRAGON_LASER_MS` и их комментарий.

Перед `getDragonPosition()` добавить:

```js
/**
 * "Now" for the dragon clock; ?now=YYYY-MM-DD previews another day of the cohort
 */
function getNow() {
  const param = new URLSearchParams(location.search).get('now');
  if (param && /^\d{4}-\d{2}-\d{2}$/.test(param)) {
    const date = new Date(param + 'T12:00:00');
    if (!isNaN(date)) return date;
  }
  return new Date();
}
```

В `getDragonPosition()` заменить `const now = new Date();` на `const now = getNow();`.

Заменить `renderProgressBar()` и `startDragonAnimation()` (строки 144–243) на:

```js
/**
 * Render the progress bar
 */
function renderProgressBar() {
  const track = document.getElementById('progress-track');
  if (!track) return;

  const dragonPos = getDragonPosition();

  // Danger zone reaches the dragon's eye (--dragon-reach: css/dragon-rig.css)
  const dangerWidth = pos => `calc(${pos}% + var(--dragon-reach))`;
  const safeWidth = pos => `calc(90% - ${pos}% - var(--dragon-reach))`;

  let html = `
    <div class="danger-zone" style="width: ${dangerWidth(dragonPos)}"></div>
    <div class="safe-zone" style="width: ${safeWidth(dragonPos)}"></div>
    <img class="safe-zone-gift" src="assets/gift_only.png" alt="Приз">
    <div class="zone-label danger">Danger Zone</div>
    <div class="zone-label safe">Safe Zone</div>
    <div class="week-markers">
      ${cohortData.weeks.map(w => `<div class="week-marker">Week ${w.week}</div>`).join('')}
    </div>
    <div class="finish-line"></div>
  `;

  // Sort students by points (descending) — leader on top, slowest near dragon
  const sortedStudents = [...cohortData.students].sort((a, b) =>
    getStudentPoints(b.id) - getStudentPoints(a.id)
  );

  // Find leader (most points)
  const leaderPoints = Math.max(...sortedStudents.map(s => getStudentPoints(s.id)));

  html += '<div class="student-lanes">';
  sortedStudents.forEach((student, i) => {
    const pos = getStudentPosition(student.id);
    const state = getStudentState(student.id);
    const avatarSrc = AVATAR_PATH + student.avatar;
    const points = getStudentPoints(student.id);
    const isLeader = points === leaderPoints && points > 0;

    const isDropped = state === 'dropped';
    const inDanger = !isDropped && (state === 'stressed' || state === 'bitten');
    html += `
      <div class="student-lane">
        <div class="student-marker state-${state} ${isLeader && !isDropped ? 'leader' : ''}"
             data-state="${state}" style="left: ${pos}%; --i: ${i}">
          <div class="avatar">
            <img src="${avatarSrc}" alt="${student.name}">
          </div>
          ${isDropped ? '' : `<div class="name">${student.name}</div>`}
          ${isDropped ? '<div class="skull">💀</div>' : ''}
          ${isLeader && !isDropped ? '<div class="crown">👑</div>' : ''}
          ${inDanger ? '<div class="panic">😱</div>' : ''}
        </div>
      </div>
    `;
  });
  html += '</div>';

  // Living dragon: cutout rig (js/dragon.js)
  html += `
    <div class="dragon-lane">
      <div class="dragon" style="left: ${dragonPos}%">
        ${DragonRig.buildRig()}
      </div>
    </div>
  `;

  track.innerHTML = html;
}
```

- [ ] **Step 5: Подключить файлы в `index.html` и игнорировать `live/`**

В `<head>` после `blood-dragon.css`:

```html
  <link rel="stylesheet" href="./css/dragon-rig.css">
  <link rel="stylesheet" href="./css/dragon.css">
```

Перед `<script src="./js/dashboard.js"></script>`:

```html
  <script src="./js/dragon.js"></script>
```

В `.gitignore` добавить строку:

```
live/
```

- [ ] **Step 6: Поднять локальный стенд с живыми данными**

```bash
mkdir -p live
curl -sf https://students.ilia-pro-ai.com/live/data.json -o live/data.json
python -m http.server 8765 --bind 127.0.0.1   # фоном (run_in_background)
```

- [ ] **Step 7: Скрипт проверки `<scratchpad>/verify/verify.py`**

```python
"""Visual checks for the living dragon (throwaway, not committed).

    python verify.py <name> <query> [--reduced] [--wait MS] [--width PX] [--js CODE]...

Saves <name>.png (the progress section) next to this file and prints console
errors plus a JSON probe of the dragon state.
"""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright

OUT = Path(__file__).parent
BASE = "http://127.0.0.1:8765/"

PROBE = """() => ({
  rig: !!document.querySelector('.dragon-rig'),
  running: document.querySelectorAll('.student-marker.running').length,
  walking: !!document.querySelector('.dragon-rig.is-walking'),
  intro: document.getElementById('progress-track').classList.contains('intro'),
  dragonLeft: document.querySelector('.dragon')?.style.left,
  lasers: document.querySelectorAll('.dragon-laser').length,
  states: [...document.querySelectorAll('.student-marker')].map(m => m.dataset.state),
  dates: document.getElementById('cohort-dates').textContent,
})"""

p = argparse.ArgumentParser()
p.add_argument("name")
p.add_argument("query", nargs="?", default="")
p.add_argument("--reduced", action="store_true")
p.add_argument("--wait", type=int, default=3500)
p.add_argument("--width", type=int, default=1440)
p.add_argument("--js", action="append", default=[])
a = p.parse_args()

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    ctx = browser.new_context(viewport={"width": a.width, "height": 1000},
                              reduced_motion="reduce" if a.reduced else "no-preference")
    page = ctx.new_page()
    errors = []
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + a.query)
    page.wait_for_timeout(a.wait)
    for code in a.js:
        result = page.evaluate(code)
        if result is not None:
            print("js:", result)
    page.locator(".progress-section").screenshot(path=str(OUT / f"{a.name}.png"))
    print(json.dumps(page.evaluate(PROBE), ensure_ascii=False))
    print("console errors:", errors or "none")
    browser.close()
```

- [ ] **Step 8: Проверить риг в покое, середину потока и мусорный `?now=`**

```bash
V="<scratchpad>/verify/verify.py"
python "$V" rest ""                      # сегодня: дракон у старта
python "$V" mid "?now=2026-10-16"        # середина потока
python "$V" end "?now=2026-10-23"        # конец потока
python "$V" garbage "?now=garbage"       # должен совпасть с rest
python "$V" badday "?now=2026-13-45"     # должен совпасть с rest
```

Expected: `rig: true`, `console errors: none` во всех пяти; `dragonLeft` у `garbage` и `badday` равен `dragonLeft` у `rest`; у `mid` — около `41.3%`. Открыть `rest.png`, `mid.png`, `end.png` (Read): дракон целый, без щелей у шеи, хвоста и лапы, примерно в 1,6 раза крупнее прежнего, красная зона заканчивается у глаза. Покой глазами — Step 9.

- [ ] **Step 9: Посмотреть анимацию покоя кадрами**

```bash
for t in 0 800 1600 2400; do python "$V" idle-$t "?now=2026-10-16" --wait $((3500 + t)); done
```

Expected: на `idle-*.png` голова, хвост и лапа в разных фазах, волна света в разных местах; швов нет ни в одном кадре. При щелях — увеличить перехлёст в `*_LAYER` (Task 1), пересобрать, повторить.

- [ ] **Step 10: Commit**

```bash
git add js/dragon.js css/dragon.css css/blood-dragon.css js/dashboard.js index.html .gitignore
git commit -m "feat(dragon): риг на треке — дыхание, хвост, глаз, волна по неону

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Лазер-охотник

**Files:**
- Modify: `js/dragon.js` — `createHunter()` и DOM-помощники
- Modify: `css/dragon.css` — наведение, челюсть, луч, искры, попадание
- Modify: `js/dashboard.js` — `let hunter`, `startHunting()`, вызов после рендера

**Interfaces:**
- Consumes: `pickTarget`, `shotDelay`, `aimAngle` (Task 2); `.student-marker[data-state]`, `.dragon-rig`, `.eye`, `.head-aim` (Task 3).
- Produces: `DragonRig.createHunter(track: HTMLElement) → { start(), stop(), shootNow(): Promise<void> }`; в `dashboard.js` — глобальный `hunter` (для отладки из консоли: `hunter.shootNow()`).

- [ ] **Step 1: DOM-помощники и выстрел в `js/dragon.js`**

Добавить после `aimAngle` (константы фаз — к остальным константам в начале IIFE):

```js
  // Shot phases
  const AIM_MS = 600;
  const BEAM_GROW_MS = 120;
  const FIRE_MS = 700;
  const BEAM_FADE_MS = 150;
```

```js
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

  // Centre of an element in the track's space (where absolute children live)
  function centerIn(track, el) {
    const t = track.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return {
      x: r.left + r.width / 2 - t.left - track.clientLeft,
      y: r.top + r.height / 2 - t.top - track.clientTop,
    };
  }

  // The neck joint (head-aim's transform-origin) in the track's space
  function headPivotIn(track, headAim) {
    const t = track.getBoundingClientRect();
    const r = headAim.getBoundingClientRect();
    const [ox, oy] = getComputedStyle(headAim).transformOrigin.split(' ').map(parseFloat);
    return { x: r.left + ox - t.left - track.clientLeft, y: r.top + oy - t.top - track.clientTop };
  }

  function burst(track, at, count, reach) {
    for (let i = 0; i < count; i++) {
      const spark = document.createElement('div');
      spark.className = 'dragon-spark';
      spark.style.left = at.x + 'px';
      spark.style.top = at.y + 'px';
      track.appendChild(spark);
      const angle = Math.random() * Math.PI * 2;
      const dist = reach * (0.4 + Math.random() * 0.6);
      const anim = spark.animate([
        { transform: 'translate(0, 0) scale(1)', opacity: 1 },
        { transform: `translate(${Math.cos(angle) * dist}px, ${Math.sin(angle) * dist}px) scale(0.3)`, opacity: 0 },
      ], { duration: 400 + Math.random() * 300, easing: 'cubic-bezier(0.2, 0.8, 0.4, 1)' });
      anim.onfinish = () => spark.remove();
    }
  }

  function hit(marker) {
    const img = marker.querySelector('.avatar img');
    if (!img) return;
    img.classList.remove('hit');
    void img.offsetWidth; // restart the animation on back-to-back hits
    img.classList.add('hit');
    img.addEventListener('animationend', () => img.classList.remove('hit'), { once: true });
  }

  function readCandidates(track) {
    return [...track.querySelectorAll('.student-marker[data-state]')].map(el => ({
      el,
      state: el.dataset.state,
      x: centerIn(track, el.querySelector('.avatar') || el).x,
    }));
  }

  async function fireAt(track, rig, target) {
    const headAim = rig.querySelector('.head-aim');
    const eye = rig.querySelector('.eye');
    const avatar = target.el.querySelector('.avatar') || target.el;

    // 1. Aim: turn the head, flare the eye, sparks at the mouth
    rig.style.setProperty('--aim', aimAngle(headPivotIn(track, headAim), centerIn(track, avatar)) + 'deg');
    rig.classList.add('is-aiming');
    burst(track, centerIn(track, eye), 5, 18);
    await wait(AIM_MS);

    // 2. Fire from where the turned head now holds the eye
    rig.classList.replace('is-aiming', 'is-firing');
    const from = centerIn(track, eye);
    const to = centerIn(track, avatar);
    const angle = Math.atan2(to.y - from.y, to.x - from.x) * 180 / Math.PI;
    const beam = document.createElement('div');
    beam.className = 'dragon-laser';
    beam.style.left = from.x + 'px';
    beam.style.top = from.y + 'px';
    beam.style.width = Math.hypot(to.x - from.x, to.y - from.y) + 'px';
    beam.style.transform = `rotate(${angle}deg)`;
    track.appendChild(beam);
    beam.animate(
      [{ transform: `rotate(${angle}deg) scaleX(0)` }, { transform: `rotate(${angle}deg) scaleX(1)` }],
      { duration: BEAM_GROW_MS, easing: 'ease-out' }
    );
    beam.animate([{ opacity: 1 }, { opacity: 0.55 }, { opacity: 1 }],
      { duration: 90, iterations: Infinity, delay: BEAM_GROW_MS });

    // 3. Hit
    await wait(BEAM_GROW_MS);
    hit(target.el);
    burst(track, to, 10, 40);
    await wait(FIRE_MS - BEAM_GROW_MS);

    // 4. Fade out, head back
    beam.getAnimations().forEach(a => a.cancel());
    await beam.animate([{ opacity: 1 }, { opacity: 0 }], { duration: BEAM_FADE_MS }).finished;
    beam.remove();
    rig.classList.remove('is-firing');
    rig.style.setProperty('--aim', '0deg');
  }

  /**
   * Shoots the nearest prey on a random beat; idles while the tab is hidden
   */
  function createHunter(track) {
    let timer = null;
    let running = false;
    let busy = false;

    function schedule() {
      clearTimeout(timer);
      if (!running || document.hidden) return;
      timer = setTimeout(shoot, shotDelay(readCandidates(track).map(c => c.state)));
    }

    async function shoot() {
      const rig = track.querySelector('.dragon-rig');
      if (busy || !rig) return;
      busy = true;
      try {
        const eyeX = centerIn(track, rig.querySelector('.eye')).x;
        const target = pickTarget(readCandidates(track), eyeX);
        if (target) await fireAt(track, rig, target);
      } finally {
        busy = false;
        schedule();
      }
    }

    return {
      start() {
        running = true;
        document.addEventListener('visibilitychange', schedule);
        schedule();
      },
      stop() {
        running = false;
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', schedule);
      },
      shootNow: shoot,
    };
  }
```

Экспорт: `const api = { pickTarget, shotDelay, aimAngle, buildRig, createHunter };`

- [ ] **Step 2: Стили выстрела в `css/dragon.css`**

Добавить перед блоком `@media (prefers-reduced-motion: reduce)`:

```css
/* Laser: aim the head, open the jaw, flare the eye, hold the idle pose */
.dragon-rig .head-aim {
  transform: rotate(var(--aim, 0deg));
  transition: transform 0.35s cubic-bezier(0.3, 1.4, 0.5, 1);
}

.dragon-rig .part.jaw { transition: transform 0.12s ease-out; }
.dragon-rig.is-aiming .part.jaw { transform: rotate(5deg); }
.dragon-rig.is-firing .part.jaw { transform: rotate(16deg); }

.dragon-rig.is-aiming .head-idle,
.dragon-rig.is-firing .head-idle { animation-play-state: paused; }

.dragon-rig.is-aiming .eye::before,
.dragon-rig.is-firing .eye::before {
  animation: none;
  opacity: 1;
  transform: scale(1.8);
}

.dragon-rig.is-aiming .eyelid,
.dragon-rig.is-firing .eyelid { animation: none; }

.dragon-laser {
  position: absolute;
  height: 6px;
  margin-top: -3px;
  border-radius: 3px;
  transform-origin: 0 50%;
  background: linear-gradient(180deg, transparent, var(--neon-pink) 20%, #fff 42%, #fff 58%, var(--neon-pink) 80%, transparent);
  box-shadow: 0 0 10px var(--neon-pink), 0 0 22px #ff0044;
  mix-blend-mode: screen;
  pointer-events: none;
  z-index: 7;
}

.dragon-spark {
  position: absolute;
  width: 4px;
  height: 4px;
  margin: -2px 0 0 -2px;
  background: #fff;
  box-shadow: 0 0 6px var(--neon-pink), 0 0 10px var(--neon-pink);
  pointer-events: none;
  z-index: 8;
}

/* Hit lands on the img, so it never fights the avatar's own state animations */
.student-marker .avatar img.hit { animation: avatar-hit 0.45s ease-out; }

@keyframes avatar-hit {
  0% { filter: brightness(3) saturate(0); transform: translateX(0); }
  20% { transform: translateX(-4px); }
  40% { filter: brightness(2); transform: translateX(4px); }
  60% { transform: translateX(-3px); }
  80% { transform: translateX(2px); }
  100% { filter: none; transform: translateX(0); }
}
```

- [ ] **Step 3: Запуск охоты в `js/dashboard.js`**

К состоянию после `let cohortData = null;`:

```js
let hunter = null;
const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
```

В начале `renderProgressBar()` после `if (!track) return;`:

```js
  if (hunter) hunter.stop();
```

В конце `renderProgressBar()` после `track.innerHTML = html;`:

```js
  startHunting(track);
```

После `renderProgressBar()`:

```js
/**
 * Laser hunter (js/dragon.js); off when the viewer asked for less motion
 */
function startHunting(track) {
  if (REDUCED_MOTION) return;
  hunter = DragonRig.createHunter(track);
  hunter.start();
}
```

- [ ] **Step 4: Тесты чистых функций по-прежнему зелёные**

Run: `node --test tests/dragon.test.js`
Expected: PASS, 14 тестов.

- [ ] **Step 5: Поймать луч в полёте и проверить попадание**

```bash
python "$V" beam "?now=2026-10-16" --js "(hunter.shootNow(), null)" --js "new Promise(r => setTimeout(r, 900))"
```

`--js` выполняются по порядку: выстрел стартует, второй ждёт 0,9 с (прицел 0,6 + рост луча 0,12 + запас), скриншот снимается после всех `--js`.
Expected: `lasers: 1`, `console errors: none`; на `beam.png` луч выходит из глаза и упирается в аватар ближайшего ученика впереди дракона, голова повёрнута к цели, челюсть открыта.

- [ ] **Step 6: Review Focus 3 — луч после изменения размера окна**

```bash
python "$V" beam-resized "?now=2026-10-16" --width 1000 --js "(hunter.shootNow(), null)" --js "new Promise(r => setTimeout(r, 900))"
```

Expected: на `beam-resized.png` (трек уже) луч всё так же в центре аватара.

- [ ] **Step 7: Review Focus 2 и 5 — стрелять не в кого; скрытая вкладка**

```bash
python "$V" no-prey "?now=2026-10-16" --js "(document.querySelectorAll('.student-marker').forEach(m => m.dataset.state = 'dropped'), hunter.shootNow().then(() => document.querySelectorAll('.dragon-laser').length))"
python "$V" hidden "?now=2026-10-16" --js "(Object.defineProperty(document, 'hidden', { configurable: true, get: () => true }), document.dispatchEvent(new Event('visibilitychange')), new Promise(r => setTimeout(r, 12000)).then(() => document.querySelectorAll('.dragon-laser').length))"
```

Expected: оба печатают `js: 0`, `console errors: none`. Первый — выстрела нет, цикл перепланирован без ошибок; второй — за 12 с (больше максимальной паузы) при скрытой вкладке ни одного луча.

- [ ] **Step 8: Commit**

```bash
git add js/dragon.js css/dragon.css js/dashboard.js
git commit -m "feat(dragon): лазер-охотник — стреляет в ближайшего ученика впереди

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Повтор забега при открытии и reduced motion

**Files:**
- Modify: `js/dashboard.js` — `INTRO_*`, `introPlayed`, стартовые позиции + `data-final-*`, `playIntroRun()`
- Modify: `css/dragon.css` — переходы интро, бег аватаров, шаг дракона

**Interfaces:**
- Consumes: `startHunting(track)` (Task 4), `.dragon-rig` (Task 3).
- Produces: `.progress-track.intro`, `.student-marker.running`, `.dragon-rig.is-walking`; CSS-переменные `--intro-ms`, `--intro-stagger`, `--i`.

- [ ] **Step 1: Стили интро в `css/dragon.css`**

Добавить перед блоком `@media (prefers-reduced-motion: reduce)`:

```css
/* Intro replay: everyone runs from the start line to today's positions.
   --intro-ms / --intro-stagger come from INTRO_* in js/dashboard.js */
.progress-track.intro .dragon,
.progress-track.intro .student-marker {
  transition: left var(--intro-ms, 2s) cubic-bezier(0.25, 0.8, 0.3, 1);
}

.progress-track.intro .student-marker {
  transition-delay: calc(var(--i, 0) * var(--intro-stagger, 80ms));
}

.progress-track.intro .danger-zone,
.progress-track.intro .safe-zone {
  transition: width var(--intro-ms, 2s) cubic-bezier(0.25, 0.8, 0.3, 1);
}

.progress-track .student-marker.running .avatar {
  animation: avatar-run 0.3s ease-in-out infinite;
}

@keyframes avatar-run {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-6px); }
}

/* Heavy stomping walk while the dragon runs in */
.dragon-rig.is-walking { animation: dragon-stomp 0.42s ease-in-out infinite; }
.dragon-rig.is-walking .head-idle { animation-duration: 0.84s; }

@keyframes dragon-stomp {
  0%, 50%, 100% { transform: translateY(0) rotate(0deg); }
  25% { transform: translateY(-5%) rotate(-1.5deg); }
  75% { transform: translateY(-5%) rotate(1.5deg); }
}
```

и в блок reduced motion добавить селектор `.progress-track .student-marker.running .avatar` в список с `animation: none !important`.

- [ ] **Step 2: Константы и состояние в `js/dashboard.js`**

После `DRAGON_MAX`:

```js
// Intro replay: everyone runs from the start line to today's positions
const INTRO_MS = 2000;
const INTRO_STAGGER_MS = 80;
```

К состоянию после `let hunter = null;`:

```js
let introPlayed = false;
```

- [ ] **Step 3: Стартовые позиции в `renderProgressBar()`**

После `const dragonPos = getDragonPosition();`:

```js
  const playIntro = !introPlayed && !REDUCED_MOTION;
  introPlayed = true;
```

Зоны — стартовая ширина как у дракона на нуле, финальная в `data-final-width`:

```js
  let html = `
    <div class="danger-zone" style="width: ${dangerWidth(playIntro ? 0 : dragonPos)}"
         data-final-width="${dangerWidth(dragonPos)}"></div>
    <div class="safe-zone" style="width: ${safeWidth(playIntro ? 0 : dragonPos)}"
         data-final-width="${safeWidth(dragonPos)}"></div>
```

(остальная часть шаблона `html` — без изменений). В цикле по ученикам после `const inDanger = …`:

```js
    // Dropped students and zero-length runs stay put: no transition, no transitionend
    const runs = playIntro && pos > 0 && !isDropped;
```

и маркер:

```js
        <div class="student-marker state-${state} ${isLeader && !isDropped ? 'leader' : ''} ${runs ? 'running' : ''}"
             data-state="${state}" data-final-left="${pos}%" style="left: ${runs ? 0 : pos}%; --i: ${i}">
```

Дракон:

```js
      <div class="dragon" style="left: ${playIntro ? 0 : dragonPos}%" data-final-left="${dragonPos}%">
```

Конец функции — вместо `startHunting(track);`:

```js
  if (playIntro) playIntroRun(track, dragonPos > 0);
  else startHunting(track);
```

- [ ] **Step 4: `playIntroRun()` после `renderProgressBar()`**

```js
/**
 * Intro replay: markers start at the line, then transition to data-final-* values
 */
function playIntroRun(track, dragonMoves) {
  const dragon = track.querySelector('.dragon');
  const rig = track.querySelector('.dragon-rig');
  track.style.setProperty('--intro-ms', INTRO_MS + 'ms');
  track.style.setProperty('--intro-stagger', INTRO_STAGGER_MS + 'ms');
  track.classList.add('intro');
  if (dragonMoves) rig.classList.add('is-walking');

  // Each runner stops hopping when its own run ends
  track.querySelectorAll('.student-marker.running').forEach(marker => {
    marker.addEventListener('transitionend', e => {
      if (e.target === marker && e.propertyName === 'left') marker.classList.remove('running');
    });
  });
  dragon.addEventListener('transitionend', e => {
    if (e.target === dragon && e.propertyName === 'left') rig.classList.remove('is-walking');
  });

  // Two frames: let the start positions paint before moving to the real ones
  requestAnimationFrame(() => requestAnimationFrame(() => {
    track.querySelectorAll('[data-final-left]').forEach(el => { el.style.left = el.dataset.finalLeft; });
    track.querySelectorAll('[data-final-width]').forEach(el => { el.style.width = el.dataset.finalWidth; });
  }));

  // Safety net for runs that never fire transitionend; the laser waits for the intro
  const total = INTRO_MS + cohortData.students.length * INTRO_STAGGER_MS + 100;
  setTimeout(() => {
    track.classList.remove('intro');
    rig.classList.remove('is-walking');
    track.querySelectorAll('.student-marker.running').forEach(m => m.classList.remove('running'));
    startHunting(track);
  }, total);
}
```

- [ ] **Step 5: Интро кадрами в середине потока**

```bash
for t in 300 900 1500 3200; do python "$V" intro-$t "?now=2026-10-16" --wait $t; done
```

Expected: `intro-300` — все у старта, `intro: true`, `walking: true`, `running > 0`; `intro-900`/`intro-1500` — на полпути, аватары вразнобой (задержка по `--i`); `intro-3200` — финальные позиции, `intro: false`, `running: 0`, `walking: false`, `console errors: none`.

- [ ] **Step 6: Review Focus 1 — нулевой забег**

```bash
python "$V" zero "?now=2026-09-30" --js "typeof hunter.shootNow"
```

Expected: `dragonLeft: "0%"`, `running: 0`, `walking: false`, `intro: false` — никто не застрял; `js: function` — охотник запущен после интро; `console errors: none`.

- [ ] **Step 7: Reduced motion**

```bash
python "$V" reduced "?now=2026-10-16" --reduced --wait 300 --js "new Promise(r => setTimeout(r, 12000)).then(() => [hunter, document.querySelectorAll('.dragon-laser').length])"
```

Expected: уже через 300 мс `intro: false`, `running: 0`, `dragonLeft` ≈ `41.3%` (финальная позиция сразу); `js: [None, 0]` — охотник не создан, лучей нет; `console errors: none`. На `reduced.png` дракон в позе покоя.

- [ ] **Step 8: Commit**

```bash
git add js/dashboard.js css/dragon.css
git commit -m "feat(dragon): повтор забега при открытии страницы

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Документация и финальная проверка

**Files:**
- Modify: `AGENTS.md` — разделы «Структура» и новый «Дракон»

- [ ] **Step 1: Обновить дерево в разделе «Структура» `AGENTS.md`**

Заменить блок дерева на:

```
├── index.html                # Публичный дашборд
├── admin-x-y-z.html          # Админка для чекинов
├── data/
│   └── cohort-1.json         # Данные потока (ученики, задания, прогресс)
├── css/
│   ├── blood-dragon.css
│   ├── dragon.css            # Риг дракона: покой, лазер, интро
│   └── dragon-rig.css        # Геометрия рига — генерирует tools/dragon/cut.py
├── js/
│   ├── dashboard.js
│   ├── dragon.js             # Риг, выбор цели, лазер-охотник
│   └── admin.js
├── tests/
│   └── dragon.test.js        # node --test tests/dragon.test.js
├── tools/dragon/
│   ├── cut.py                # Нарезка спрайта на слои рига
│   └── source.png            # Исходный спрайт (в бакет не попадает)
├── yandex/
│   └── save-function/
│       └── index.js          # Yandex Cloud Function: сохранение из админки → live/data.json
├── .github/workflows/
│   └── deploy-yc.yml         # Выкладка в бакет при push в main
└── assets/
    ├── avatars/              # Аватары учеников
    ├── dragon/               # Слои рига (WebP), генерирует tools/dragon/cut.py
    └── gift_only.png
```

- [ ] **Step 2: Раздел «Дракон» в `AGENTS.md` — после «Состояния аватаров»**

```markdown
## Дракон

Cutout-риг: исходный спрайт `tools/dragon/source.png` порезан на слои
(`assets/dragon/*.webp`), которые двигают CSS-анимации (`css/dragon.css`).
Дышит, качает хвостом, моргает; раз в 7–11 с (4–7 с, если кто-то в зоне
опасности) стреляет лазером в ближайшего ученика впереди себя. При открытии
страницы дракон и аватары добегают от старта до своих позиций (~2 с).

- **Поменять нарезку** (полигоны частей, точки вращения, пасть) — константы в
  `tools/dragon/cut.py`, затем `python tools/dragon/cut.py --check` (поза покоя
  должна совпасть с исходником) и `python tools/dragon/cut.py` (слои +
  `css/dragon-rig.css`). Руками `css/dragon-rig.css` не править.
- **Посмотреть другой день потока:** `?now=2026-10-16` в адресе.
- **Выстрелить вручную:** в консоли браузера `hunter.shootNow()`.
- `prefers-reduced-motion` — дракон статичен, без интро и лазера.
- Тесты логики: `node --test tests/dragon.test.js`.
```

- [ ] **Step 3: Финальный прогон**

```bash
node --test tests/dragon.test.js
python tools/dragon/cut.py --check
for q in "" "?now=2026-10-16" "?now=2026-10-23"; do python "$V" final "$q"; done
```

Expected: 14 тестов PASS; проверка швов — код 0; три прогона — `rig: true`, `console errors: none`.

- [ ] **Step 4: Commit**

```bash
git add AGENTS.md
git commit -m "docs(dragon): риг, нарезка и отладка дракона в AGENTS.md

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```
