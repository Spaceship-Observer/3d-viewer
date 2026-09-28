#!/usr/bin/env python3
"""
Генерация иконок PWA без внешних зависимостей (PIL уже есть в песочнице).
Запуск: python3 scripts/gen-icons.py
Результат: public/icons/*.png, public/apple-touch-icon-180.png
"""
import math
import os
from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "public", "icons")
os.makedirs(OUT, exist_ok=True)

BG_TOP = (20, 24, 34)
BG_BOTTOM = (8, 9, 13)
BLUE = (92, 152, 255)
VIOLET = (150, 108, 255)
WHITE = (235, 241, 255)


def rounded_mask(size, radius, ss=4):
    m = Image.new("L", (size * ss, size * ss), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size * ss - 1, size * ss - 1], radius=radius * ss, fill=255)
    return m.resize((size, size), Image.LANCZOS)


def lerp(a, b, t):
    return tuple(round(a[i] + (b[i] - a[i]) * t) for i in range(3))


def background(size, radius):
    img = Image.new("RGB", (size, size), BG_BOTTOM)
    grad = Image.new("RGB", (1, size))
    px = grad.load()
    for y in range(size):
        px[0, y] = lerp(BG_TOP, BG_BOTTOM, (y / max(1, size - 1)) ** 0.85)
    img.paste(grad.resize((size, size)), (0, 0))

    # Мягкое голубое свечение за кубом
    glow = Image.new("RGB", (size, size), (0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [size * 0.04, size * 0.08, size * 0.96, size * 1.0], fill=(52, 74, 142)
    )
    glow = glow.filter(ImageFilter.GaussianBlur(size * 0.17))

    mask = Image.new("L", (size, size), 0)
    ImageDraw.Draw(mask).ellipse(
        [size * 0.04, size * 0.08, size * 0.96, size * 1.0], fill=255
    )
    mask = mask.filter(ImageFilter.GaussianBlur(size * 0.17))
    return Image.composite(glow, img, mask)


def cube_points(cx, cy, s):
    """Изометрический куб: 3 грани, 9 видимых рёбер."""
    dx = s * 0.866
    top = [(cx, cy - s), (cx + dx, cy - s * 0.5), (cx, cy), (cx - dx, cy - s * 0.5)]
    left = [(cx - dx, cy - s * 0.5), (cx, cy), (cx, cy + s), (cx - dx, cy + s * 0.5)]
    right = [(cx + dx, cy - s * 0.5), (cx, cy), (cx, cy + s), (cx + dx, cy + s * 0.5)]
    return top, left, right


def draw_cube(img, scale=1.0, glow=True):
    size = img.size[0]
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    c = size / 2
    s = size * 0.235 * scale
    top, left, right = cube_points(c, c - size * 0.012, s)
    w = max(2, int(size * 0.021 * scale))

    if glow:
        halo = Image.new("RGBA", img.size, (0, 0, 0, 0))
        hd = ImageDraw.Draw(halo)
        for face in (top, left, right):
            hd.line(face + [face[0]], fill=BLUE + (150,), width=int(w * 2.6), joint="curve")
        halo = halo.filter(ImageFilter.GaussianBlur(size * 0.028))
        img.alpha_composite(halo)

    for i, face in enumerate((top, left, right)):
        col = lerp(BLUE, VIOLET, i / 2.0)
        d.line(face + [face[0]], fill=col + (255,), width=w, joint="curve")

    r = s * 0.20
    d.ellipse([c - r, c - r, c + r, c + r], fill=WHITE + (255,))
    return img


def make_icon(size, maskable=False, opaque=False):
    img = background(size, 0 if maskable else int(size * 0.22)).convert("RGBA")
    draw_cube(img, scale=0.74 if maskable else 1.0)
    if not maskable:
        img.putalpha(rounded_mask(size, int(size * 0.22)))
    else:
        img.putalpha(255)
    if opaque:  # iOS не любит прозрачность
        bg = Image.new("RGBA", img.size, BG_BOTTOM + (255,))
        bg.alpha_composite(img)
        img = bg
    return img


def main():
    for size in (192, 512):
        make_icon(size).save(os.path.join(OUT, f"icon-{size}.png"), optimize=True)
    make_icon(512, maskable=True).save(os.path.join(OUT, "maskable-512.png"), optimize=True)
    make_icon(180, opaque=True).save(os.path.join(ROOT, "public", "apple-touch-icon-180.png"), optimize=True)
    make_icon(32, opaque=True).save(os.path.join(ROOT, "public", "icons", "favicon-32.png"), optimize=True)

    favicon = os.path.join(ROOT, "public", "favicon.svg")
    with open(favicon, "w", encoding="utf-8") as f:
        f.write(
            '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">'
            '<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">'
            '<stop offset="0" stop-color="#5c98ff"/><stop offset="1" stop-color="#966cff"/>'
            "</linearGradient></defs>"
            '<rect width="64" height="64" rx="14" fill="#0f121a"/>'
            '<g fill="none" stroke="url(#g)" stroke-width="2.6" stroke-linejoin="round">'
            '<path d="M32 15 49 25 32 35 15 25Z"/><path d="M15 25v14l17 10 17-10V25"/>'
            '<path d="M32 35v14"/></g>'
            '<circle cx="32" cy="35" r="3" fill="#ebf1ff"/>'
            "</svg>\n"
        )
    print("иконки готовы:", OUT)


if __name__ == "__main__":
    main()
