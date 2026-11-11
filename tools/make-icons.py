"""Генерация иконок PWA из брендового знака «ПП».

Запуск:
    python3 tools/make-icons.py
Требуется Pillow. Результат — assets/icons/*.png
"""
import os
from PIL import Image, ImageDraw, ImageFont

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(BASE, "assets", "icons")
FONT_PATH = "/System/Library/Fonts/Supplemental/Georgia Bold.ttf"
FONT_FALLBACK = "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf"

GREEN_TOP = (53, 118, 90)
GREEN_BOTTOM = (33, 82, 62)
CREAM = (247, 243, 234)


def gradient(size, top, bottom):
    img = Image.new("RGB", (size, size), top)
    px = img.load()
    for y in range(size):
        t = y / max(1, size - 1)
        # лёгкая нелинейность — сверху светлее, как у бумаги
        t = t ** 0.85
        r = round(top[0] + (bottom[0] - top[0]) * t)
        g = round(top[1] + (bottom[1] - top[1]) * t)
        b = round(top[2] + (bottom[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return img


def rounded_mask(size, radius):
    mask = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(mask)
    d.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=255)
    return mask


def draw_glyph(img, text, ratio, dy=0.0):
    size = img.size[0]
    font = ImageFont.truetype(
        FONT_PATH if os.path.exists(FONT_PATH) else FONT_FALLBACK,
        round(size * ratio),
    )
    d = ImageDraw.Draw(img)
    box = d.textbbox((0, 0), text, font=font)
    w = box[2] - box[0]
    h = box[3] - box[1]
    # компенсируем оптические отступы глифа
    x = (size - w) / 2 - box[0]
    y = (size - h) / 2 - box[1] + size * dy
    d.text((x, y), text, font=font, fill=CREAM)


def make_icon(size, radius_ratio, glyph_ratio, path, dy=0.0):
    base = gradient(size, GREEN_TOP, GREEN_BOTTOM)
    # мягкий блик сверху
    glow = Image.new("L", (size, size), 0)
    gd = ImageDraw.Draw(glow)
    gd.ellipse((-size * 0.35, -size * 0.75, size * 1.35, size * 0.55), fill=26)
    base = Image.composite(Image.new("RGB", (size, size), (255, 255, 255)), base, glow)
    draw_glyph(base, "ПП", glyph_ratio, dy)
    if radius_ratio:
        out = Image.new("RGBA", (size, size), (0, 0, 0, 0))
        out.paste(base, (0, 0), rounded_mask(size, round(size * radius_ratio)))
    else:
        out = base.convert("RGBA")
    out.save(path, "PNG", optimize=True)
    print("  ", os.path.relpath(path, BASE), size)


def main():
    os.makedirs(OUT, exist_ok=True)
    print("Генерирую иконки:")
    # обычные (со скруглением — как в манифесте для Android/десктопа)
    make_icon(192, 0.22, 0.40, os.path.join(OUT, "icon-192.png"))
    make_icon(512, 0.22, 0.40, os.path.join(OUT, "icon-512.png"))
    # maskable: фон во весь квадрат, знак в безопасной зоне 80 %
    make_icon(512, 0, 0.30, os.path.join(OUT, "icon-maskable-512.png"))
    # iOS: квадрат без прозрачности, скругление делает система
    make_icon(180, 0, 0.40, os.path.join(OUT, "apple-touch-icon.png"))
    # favicon-растр на замену SVG в старых браузерах
    make_icon(32, 0.20, 0.44, os.path.join(OUT, "favicon-32.png"))


if __name__ == "__main__":
    main()
